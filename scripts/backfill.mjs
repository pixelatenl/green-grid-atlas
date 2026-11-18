/*
  Backfill (ONE-TIME, run locally, on the mini PC or via the one-off
  entsoe-backfill workflow in Actions, never scheduled):

    node --experimental-strip-types scripts/backfill.mjs

  Fetches, politely paced and chunked per year (see scripts/lib-fetch.mjs,
  scripts/lib-entsoe.mjs and docs/data-notes.md), the full 2015-to-present
  NL history: day-ahead price and per-neighbor flows from
  energy-charts.info v2, hourly weather from Open-Meteo, and generation per
  production type (A75) plus actual total load (A65) from the ENTSO-E
  Transparency Platform for the NL bidding zone 10YNL----------L (the
  energy-charts NL solar series is defective; see docs/data-notes.md
  section 6). ENTSO-E timestamps are UTC and are converted to
  Europe/Amsterdam through the shared slot keying; the build verifies the
  conversion hour-by-hour against the unchanged energy-charts price series
  before anything is written. Writes ONLY aggregates into
  public/data/snapshot.json: per-year hour x month composites, per-year
  flow volumes, the records set, and the trailing-12-month window. Raw
  history is never stored in the repo beyond what the page renders.
  Results are disk-cached, so re-runs are cheap. An existing snapshot's
  non-NL zone scores and narration are preserved.
*/

import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecUrl, fetchJsonPaced, fetchOpenMeteo } from "./lib-fetch.mjs";
import { fetchNlPowerEnvelope, verifyHourAlignment } from "./lib-entsoe.mjs";
import {
  ZONE,
  SOURCES,
  ENTSOE_ENDPOINTS,
  WEATHER_POINT,
  TRAILING_MONTHS,
  attachWeather,
  buildCompositesForYear,
  buildFlowVolumes,
  daysToTrailing,
  recordsFromSamples,
  samplesFromDays,
  slotsFromEnvelopes,
  windowFromSamples,
  riskFromSamples,
  profilesFromSamples,
  computeScore,
  dailyRenewableShareOfLoadFromSlots,
  EMISSION_FACTORS_VERSION,
  TZ,
} from "./lib-snapshot.mjs";
import { bucketDays, bucketHours } from "../src/grid/hourly.ts";
import { dayKey } from "../src/grid/amsterdam-time.ts";
import { WINDOW_RULE_TEXT } from "../src/grid/green-window.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "data", "snapshot.json");

const FIRST_YEAR = 2015;
const now = new Date();
const LAST_YEAR = now.getUTCFullYear();
const DAY_MS = 86_400_000;

async function fetchYear(year) {
  const start = `${year}-01-01`;
  // Rolling fetch end is the Amsterdam-local date: the ENTSO-E fetch runs to the instant now, and between 00:00 and 01:00 local (00:00 to 02:00 in summer) the local date is already ahead of the UTC date (run 44199925847 failed on the UTC variant).
  const end = year === LAST_YEAR ? dayKey(now.getTime()) : `${year}-12-31`;
  // One request at a time, per the pacing rule; never concurrent.
  const price = await fetchJsonPaced(ecUrl("/v2/price", { bzn: "NL", start, end }), { label: `price ${year}` });
  const cbpf = await fetchJsonPaced(ecUrl("/v2/cbpf", { country: ZONE, start, end }), { label: `cbpf ${year}` });
  const weather = await fetchOpenMeteo(
    {
      latitude: WEATHER_POINT.latitude,
      longitude: WEATHER_POINT.longitude,
      start_date: start,
      end_date: end,
      hourly: "wind_speed_10m,shortwave_radiation,temperature_2m",
      timezone: "Europe/Amsterdam",
    },
    { label: `open-meteo ${year}` },
  );
  // ENTSO-E A75 + A65 for the same span, chunked by year at most (the API
  // maximum window). UTC-year windows; slots merge by local hour key, so
  // the +01:00 boundary hour lands in the right local day either way.
  const entsoeStart = Date.UTC(year, 0, 1);
  const entsoeEnd = year === LAST_YEAR ? now.getTime() : Date.UTC(year + 1, 0, 1);
  const entsoe = await fetchNlPowerEnvelope(entsoeStart, entsoeEnd, { label: `entsoe ${year}` });
  return { price, cbpf, weather, entsoe };
}

async function main() {
  console.log(`Backfill ${FIRST_YEAR}..${LAST_YEAR} for ${ZONE}, writing ${OUT}`);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    // no previous snapshot: full rebuild from scratch
  }
  const allSlots = new Map();
  const allPriceKeys = new Set();
  const allEntsoeKeys = new Set();
  const composites = [];
  const flowVolumes = [];
  let failures = 0;

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const { price, cbpf, weather, entsoe } = await fetchYear(year);
    for (const [name, r] of [["price", price], ["cbpf", cbpf], ["weather", weather], ["entsoe", entsoe]]) {
      if (!r.ok) {
        failures += 1;
        console.warn(`  ${name} ${year} FAILED: ${r.error?.message ?? r.error} (continuing; aggregates will have a gap)`);
      }
    }
    const slots = attachWeather(
      slotsFromEnvelopes({
        priceEnv: price.ok ? price.json : { data: [] },
        powerEnv: entsoe.ok ? entsoe.envelope : { data: [] },
        cbpfEnv: cbpf.ok ? cbpf.json : { data: [] },
      }),
      weather.ok ? weather.json : null,
    );
    for (const [k, v] of slots) allSlots.set(k, v);
    if (price.ok) {
      for (const k of bucketHours(price.json.data.map((r) => ({ timestamp: r.timestamp, values: { p: r.values?.day_ahead_price ?? null } }))).keys()) {
        allPriceKeys.add(k);
      }
    }
    if (entsoe.ok) {
      for (const k of bucketHours(entsoe.envelope.data.map((r) => ({ timestamp: r.timestamp, values: r.values }))).keys()) {
        allEntsoeKeys.add(k);
      }
    }
    const days = bucketDays([...slots.values()]).filter((d) => d.date.startsWith(String(year)));
    if (days.length) {
      composites.push({ year, series: buildCompositesForYear(days) });
      flowVolumes.push({ year, neighbors: buildFlowVolumes(days) });
    }
    console.log(`  year ${year}: ${days.length} days, ${slots.size} slots`);
  }

  // Verify the ENTSO-E UTC -> Europe/Amsterdam conversion hour-by-hour
  // against the unchanged energy-charts price series before writing
  // anything: every ENTSO-E hour key must exist in the price series.
  const alignment = verifyHourAlignment([...allEntsoeKeys], [...allPriceKeys], { label: "full history" });
  console.log(`  alignment: ${alignment.matched} ENTSO-E hour keys matched the price series, ${alignment.missing} price-only hours (lag/gaps), ${alignment.extra} misaligned`);

  // Trailing window: last TRAILING_MONTHS of Amsterdam-local days.
  const allDays = bucketDays([...allSlots.values()]);
  const cutoffDate = new Date(now.getTime() - TRAILING_MONTHS * 31 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const trailingDays = allDays.filter((d) => d.date >= cutoffDate);
  const trailing = daysToTrailing(trailingDays);

  // Records over the full history.
  const samples = samplesFromDays(allDays);
  const records = recordsFromSamples(samples);

  // Derived: green window, risk, profiles over the trailing window.
  const window = windowFromSamples(samples, 30);
  const risk = riskFromSamples(samples, window);
  const profiles = profilesFromSamples(samples, 30);

  // Next-day prices (widget); may 404 before ~13:00 CET (non-critical).
  const nextDay = await fetchJsonPaced(ecUrl("/v2/price_next_day", { bzn: "NL" }), {
    label: "price_next_day",
    fresh: true,
  });

  // NL score from the ENTSO-E per-type data: daily renewable share of load,
  // trailing 365 days (same daily-average definition the energy-charts
  // ren_share_daily_avg feed uses for the other zones). The other zones
  // keep their existing energy-charts scores untouched.
  const nlDailyShares = dailyRenewableShareOfLoadFromSlots([...allSlots.values()], { daysBack: 365, now: now.getTime() });
  const nlScore = computeScore(ZONE, nlDailyShares);
  console.log(`  NL score from ENTSO-E: mean ${nlScore.meanSharePct}% over ${nlScore.days} days, score ${nlScore.score}`);

  const retrievedAt = new Date().toISOString();
  const previousCountries = previous?.scores?.countries ?? [];
  const countries = [...previousCountries];
  const idx = countries.findIndex((c) => c.country === ZONE);
  if (idx >= 0) countries[idx] = nlScore;
  else countries.push(nlScore);
  countries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const snapshot = {
    schemaVersion: 1,
    zone: ZONE,
    timezone: TZ,
    retrievedAt,
    emissionFactorsVersion: EMISSION_FACTORS_VERSION,
    sources: {
      ...SOURCES,
      entsoe: { ...SOURCES.entsoe, retrievedAt },
      retrievedAt,
      endpoints: {
        price: "/v2/price?bzn=NL",
        cbpf: "/v2/cbpf?country=nl",
        priceNextDay: "/v2/price_next_day?bzn=NL",
        renShareDailyAvg: "/v2/ren_share_daily_avg?country=<zone>&year=-1 (all zones except nl)",
        ...ENTSOE_ENDPOINTS,
      },
    },
    weather: {
      available: true,
      point: WEATHER_POINT,
      note: "Open-Meteo emits 24 local-hour labels per calendar day even on DST switch days; the overlay joins on (local date, local hour) and never fabricates a 25th hour.",
    },
    trailing: {
      from: trailing.length ? trailing[0].date : null,
      to: trailing.length ? trailing[trailing.length - 1].date : null,
      days: trailing,
    },
    nextDay: nextDay.ok
      ? {
          deliveryDate: nextDay.json.attributes?.delivery_date ?? null,
          resolution: nextDay.json.resolution ?? "PT15M",
          price15m: (nextDay.json.data ?? []).map((r) => r.values?.day_ahead_price ?? null),
        }
      : null,
    composites: { years: composites },
    flowVolumes: { years: flowVolumes },
    records,
    greenWindow: { ...window, rule: WINDOW_RULE_TEXT },
    risk: { indicators: risk, note: "Indicators derived from open data; not a grid-security assessment." },
    derived: { profiles30d: profiles },
    scores: {
      retrievedAt,
      basis:
        "renewable share of load, trailing 365 days, daily averages; nl from ENTSO-E Transparency Platform per-type data (A75/A65, processType A16, bidding zone 10YNL----------L), all other zones from energy-charts.info /v2/ren_share_daily_avg",
      composition: "score = 0.5 x mean daily renewable share of load + 0.5 x share of days with renewable share >= 50% (scaled to 0-100)",
      countries,
    },
    narration: previous?.narration ?? { signatures: {}, visuals: {} },
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  await writeFile(tmp, JSON.stringify(snapshot), "utf8");
  await rename(tmp, OUT);
  const kb = Math.round((await stat(OUT)).size / 1024);
  console.log(`Wrote ${OUT} (${kb} KB), ${failures} failed fetches, ${samples.length} hourly samples, ${records.length} records, ${countries.length} zone scores`);
  if (failures > 0) {
    console.warn("Some fetches failed; re-run the backfill (cache makes it cheap) to fill gaps.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
