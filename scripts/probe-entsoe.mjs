/*
  Probe gate for the ENTSO-E NL substitution (Phase 1, one-off, runs in
  Actions with the ENTSOE_API_TOKEN secret available — never part of the
  daily snapshot job):

    node --experimental-strip-types scripts/probe-entsoe.mjs

  Fetches the actual generation per production type (A75, processType A16)
  and the actual total load (A65, processType A16) for the NL bidding zone
  10YNL----------L for one summer sample day (2026-06-15), one winter sample
  day (2026-01-15) and the trailing 365-day window, then evaluates the three
  acceptance criteria. It also records the same figures for the document
  pair named in the original change request (A69/A01), which the live API
  answers with the wind-and-solar day-ahead forecast only, as a comparison
  appendix in the PR description:

    1. summer midday solar peak in the multi-gigawatt range, consistent
       with the installed NL solar AC fleet (energy-charts installed_power,
       latest record, solar_ac);
    2. trailing-window solar sum annualized into a plausible band around
       the CBS-reported ~25 TWh per year (window offset and year
       completion allowed);
    3. monthly seasonality: summer solar clearly above winter solar.

  It also verifies, hour by hour, that the UTC->Europe/Amsterdam conversion
  of the ENTSO-E timestamps aligns with the unchanged energy-charts price
  series, and recomputes the old energy-charts renewable share from its
  per-type feeds to compare the renewable composition.

  If any criterion fails the script exits 1 and prints every figure; the
  caller then stops and records the numbers in the PR description instead of
  proceeding to the backfill. No fallback is implemented here. The token is
  never printed; all figures come from the API responses.
*/

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchNlPowerEnvelope,
  fetchEntsoe,
  parseEntsoeIntervals,
  verifyHourAlignment,
  PSR_TYPES,
  DOC_GENERATION,
  AS_SPECIFIED,
  entsoeTs,
} from "./lib-entsoe.mjs";
import { ecUrl, fetchJsonPaced } from "./lib-fetch.mjs";
import { bucketHours } from "../src/grid/hourly.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SUMMER_DAY = Date.UTC(2026, 5, 15); // 2026-06-15, UTC day
const WINTER_DAY = Date.UTC(2026, 0, 15); // 2026-01-15, UTC day
const DAY_MS = 86_400_000;

// Acceptance bands (see header): multi-GW summer peak consistent with the
// fleet; trailing solar annualized around 25 TWh/yr; summer above winter.
const PEAK_MIN_GW = 5;
const TRAILING_SOLAR_MIN_TWH = 18;
const TRAILING_SOLAR_MAX_TWH = 35;
const SEASON_RATIO_MIN = 3;

const energyGWh = (records, seriesId, filter) =>
  records.reduce((sum, r) => {
    if (filter && !filter(r)) return sum;
    const mw = r.values[seriesId];
    if (mw == null || !Number.isFinite(mw) || !r.ms) return sum;
    return sum + (mw * r.ms) / 3_600_000 / 1000; // MW * h -> GWh
  }, 0);

const gw = (mw) => mw / 1000;

async function main() {
  if (!process.env.ENTSOE_API_TOKEN) {
    console.error("ENTSOE_API_TOKEN is not set; the probe must run in Actions with the secret.");
    process.exit(2);
  }
  const now = Date.now();
  const trailingStart = now - 365 * DAY_MS;
  const report = { probedAt: new Date(now).toISOString(), checks: {}, figures: {} };

  console.log("ENTSO-E NL probe gate");
  console.log(`  trailing window: ${new Date(trailingStart).toISOString()} .. ${new Date(now).toISOString()}`);

  // NL installed solar AC fleet (energy-charts installed_power, latest yearly record).
  const inst = await fetchJsonPaced(ecUrl("/v2/installed_power", { country: "nl", year: "-1" }), { label: "installed_power nl" });
  let fleetGW = null;
  if (inst.ok) {
    const last = inst.json.data?.[inst.json.data.length - 1];
    fleetGW = last?.values?.solar_ac ?? null; // GW
  }
  console.log(`  NL installed solar AC fleet (energy-charts installed_power, latest record): ${fleetGW} GW`);
  report.figures.nlInstalledSolarAcGW = fleetGW;

  // Sample days + trailing window from ENTSO-E.
  const summer = await fetchNlPowerEnvelope(SUMMER_DAY, SUMMER_DAY + DAY_MS, { fresh: true });
  const winter = await fetchNlPowerEnvelope(WINTER_DAY, WINTER_DAY + DAY_MS, { fresh: true });
  const trailing = await fetchNlPowerEnvelope(trailingStart, now, { fresh: true });
  if (!summer.ok || !winter.ok || !trailing.ok) {
    report.checks.entsoeFetch = {
      pass: false,
      detail: `ENTSO-E window fetch failed (summer ok=${summer.ok}, winter ok=${winter.ok}, trailing ok=${trailing.ok}, trailing window failures=${trailing.failures}); per-window reasons are in the warnings above`,
    };
    console.error("\n=== ENTSO-E NL probe report (partial, figures collected so far) ===");
    console.error(JSON.stringify(report, null, 2));
    console.error(`Probe gate STOPPED: ENTSO-E fetch failed for a probe window (summer=${summer.ok} winter=${winter.ok} trailing=${trailing.ok}); criteria not evaluated, backfill not run.`);
    process.exit(1);
  }
  report.checks.entsoeFetch = { pass: true, detail: "all three ENTSO-E probe windows (summer day, winter day, trailing year) fetched" };
  report.figures.psrTypesSeen = trailing.psrTypes.map((c) => `${c} (${PSR_TYPES[c]?.name ?? "UNMAPPED"})`);

  const solarRecords = (env) => env.envelope.data.filter((r) => r.values.solar != null);

  // Per-psrType detail of the summer-day generation document, plus an alternative
  // query shape (inBiddingZone_Domain) to compare what the API returns.
  const perType = {};
  {
    const w = { periodStart: entsoeTs(SUMMER_DAY), periodEnd: entsoeTs(SUMMER_DAY + DAY_MS) };
    const raw = await fetchEntsoe({ documentType: DOC_GENERATION, ...w }, { fresh: true, label: "generation detail summer" });
    if (raw.ok) {
      const { records } = parseEntsoeIntervals(raw.xml);
      const byPsr = new Map();
      for (const r of records) {
        const acc = byPsr.get(r.psrType ?? "(none)") ?? { points: 0, maxMW: -Infinity, energyGWh: 0, first: r.timestamp, last: r.timestamp, res: new Set() };
        acc.points += 1;
        acc.maxMW = Math.max(acc.maxMW, r.mw);
        acc.energyGWh += (r.mw * r.ms) / 3_600_000 / 1000;
        acc.first = r.timestamp < acc.first ? r.timestamp : acc.first;
        acc.last = r.timestamp > acc.last ? r.timestamp : acc.last;
        acc.res.add(r.ms);
        byPsr.set(r.psrType ?? "(none)", acc);
      }
      for (const [psr, a] of byPsr) {
        perType[psr] = {
          name: PSR_TYPES[psr]?.name ?? "UNMAPPED",
          points: a.points,
          maxMW: Math.round(a.maxMW * 10) / 10,
          energyGWh: Math.round(a.energyGWh),
          first: a.first,
          last: a.last,
          resolutionsMs: [...a.res],
        };
      }
      // Compact header of every TimeSeries element in the raw document, so
      // the log shows exactly which series the API returned and in what unit.
      const { XMLParser } = await import("fast-xml-parser");
      const p = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        isArray: (name) => name === "TimeSeries" || name === "timeSeries" || name === "Period" || name === "Point",
        parseTagValue: false,
        trimValues: true,
      });
      const doc = p.parse(raw.xml);
      const seriesList = [...(doc?.GL_MarketDocument?.TimeSeries ?? []), ...(doc?.GL_MarketDocument?.timeSeries ?? [])];
      report.figures.seriesHeaders = seriesList.map((ts) => ({
        mRID: ts.mRID,
        businessType: ts.businessType,
        objectAggregation: ts.objectAggregation,
        curveType: ts.curveType,
        psrElement: ts.MktPSRType?.psrType ?? ts.MktPSRType?.["@_psrType"] ?? ts.psrType ?? ts["@_psrType"] ?? null,
        unit: ts.quantity_Measure_Unit?.name ?? ts["quantity_Measure_Unit.name"] ?? null,
        periods: (ts.Period ?? []).map((per) => ({
          resolution: per.resolution,
          points: (per.Point ?? []).length,
          start: per.timeInterval?.start,
          end: per.timeInterval?.end,
        })),
      }));
      console.log("  series headers:", JSON.stringify(report.figures.seriesHeaders));
    }
    // Alternative parameter name for the same document.
    const alt = await fetch(
      (() => {
        const u = new URL("https://web-api.tp.entsoe.eu/api");
        u.searchParams.set("securityToken", process.env.ENTSOE_API_TOKEN ?? "");
        u.searchParams.set("documentType", DOC_GENERATION);
        u.searchParams.set("processType", "A01");
        u.searchParams.set("inBiddingZone_Domain", "10YNL----------L");
        u.searchParams.set("periodStart", w.periodStart);
        u.searchParams.set("periodEnd", w.periodEnd);
        return u;
      })(),
      { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(120_000) },
    );
    if (alt.ok) {
      const { records, psrTypes } = parseEntsoeIntervals(await alt.text());
      report.figures.altInBiddingZoneDomain = { status: alt.status, psrTypes, points: records.length };
    } else {
      report.figures.altInBiddingZoneDomain = { status: alt.status };
    }
  }
  report.figures.perTypeSummerDay = perType;
  console.log("  per-type detail (summer day, actual generation per type):", JSON.stringify(perType, null, 1));

  // Criterion 1: summer midday (10:00-15:00 UTC = 12:00-17:00 CEST) solar peak.
  const midday = solarRecords(summer).filter((r) => {
    const h = new Date(r.timestamp).getUTCHours();
    return h >= 10 && h < 15;
  });
  const summerPeakMW = midday.length ? Math.max(...midday.map((r) => r.values.solar)) : null;
  const summerPeakGW = summerPeakMW != null ? gw(summerPeakMW) : null;
  const peakShareOfFleet = fleetGW && summerPeakMW != null ? summerPeakMW / 1000 / fleetGW : null;
  report.figures.summerMiddaySolarPeakGW = summerPeakGW;
  report.figures.summerMiddayPeakShareOfFleet = peakShareOfFleet;
  report.checks.summerMiddayPeak = {
    pass:
      summerPeakGW != null &&
      fleetGW != null &&
      summerPeakGW >= PEAK_MIN_GW &&
      summerPeakGW <= fleetGW &&
      peakShareOfFleet >= 0.1,
    detail: `summer midday solar peak ${summerPeakGW?.toFixed(2)} GW = ${(peakShareOfFleet * 100)?.toFixed(1)}% of the ${fleetGW} GW installed fleet (band: ${PEAK_MIN_GW} GW .. fleet, share >= 10%)`,
  };

  // Criterion 2: trailing-window solar sum, annualized.
  const trailingSolarGWh = energyGWh(trailing.envelope.data, "solar");
  const days = (now - trailingStart) / DAY_MS;
  const trailingSolarTWhAnnualized = (trailingSolarGWh / 1000) * (365 / days);
  report.figures.trailingSolarGWh = Math.round(trailingSolarGWh);
  report.figures.trailingSolarTWhAnnualized = Math.round(trailingSolarTWhAnnualized * 10) / 10;
  report.figures.trailingDays = Math.round(days);
  report.checks.trailingSolarBand = {
    pass: trailingSolarTWhAnnualized >= TRAILING_SOLAR_MIN_TWH && trailingSolarTWhAnnualized <= TRAILING_SOLAR_MAX_TWH,
    detail: `trailing ${Math.round(days)}-day solar ${Math.round(trailingSolarGWh)} GWh, annualized ${report.figures.trailingSolarTWhAnnualized} TWh/yr (band ${TRAILING_SOLAR_MIN_TWH}-${TRAILING_SOLAR_MAX_TWH} TWh/yr around the CBS-reported ~25 TWh/yr)`,
  };

  // Criterion 3: seasonality, summer day vs winter day solar energy.
  const summerDayGWh = energyGWh(summer.envelope.data, "solar");
  const winterDayGWh = energyGWh(winter.envelope.data, "solar");
  const seasonRatio = winterDayGWh > 0 ? summerDayGWh / winterDayGWh : null;
  report.figures.summerDaySolarGWh = Math.round(summerDayGWh);
  report.figures.winterDaySolarGWh = Math.round(winterDayGWh);
  report.figures.seasonRatio = seasonRatio != null ? Math.round(seasonRatio * 10) / 10 : null;
  report.checks.seasonality = {
    pass: seasonRatio != null && seasonRatio >= SEASON_RATIO_MIN,
    detail: `2026-06-15 solar ${Math.round(summerDayGWh)} GWh vs 2026-01-15 ${Math.round(winterDayGWh)} GWh, ratio ${report.figures.seasonRatio}x (pass: >= ${SEASON_RATIO_MIN}x)`,
  };

  // Supporting figures: load, latest ENTSO-E timestamp (publication lag).
  const trailingLoadGWh = energyGWh(trailing.envelope.data, "load");
  report.figures.trailingLoadTWhAnnualized = Math.round((trailingLoadGWh / 1000) * (365 / days) * 10) / 10;
  const lastTs = trailing.envelope.data.length ? trailing.envelope.data[trailing.envelope.data.length - 1].timestamp : null;
  report.figures.latestEntsoeTimestamp = lastTs;
  report.figures.entsoeLagHours = lastTs ? Math.round((now - Date.parse(lastTs)) / 3_600_000 * 10) / 10 : null;

  // Hour-by-hour UTC->CET/CEST alignment against the unchanged energy-charts
  // price series over the same trailing window.
  const priceStart = new Date(trailingStart).toISOString().slice(0, 10);
  const priceEnd = new Date(now).toISOString().slice(0, 10);
  const price = await fetchJsonPaced(ecUrl("/v2/price", { bzn: "NL", start: priceStart, end: priceEnd }), { label: "price trailing (alignment reference)" });
  const publicPower = await fetchJsonPaced(ecUrl("/v2/public_power", { country: "nl", start: priceStart, end: priceEnd }), { label: "public_power trailing (composition comparison)" });
  if (price.ok) {
    const priceSlots = bucketHours(price.json.data.map((r) => ({ timestamp: r.timestamp, values: { day_ahead_price: r.values?.day_ahead_price ?? null } })));
    const entsoeSlots = bucketHours(trailing.envelope.data.map((r) => ({ timestamp: r.timestamp, values: r.values })));
    try {
      const alignment = verifyHourAlignment([...entsoeSlots.keys()], [...priceSlots.keys()], { label: "trailing window" });
      report.figures.alignment = alignment;
      report.checks.alignment = {
        pass: true,
        detail: `${alignment.matched} ENTSO-E hour keys matched the unchanged price series, ${alignment.missing} reference hours beyond the ENTSO-E lag, ${alignment.extra} extra/misaligned keys`,
      };
      console.log(`  alignment: ${alignment.matched} ENTSO-E hour keys matched the price series, ${alignment.missing} reference hours not covered (lag), ${alignment.extra} misaligned`);
    } catch (error) {
      const msg = String(error?.message ?? error);
      report.figures.alignment = { error: msg };
      report.checks.alignment = { pass: false, detail: `alignment FAIL, UTC->CET/CEST hour keys do not line up with the price series: ${msg}` };
      console.error(`  alignment FAIL: ${msg}`);
    }
  } else {
    report.checks.alignment = { pass: false, detail: `alignment reference fetch failed (energy-charts price ok=${price.ok}: ${price.error?.message ?? price.error})` };
    console.error(`  alignment SKIPPED as FAIL: price reference fetch failed: ${price.error?.message ?? price.error}`);
  }

  // Renewable composition comparison: recompute the old energy-charts
  // renewable share of generation from its per-type feeds and compare with
  // both the served energy-charts share and the ENTSO-E share.
  if (publicPower.ok) {
    const renTypes = ["biomass", "waste", "wind_offshore", "wind_onshore", "solar"];
    const prodTypes = ["nuclear", "biomass", "fossil_hard_coal", "fossil_gas", "others", "waste", "wind_offshore", "wind_onshore", "solar"];
    const ecSlots = bucketHours(publicPower.json.data.map((r) => ({ timestamp: r.timestamp, values: r.values })));
    const entSlots = bucketHours(trailing.envelope.data.map((r) => ({ timestamp: r.timestamp, values: r.values })));
    let n = 0;
    let sumRecomputeErr = 0; // served share vs recomputed from per-type feeds
    let sumCrossErr = 0; // served energy-charts share vs ENTSO-E share
    for (const [k, slot] of ecSlots) {
      const served = slot.values.renewable_share_of_generation;
      const gen = prodTypes.reduce((s, t) => s + (slot.values[t] ?? 0), 0);
      const ren = renTypes.reduce((s, t) => s + (slot.values[t] ?? 0), 0);
      const ent = entSlots.get(k)?.values?.renewable_share_of_generation;
      if (served != null && gen > 0) {
        sumRecomputeErr += Math.abs((ren / gen) * 100 - served);
        n += 1;
        if (ent != null) sumCrossErr += Math.abs(ent - served);
      }
    }
    report.figures.composition = {
      hoursCompared: n,
      meanAbsErrRecomputedVsServedPctPoints: n ? Math.round((sumRecomputeErr / n) * 100) / 100 : null,
      meanAbsErrEntsoeVsEnergyChartsPctPoints: n ? Math.round((sumCrossErr / n) * 100) / 100 : null,
    };
    console.log(`  composition: recomputed-from-feeds vs served energy-charts share: mean abs err ${report.figures.composition.meanAbsErrRecomputedVsServedPctPoints} pct points over ${n} hours; ENTSO-E vs energy-charts share: mean abs err ${report.figures.composition.meanAbsErrEntsoeVsEnergyChartsPctPoints} pct points`);
  }

  // Appendix: the document pair named in the original change request
  // (A69/A01). The live API answers it with the wind-and-solar day-ahead
  // forecast (businessType A93/A94), so its figures are recorded for the
  // PR description but do not gate the backfill.
  {
    const asSpec = { note: "A69/A01 is the wind-and-solar day-ahead forecast, not actual generation per type (verified live)" };
    const summerDoc = await fetchEntsoe(
      { documentType: AS_SPECIFIED.DOC, processType: AS_SPECIFIED.PROCESS, periodStart: entsoeTs(SUMMER_DAY), periodEnd: entsoeTs(SUMMER_DAY + DAY_MS) },
      { fresh: true, label: "as-specified A69/A01 summer" },
    );
    if (summerDoc.ok) {
      const { records, psrTypes } = parseEntsoeIntervals(summerDoc.xml);
      const middaySolar = records.filter((r) => r.psrType === "B16" && new Date(r.timestamp).getUTCHours() >= 10 && new Date(r.timestamp).getUTCHours() < 15);
      asSpec.summerDayPsrTypes = psrTypes;
      asSpec.summerMiddaySolarPeakGW = middaySolar.length ? Math.round((Math.max(...middaySolar.map((r) => r.mw)) / 1000) * 100) / 100 : null;
      asSpec.summerDaySolarGWh = Math.round(records.filter((r) => r.psrType === "B16").reduce((s, r) => s + (r.mw * r.ms) / 3_600_000 / 1000, 0));
    }
    const trailStart = entsoeTs(trailingStart);
    const trailEnd = entsoeTs(now);
    const chunks = [];
    let cur = trailingStart;
    while (cur < now) {
      const yearEnd = Date.UTC(new Date(cur).getUTCFullYear() + 1, 0, 1);
      const end = Math.min(now, yearEnd);
      chunks.push({ periodStart: entsoeTs(cur), periodEnd: entsoeTs(end) });
      cur = end;
    }
    let solarGWh = 0;
    for (const c of chunks) {
      const doc = await fetchEntsoe({ documentType: AS_SPECIFIED.DOC, processType: AS_SPECIFIED.PROCESS, ...c }, { fresh: true, label: "as-specified A69/A01 trailing" });
      if (doc.ok) {
        const { records } = parseEntsoeIntervals(doc.xml);
        solarGWh += records.filter((r) => r.psrType === "B16").reduce((s, r) => s + (r.mw * r.ms) / 3_600_000 / 1000, 0);
      }
    }
    asSpec.trailingSolarGWh = Math.round(solarGWh);
    asSpec.trailingSolarTWhAnnualized = Math.round((solarGWh / 1000) * (365 / ((now - trailingStart) / DAY_MS)) * 10) / 10;
    report.figures.asSpecifiedA69A01 = asSpec;
    console.log("  as-specified A69/A01 appendix:", JSON.stringify(asSpec));
  }

  // Appendix 2: document/process and domain-parameter sweep for the summer
  // sample day, to map which combination returns one clean series per type.
  {
    const sweep = {};
    const variants = [
      ["A75", "A16", "in_Domain"],
      ["A75", "A16", "outBiddingZone_Domain"],
      ["A75", "A16", "inBiddingZone_Domain"],
      ["A75", "A16", "biddingZone_Domain"],
      ["A69", "A01", "in_Domain"],
      ["A69", "A01", "outBiddingZone_Domain"],
      ["A74", "A16", "in_Domain"],
      ["A74", "A16", "outBiddingZone_Domain"],
    ];
    for (const [doc, proc, domainParam] of variants) {
      const u = new URL("https://web-api.tp.entsoe.eu/api");
      u.searchParams.set("securityToken", process.env.ENTSOE_API_TOKEN ?? "");
      u.searchParams.set("documentType", doc);
      u.searchParams.set("processType", proc);
      u.searchParams.set(domainParam, "10YNL----------L");
      u.searchParams.set("periodStart", entsoeTs(SUMMER_DAY));
      u.searchParams.set("periodEnd", entsoeTs(SUMMER_DAY + DAY_MS));
      const r = await fetch(u, { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) {
        sweep[`${doc}/${proc}/${domainParam}`] = { status: r.status };
        continue;
      }
      const { records, psrTypes } = parseEntsoeIntervals(await r.text());
      const perPsr = {};
      for (const rec of records) {
        const psr = rec.psrType ?? "(none)";
        const a = perPsr[psr] ?? { n: 0, max: -Infinity };
        a.n += 1;
        a.max = Math.max(a.max, rec.mw);
        perPsr[psr] = a;
      }
      const solar = records.filter((x) => x.psrType === "B16" || x.psrType === "B20");
      const midday = solar.filter((x) => {
        const h = new Date(x.timestamp).getUTCHours();
        return h >= 10 && h < 15;
      });
      sweep[`${doc}/${proc}/${domainParam}`] = {
        status: r.status,
        psrTypes,
        seriesCount: psrTypes.length,
        recordsPerPsr: Object.fromEntries(Object.entries(perPsr).map(([k, v]) => [k, v.n])),
        b16b20MaxMW: midday.length ? Math.round(Math.max(...midday.map((x) => x.mw)) * 10) / 10 : null,
        b16b20DayGWh: Math.round(solar.reduce((s2, x) => s2 + (x.mw * x.ms) / 3_600_000 / 1000, 0)),
      };
    }
    report.figures.paramSweep = sweep;
    console.log("  parameter sweep:", JSON.stringify(sweep, null, 1));
  }

  // Appendix 3: where the NL solar volume lives in the actual per-type
  // document (A75/A16): per-psrType trailing-year energy and the summer-day
  // hourly profile of B16+B20 (diurnal shape check).
  {
    const perTypeTrail = {};
    const chunks = [];
    let cur = trailingStart;
    while (cur < now) {
      const yearEnd = Date.UTC(new Date(cur).getUTCFullYear() + 1, 0, 1);
      const end = Math.min(now, yearEnd);
      chunks.push({ periodStart: entsoeTs(cur), periodEnd: entsoeTs(end) });
      cur = end;
    }
    for (const c of chunks) {
      const doc = await fetchEntsoe({ documentType: DOC_GENERATION, ...c }, { fresh: true, label: "A75 trailing per-type" });
      if (!doc.ok) continue;
      const { records } = parseEntsoeIntervals(doc.xml);
      for (const r of records) {
        const psr = r.psrType ?? "(none)";
        const acc = perTypeTrail[psr] ?? { points: 0, maxMW: -Infinity, energyGWh: 0 };
        acc.points += 1;
        acc.maxMW = Math.max(acc.maxMW, r.mw);
        acc.energyGWh += (r.mw * r.ms) / 3_600_000 / 1000;
        perTypeTrail[psr] = acc;
      }
    }
    const perTypeTrailOut = {};
    for (const [psr, a] of Object.entries(perTypeTrail)) {
      perTypeTrailOut[psr] = {
        name: PSR_TYPES[psr]?.name ?? "UNMAPPED",
        points: a.points,
        maxMW: Math.round(a.maxMW * 10) / 10,
        energyGWh: Math.round(a.energyGWh),
        energyTWhAnnualized: Math.round((a.energyGWh / 1000) * (365 / ((now - trailingStart) / DAY_MS)) * 10) / 10,
      };
    }
    report.figures.perTypeTrailingYear = perTypeTrailOut;
    console.log("  per-type trailing year:", JSON.stringify(perTypeTrailOut, null, 1));

    // Double-count cross-check: the per-type trailing-year energies must
    // compose a plausible national total. NL annual generation is on the
    // order of 120-135 TWh, wind onshore (B19) roughly 16-17 TWh, wind
    // offshore (B18) roughly 15-16 TWh, and solar (B16 + B20) must land in
    // the probe band of 18-35 TWh annualized; solar near or above 40 TWh
    // means a double count persists.
    const ann = (gwh) => (gwh / 1000) * (365 / ((now - trailingStart) / DAY_MS));
    const twhOf = (psr) => ann(perTypeTrail[psr]?.energyGWh ?? 0);
    const totalTWh = ann(Object.values(perTypeTrail).reduce((s, a) => s + a.energyGWh, 0));
    const windOnshoreTWh = twhOf("B19");
    const windOffshoreTWh = twhOf("B18");
    const solarB16B20TWh = twhOf("B16") + twhOf("B20");
    const r1 = (x) => Math.round(x * 10) / 10;
    report.figures.doubleCountCrossCheck = {
      totalGenerationTWhAnnualized: r1(totalTWh),
      windOnshoreB19TWhAnnualized: r1(windOnshoreTWh),
      windOffshoreB18TWhAnnualized: r1(windOffshoreTWh),
      solarB16plusB20TWhAnnualized: r1(solarB16B20TWh),
      referenceBands: { total: "120-135 TWh/yr", windOnshore: "16-17 TWh/yr", windOffshore: "15-16 TWh/yr", solar: "18-35 TWh/yr (>= 40 means a double count persists)" },
    };
    report.checks.doubleCountCrossCheck = {
      pass: solarB16B20TWh < 40 && totalTWh > 0,
      detail: `trailing-year per-type energies annualize to total ${r1(totalTWh)} TWh (ref 120-135), wind onshore ${r1(windOnshoreTWh)} (ref 16-17), wind offshore ${r1(windOffshoreTWh)} (ref 15-16), solar B16+B20 ${r1(solarB16B20TWh)} TWh (probe band 18-35; >= 40 TWh means a double count persists)`,
    };
    console.log(`  double-count cross-check: ${JSON.stringify(report.figures.doubleCountCrossCheck)}`);

    // Summer-day hourly profile of B16 and B20 (UTC hours 8..18).
    const prof = { B16: {}, B20: {} };
    {
      const doc = await fetchEntsoe(
        { documentType: DOC_GENERATION, periodStart: entsoeTs(SUMMER_DAY), periodEnd: entsoeTs(SUMMER_DAY + DAY_MS) },
        { fresh: true, label: "A75 summer profile" },
      );
      if (doc.ok) {
        const { records } = parseEntsoeIntervals(doc.xml);
        for (const r of records) {
          if (r.psrType !== "B16" && r.psrType !== "B20") continue;
          const h = new Date(r.timestamp).getUTCHours();
          if (h < 6 || h > 20) continue;
          prof[r.psrType][h] = Math.round((prof[r.psrType][h] ?? 0) + r.mw * (r.ms / 3_600_000));
        }
      }
    }
    report.figures.b16b20SummerProfileMW = prof;
    console.log("  B16/B20 summer-day hourly MW:", JSON.stringify(prof));

    // Duplicate/overlap check: same (timestamp, psrType) appearing more than
    // once would double-count energy, so compare summed vs unique-ts energy.
    {
      const doc = await fetchEntsoe(
        { documentType: DOC_GENERATION, periodStart: entsoeTs(SUMMER_DAY), periodEnd: entsoeTs(SUMMER_DAY + DAY_MS) },
        { fresh: true, label: "A75 summer dup check" },
      );
      const dup = {};
      if (doc.ok) {
        const { records } = parseEntsoeIntervals(doc.xml);
        const byPsrTs = new Map();
        for (const r of records) {
          const key = `${r.psrType}|${r.timestamp}`;
          const acc = byPsrTs.get(key) ?? { n: 0, sum: 0 };
          acc.n += 1;
          acc.sum += r.mw * (r.ms / 3_600_000);
          byPsrTs.set(key, acc);
        }
        const perPsr = new Map();
        for (const [key, acc] of byPsrTs) {
          const psr = key.split("|")[0];
          const p = perPsr.get(psr) ?? { ts: 0, dups: 0, energyAll: 0 };
          p.ts += 1;
          p.dups += acc.n - 1;
          p.energyAll += acc.sum;
          perPsr.set(psr, p);
        }
        for (const [psr, p] of perPsr) {
          const allRecords = records.filter((r) => r.psrType === psr);
          dup[psr] = {
            name: PSR_TYPES[psr]?.name ?? "UNMAPPED",
            records: allRecords.length,
            uniqueTs: p.ts,
            duplicateRecords: p.dups,
            energyMWhAll: Math.round(p.energyAll * 1000),
          };
        }
      }
      report.figures.duplicateCheckSummerDay = dup;
      console.log("  duplicate check (summer day):", JSON.stringify(dup, null, 1));

      // Raw period structure: every Period of every TimeSeries with its
      // resolution string, point count and interval, to see where the
      // duplicate/huge-ms records come from.
      {
        const { XMLParser } = await import("fast-xml-parser");
        const p = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@_",
          isArray: (name) => name === "TimeSeries" || name === "timeSeries" || name === "Period" || name === "Point",
          parseTagValue: false,
          trimValues: true,
        });
        const parsedDoc = p.parse(doc.xml);
        const seriesList = [
          ...(parsedDoc?.GL_MarketDocument?.TimeSeries ?? []),
          ...(parsedDoc?.GL_MarketDocument?.timeSeries ?? []),
          ...Object.values(parsedDoc ?? {}).flatMap((v) => (v?.TimeSeries ?? [])),
        ];
        const struct = seriesList.map((ts) => ({
          psr: ts.MktPSRType?.psrType ?? ts.MktPSRType?.["@_psrType"] ?? ts.psrType ?? null,
          mRID: ts.mRID,
          docStatus: ts.docStatus?.value ?? ts.docStatus ?? null,
          revisionNumber: ts.revisionNumber ?? null,
          periods: (ts.Period ?? []).map((per) => ({
            resolution: per.resolution ?? per["@_resolution"] ?? null,
            points: (per.Point ?? []).length,
            start: per.timeInterval?.start ?? per.timeInterval?.["@_start"] ?? null,
            end: per.timeInterval?.end ?? per.timeInterval?.["@_end"] ?? null,
            firstPositions: (per.Point ?? []).slice(0, 3).map((pt) => pt["@_position"] ?? pt.position),
            lastPositions: (per.Point ?? []).slice(-3).map((pt) => pt["@_position"] ?? pt.position),
          })),
        }));
        report.figures.periodStructure = struct;
        console.log("  period structure:", JSON.stringify(struct));

        // Sample the B16/B20 point values per timestamp across ALL
        // TimeSeries copies, to see which copy carries the diurnal bell.
        const samples = {};
        {
          const { records } = parseEntsoeIntervals(doc.xml);
          for (const r of records) {
            if (r.psrType !== "B16" && r.psrType !== "B20") continue;
            const h = new Date(r.timestamp).getUTCHours();
            if (h < 10 || h > 16) continue;
            const key = `${r.psrType} ${String(h).padStart(2, "0")}:00Z`;
            samples[key] = [...(samples[key] ?? []), Math.round(r.mw)];
          }
        }
        report.figures.b16b20Samples = samples;
        console.log("  B16/B20 samples per UTC hour:", JSON.stringify(samples));

        // Exact-timestamp duplicate values for a few midday slots.
        const exact = {};
        {
          const { records } = parseEntsoeIntervals(doc.xml);
          for (const ts of ["2026-06-15T12:00:00.000Z", "2026-06-15T13:00:00.000Z", "2026-06-15T14:00:00.000Z", "2026-06-15T02:00:00.000Z"]) {
            for (const psr of ["B16", "B20", "B04"]) {
              const vals = records.filter((r) => r.psrType === psr && r.timestamp === ts).map((r) => Math.round(r.mw * 100) / 100);
              if (vals.length) exact[`${psr}@${ts}`] = vals;
            }
          }
        }
        report.figures.exactDuplicates = exact;
        console.log("  exact-timestamp duplicate values:", JSON.stringify(exact));

        // Raw XML of the B16 and B20 TimeSeries segments (response bodies
        // never contain the token).
        const xmlStr = String(doc.xml ?? "");
        for (const psr of ["B16", "B20"]) {
          const idx = xmlStr.indexOf(`<psrType>${psr}</psrType>`);
          if (idx >= 0) {
            const start = Math.max(0, xmlStr.lastIndexOf("<TimeSeries>", idx));
            const end = xmlStr.indexOf("</TimeSeries>", idx);
            const seg = xmlStr.slice(start, Math.min(end + 13, start + 3500));
            report.figures[`rawXml_${psr}`] = seg;
            console.log(`  raw XML ${psr} segment:\n${seg}`);
          }
        }
      }
    }
  }

  // Print the full report (figures only; the token is never printed).
  console.log("\n=== ENTSO-E NL probe report ===");
  console.log(JSON.stringify(report, null, 2));
  const failed = Object.entries(report.checks).filter(([, c]) => !c.pass);
  for (const [name, c] of Object.entries(report.checks)) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${name}: ${c.detail}`);
  }
  await mkdir(path.join(HERE, ".cache"), { recursive: true });
  await writeFile(path.join(HERE, ".cache", `entsoe-probe-${report.probedAt.slice(0, 10)}.json`), JSON.stringify(report, null, 2), "utf8");
  if (failed.length > 0) {
    console.error(`\nProbe gate FAILED (${failed.length} criterion/criteria). Do not proceed to the backfill; record these figures in the PR description.`);
    process.exit(1);
  }
  console.log("\nProbe gate PASSED: all criteria met.");
}

main().catch((error) => {
  console.error(`Probe aborted: ${error?.message ?? error}`);
  process.exit(1);
});
