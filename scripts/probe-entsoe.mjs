/*
  Probe gate for the ENTSO-E NL substitution (Phase 1, one-off, runs in
  Actions with the ENTSOE_API_TOKEN secret available — never part of the
  daily snapshot job):

    node --experimental-strip-types scripts/probe-entsoe.mjs

  Fetches A69 (generation per type) and A65 (actual total load) for the NL
  bidding zone 10YNL----------L for one summer sample day (2026-06-15), one
  winter sample day (2026-01-15) and the trailing 365-day window, then
  evaluates the three acceptance criteria:

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
    console.error("ENTSO-E fetch failed for a probe window; see warnings above.");
  }
  report.figures.psrTypesSeen = trailing.psrTypes.map((c) => `${c} (${PSR_TYPES[c]?.name ?? "UNMAPPED"})`);

  const solarRecords = (env) => env.envelope.data.filter((r) => r.values.solar != null);

  // Per-psrType detail of the summer-day A69 document, plus an alternative
  // query shape (inBiddingZone_Domain) to compare what the API returns.
  const perType = {};
  {
    const w = { periodStart: entsoeTs(SUMMER_DAY), periodEnd: entsoeTs(SUMMER_DAY + DAY_MS) };
    const raw = await fetchEntsoe({ documentType: DOC_GENERATION, ...w }, { fresh: true, label: "A69 detail summer" });
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
  console.log("  per-type detail (summer day A69):", JSON.stringify(perType, null, 1));

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
    const alignment = verifyHourAlignment([...entsoeSlots.keys()], [...priceSlots.keys()], { label: "trailing window" });
    report.figures.alignment = alignment;
    console.log(`  alignment: ${alignment.matched} ENTSO-E hour keys matched the price series, ${alignment.missing} reference hours not covered (lag), ${alignment.extra} misaligned`);
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
  console.error(error);
  process.exit(1);
});
