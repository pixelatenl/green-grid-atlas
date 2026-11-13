/*
  Daily snapshot run (cron 12:35 UTC — lands after the day-ahead publication
  around 13:00 CET in both DST states):

    node --experimental-strip-types scripts/snapshot.mjs

  Fetches yesterday complete, today partial, and price_next_day (published
  around 13:00 CET); updates the rolling trailing-12-month aggregates,
  records, derived indicators (green window, red hours, risk, profiles) and
  the score summaries. NL refreshes daily; the ~38-zone European card
  refreshes on the first run of each ISO week. Narration is signature-gated
  and fails soft without MISTRAL_API_KEY. Every fetch retries with backoff
  and is paced one-at-a-time (scripts/lib-fetch.mjs); a failed non-critical
  fetch degrades gracefully and never fails the run.

  Requires a prior backfill (public/data/snapshot.json must exist).
*/

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecUrl, fetchJsonPaced, fetchOpenMeteo } from "./lib-fetch.mjs";
import {
  ZONE,
  TZ,
  WEATHER_POINT,
  TRAILING_MONTHS,
  buildTrailingDays,
  mergeRecords,
  recordsFromSamples,
  samplesFromDays,
  windowFromSamples,
  riskFromSamples,
  profilesFromSamples,
  computeScore,
  slotsFromEnvelopes,
} from "./lib-snapshot.mjs";
import { bucketDays } from "../src/grid/hourly.ts";
import { dayHourSequence, slotUtc } from "../src/grid/amsterdam-time.ts";
import { WINDOW_RULE_TEXT } from "../src/grid/green-window.ts";
import { EUROPE_COUNTRIES } from "../src/grid/scores.ts";
import { narrate } from "./narrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "data", "snapshot.json");
const ROLLING_DAYS = 45; // covers yesterday complete + today partial with margin

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date - firstThursday) / (7 * 86_400_000));
}

/** Rebuild hourly samples from the stored trailing days (rounded values = what the page renders). */
function samplesFromStoredTrailing(trailing) {
  const samples = [];
  for (const day of trailing.days) {
    const seq = dayHourSequence(day.dst);
    day.price.forEach((price, i) => {
      const utc = slotUtc(day.date, day.dst, i);
      samples.push({
        timestamp: new Date(utc).toISOString(),
        utc,
        date: day.date,
        hour: seq[i] ?? i,
        price: price ?? null,
        residualLoad: day.residual?.[i] ?? null,
        netImport: day.netImport?.[i] ?? null,
        renShareGen: day.ren?.[i] ?? null,
        intensity: day.intensity?.[i] ?? null,
        load: day.load?.[i] ?? null,
        windSolarMW: day.windMW != null || day.solarMW != null ? (day.windMW?.[i] ?? 0) + (day.solarMW?.[i] ?? 0) : null,
        mix: null,
      });
    });
  }
  samples.sort((a, b) => a.utc - b.utc);
  return samples;
}

async function main() {
  const previous = JSON.parse(await readFile(OUT, "utf8"));
  const now = new Date();
  const retrievedAt = now.toISOString();
  console.log(`Snapshot run for ${ZONE} at ${retrievedAt}`);

  const startDate = new Date(now.getTime() - ROLLING_DAYS * 86_400_000).toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);

  // One request at a time, fresh (no cache) for the rolling window.
  const price = await fetchJsonPaced(ecUrl("/v2/price", { bzn: "NL", start: startDate, end: endDate }), { label: "price rolling", fresh: true });
  const power = await fetchJsonPaced(ecUrl("/v2/public_power", { country: ZONE, start: startDate, end: endDate }), { label: "public_power rolling", fresh: true });
  const cbpf = await fetchJsonPaced(ecUrl("/v2/cbpf", { country: ZONE, start: startDate, end: endDate }), { label: "cbpf rolling", fresh: true });
  const nextDay = await fetchJsonPaced(ecUrl("/v2/price_next_day", { bzn: "NL" }), { label: "price_next_day", fresh: true });
  const weather = await fetchOpenMeteo(
    {
      latitude: WEATHER_POINT.latitude,
      longitude: WEATHER_POINT.longitude,
      start_date: startDate,
      end_date: endDate,
      hourly: "wind_speed_10m,shortwave_radiation,temperature_2m",
      timezone: "Europe/Amsterdam",
    },
    { label: "open-meteo rolling", fresh: true },
  );

  const criticalOk = price.ok && power.ok && cbpf.ok;
  if (!criticalOk) {
    console.error("Critical fetch failed (price/public_power/cbpf); keeping the previous snapshot untouched.");
    process.exitCode = 1;
    return;
  }

  // Merge: fresh rolling days replace stored days with the same date.
  const freshDays = buildTrailingDays({
    priceEnv: price.json,
    powerEnv: power.json,
    cbpfEnv: cbpf.json,
    weatherEnv: weather.ok ? weather.json : null,
  });
  const byDate = new Map((previous.trailing?.days ?? []).map((d) => [d.date, d]));
  for (const d of freshDays) byDate.set(d.date, d);
  const cutoffDate = new Date(now.getTime() - TRAILING_MONTHS * 31 * 86_400_000).toISOString().slice(0, 10);
  const days = [...byDate.values()].filter((d) => d.date >= cutoffDate).sort((a, b) => (a.date < b.date ? -1 : 1));
  const trailing = { from: days[0]?.date ?? null, to: days[days.length - 1]?.date ?? null, days };

  // Derived from the merged trailing window (same code path as the page).
  const samples = samplesFromStoredTrailing(trailing);
  const window = windowFromSamples(samples, 30);
  const risk = riskFromSamples(samples, window);
  const profiles = profilesFromSamples(samples, 30);

  // Records: keep the backfill's full-history records, merge new candidates
  // from the rolling window (raw, unrounded) when power/cbpf are fresh.
  let records = previous.records ?? [];
  if (power.ok && cbpf.ok) {
    const slots = slotsFromEnvelopes({ priceEnv: price.json, powerEnv: power.json, cbpfEnv: cbpf.json });
    const rollingDays = bucketDays([...slots.values()]);
    const rollingSamples = samplesFromDays(rollingDays);
    records = mergeRecords(records, recordsFromSamples(rollingSamples));
  }

  // Scores: NL daily; all zones on the first run of each ISO week.
  const renAvgNl = await fetchJsonPaced(ecUrl("/v2/ren_share_daily_avg", { country: ZONE, year: "-1" }), { label: "ren_share_daily_avg nl", fresh: true });
  let scores = previous.scores ?? { retrievedAt, basis: "", composition: "", countries: [] };
  const weekNow = `${now.getUTCFullYear()}-W${String(isoWeek(now)).padStart(2, "0")}`;
  const weekPrev = scores.retrievedAt ? `${new Date(scores.retrievedAt).getUTCFullYear()}-W${String(isoWeek(new Date(scores.retrievedAt))).padStart(2, "0")}` : null;
  const refreshAll = weekNow !== weekPrev || process.env.GG_REFRESH_ALL_SCORES === "1";
  const countries = [...(scores.countries ?? [])];
  const upsert = (s) => {
    const i = countries.findIndex((c) => c.country === s.country);
    if (i >= 0) countries[i] = s;
    else countries.push(s);
  };
  if (renAvgNl.ok) {
    upsert(computeScore(ZONE, renAvgNl.json.data?.map((r) => r.values?.daily_avg_share ?? null) ?? []));
  }
  if (refreshAll) {
    console.log("  first run of the week: refreshing all zone scores");
    for (const c of EUROPE_COUNTRIES) {
      if (c === ZONE) continue;
      const r = await fetchJsonPaced(ecUrl("/v2/ren_share_daily_avg", { country: c, year: "-1" }), { label: `ren_share_daily_avg ${c}`, fresh: true });
      if (r.ok) upsert(computeScore(c, r.json.data?.map((x) => x.values?.daily_avg_share ?? null) ?? []));
      else console.warn(`  score ${c} failed: ${r.error?.message ?? r.error}`);
    }
  }
  countries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  scores = { ...scores, retrievedAt, countries };

  const snapshot = {
    ...previous,
    retrievedAt,
    sources: { ...previous.sources, retrievedAt },
    trailing,
    nextDay: nextDay.ok
      ? {
          deliveryDate: nextDay.json.attributes?.delivery_date ?? null,
          resolution: nextDay.json.resolution ?? "PT15M",
          price15m: (nextDay.json.data ?? []).map((r) => r.values?.day_ahead_price ?? null),
        }
      : previous.nextDay ?? null,
    records,
    greenWindow: { ...window, rule: WINDOW_RULE_TEXT },
    risk: { ...previous.risk, indicators: risk },
    derived: { profiles30d: profiles },
    scores,
    weather: previous.weather ?? { available: false },
  };

  // Narration (signature-gated, fail-soft; needs MISTRAL_API_KEY).
  snapshot.narration = await narrate(snapshot);

  await mkdir(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  await writeFile(tmp, JSON.stringify(snapshot), "utf8");
  await rename(tmp, OUT);
  const { stat } = await import("node:fs/promises");
  const kb = Math.round((await stat(OUT)).size / 1024);
  console.log(`Wrote ${OUT} (${kb} KB): ${days.length} trailing days, ${records.length} records, ${countries.length} zone scores`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
