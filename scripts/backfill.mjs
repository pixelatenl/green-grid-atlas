/*
  Backfill (ONE-TIME, run locally or on the mini PC — never in CI):

    node --experimental-strip-types scripts/backfill.mjs

  Fetches, politely paced and chunked per year (see scripts/lib-fetch.mjs
  and docs/data-notes.md), the full 2015-to-present NL history from
  energy-charts.info v2 — price (hourly), public_power (hourly historical),
  cbpf (per-neighbor flows) — plus Open-Meteo hourly weather for the same
  span. Writes ONLY aggregates into public/data/snapshot.json: per-year
  hour x month composites, per-year flow volumes, the records set, and the
  trailing-12-month window. Raw history is never stored in the repo beyond
  what the page renders. Results are disk-cached, so re-runs are cheap.
*/

import { writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecUrl, fetchJsonPaced, fetchOpenMeteo } from "./lib-fetch.mjs";
import {
  ZONE,
  SOURCES,
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
  EMISSION_FACTORS_VERSION,
  TZ,
} from "./lib-snapshot.mjs";
import { bucketDays } from "../src/grid/hourly.ts";
import { WINDOW_RULE_TEXT } from "../src/grid/green-window.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "data", "snapshot.json");

const FIRST_YEAR = 2015;
const now = new Date();
const LAST_YEAR = now.getUTCFullYear();

async function fetchYear(year) {
  const start = `${year}-01-01`;
  const end = year === LAST_YEAR ? `${now.toISOString().slice(0, 10)}` : `${year}-12-31`;
  // One request at a time, per the pacing rule — never concurrent.
  const price = await fetchJsonPaced(ecUrl("/v2/price", { bzn: "NL", start, end }), { label: `price ${year}` });
  const power = await fetchJsonPaced(ecUrl("/v2/public_power", { country: ZONE, start, end }), { label: `public_power ${year}` });
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
  return { price, power, cbpf, weather };
}

async function main() {
  console.log(`Backfill ${FIRST_YEAR}..${LAST_YEAR} for ${ZONE}, writing ${OUT}`);
  const allSlots = new Map();
  const composites = [];
  const flowVolumes = [];
  let failures = 0;

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const { price, power, cbpf, weather } = await fetchYear(year);
    for (const [name, r] of [["price", price], ["public_power", power], ["cbpf", cbpf], ["weather", weather]]) {
      if (!r.ok) {
        failures += 1;
        console.warn(`  ${name} ${year} FAILED: ${r.error?.message ?? r.error} (continuing; aggregates will have a gap)`);
      }
    }
    const slots = attachWeather(
      slotsFromEnvelopes({
        priceEnv: price.ok ? price.json : { data: [] },
        powerEnv: power.ok ? power.json : { data: [] },
        cbpfEnv: cbpf.ok ? cbpf.json : { data: [] },
      }),
      weather.ok ? weather.json : null,
    );
    for (const [k, v] of slots) allSlots.set(k, v);
    const days = bucketDays([...slots.values()]).filter((d) => d.date.startsWith(String(year)));
    if (days.length) {
      composites.push({ year, series: buildCompositesForYear(days) });
      flowVolumes.push({ year, neighbors: buildFlowVolumes(days) });
    }
    console.log(`  year ${year}: ${days.length} days, ${slots.size} slots`);
  }

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

  // Next-day prices (widget); may 404 before ~13:00 CET — non-critical.
  const nextDay = await fetchJsonPaced(ecUrl("/v2/price_next_day", { bzn: "NL" }), {
    label: "price_next_day",
    fresh: true,
  });

  // NL score (daily-refresh component; the full European set is snapshot.mjs's weekly job).
  const renAvg = await fetchJsonPaced(ecUrl("/v2/ren_share_daily_avg", { country: ZONE, year: "-1" }), {
    label: "ren_share_daily_avg nl",
    fresh: true,
  });
  const nlScore = renAvg.ok
    ? computeScore(ZONE, renAvg.json.data?.map((r) => r.values?.daily_avg_share ?? null) ?? [])
    : computeScore(ZONE, []);

  const retrievedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    zone: ZONE,
    timezone: TZ,
    retrievedAt,
    emissionFactorsVersion: EMISSION_FACTORS_VERSION,
    sources: {
      ...SOURCES,
      retrievedAt,
      endpoints: {
        price: "/v2/price?bzn=NL",
        publicPower: "/v2/public_power?country=nl",
        cbpf: "/v2/cbpf?country=nl",
        priceNextDay: "/v2/price_next_day?bzn=NL",
        renShareDailyAvg: "/v2/ren_share_daily_avg?country=<zone>&year=-1",
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
      basis: "renewable share of load, trailing 365 days, daily averages (energy-charts.info /v2/ren_share_daily_avg)",
      composition: "score = 0.5 x mean daily renewable share of load + 0.5 x share of days with renewable share >= 50% (scaled to 0-100)",
      countries: [nlScore],
    },
    narration: { signatures: {}, visuals: {} },
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot), "utf8");
  const kb = Math.round((await stat(OUT)).size / 1024);
  console.log(`Wrote ${OUT} (${kb} KB), ${failures} failed fetches, ${samples.length} hourly samples, ${records.length} records`);
  if (failures > 0) {
    console.warn("Some fetches failed; re-run the backfill (cache makes it cheap) to fill gaps.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
