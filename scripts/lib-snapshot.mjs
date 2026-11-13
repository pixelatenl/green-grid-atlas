/*
  Snapshot assembly shared by backfill.mjs and snapshot.mjs. Pure
  aggregation: turns fetched energy-charts / Open-Meteo envelopes into the
  committed snapshot structure (public/data/snapshot.json) using the shared
  rule modules in src/grid (same code path as the page renderer).
*/

import { computeWindow, isRedHour } from "../src/grid/green-window.ts";
import { EMISSION_FACTORS_VERSION, PRODUCTION_TYPES } from "../src/grid/emission-factors.ts";
import { computedIntensityGPerKWh } from "../src/grid/intensity.ts";
import { bucketDays, bucketHours, roundForStorage } from "../src/grid/hourly.ts";
import { amsterdamLocal, dayKey, parseTs } from "../src/grid/amsterdam-time.ts";
import { computeRecords, dunkelflauteOfDay, mergeRecords } from "../src/grid/records.ts";
import { computeRiskIndicators } from "../src/grid/risk.ts";
import { computeScore } from "../src/grid/scores.ts";

export const ZONE = "nl";
export const TZ = "Europe/Amsterdam";
export const NEIGHBORS = ["belgium", "denmark", "germany", "norway", "united_kingdom"];
export const TRAILING_MONTHS = 12;
export const FLOW_SERIES = [...NEIGHBORS, "sum"];

/* ---------------- source metadata (verbatim licenses, see docs/data-notes.md) ---------------- */

export const SOURCES = {
  energyCharts: {
    name: "energy-charts.info (Fraunhofer ISE)",
    url: "https://energy-charts.info",
    api: "https://api.energy-charts.info/v2",
    docs: "https://api.energy-charts.info/openapi.json",
    licenseNote:
      "Unless stated otherwise, the data provided by the Energy-Charts API is licensed under the CC BY 4.0 license. Proper attribution to Energy-Charts.info as the source is required.",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  priceLicense:
    "CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de",
  powerLicense:
    "CC BY 4.0 (creativecommons.org/licenses/by/4.0), attribution: energy-charts.info",
  openMeteo: {
    name: "Open-Meteo (historical weather archive)",
    url: "https://open-meteo.com",
    api: "https://archive-api.open-meteo.com/v1/archive",
    docs: "https://open-meteo.com/en/docs",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    licencePage: "https://open-meteo.com/en/licence",
  },
};

/** NL representative point for the weather overlay (central Netherlands). */
export const WEATHER_POINT = { latitude: 52.1326, longitude: 5.2913 };

/* ---------------- series extraction ---------------- */

function valuesOf(envelope, seriesId) {
  return (envelope.data ?? []).map((rec) => ({
    timestamp: rec.timestamp,
    values: { [seriesId]: rec.values?.[seriesId] ?? null },
  }));
}

function allSeries(envelope) {
  return (envelope.data ?? []).map((rec) => ({ timestamp: rec.timestamp, values: rec.values ?? {} }));
}

/* ---------------- trailing days ---------------- */

/**
 * Merge hourly envelopes into one slot map keyed by (local date, local
 * hour, UTC offset) — the DST-safe key from src/grid/amsterdam-time.ts.
 */
export function slotsFromEnvelopes({ priceEnv, powerEnv, cbpfEnv }) {
  const priceSlots = bucketHours(valuesOf(priceEnv, "day_ahead_price"));
  const powerSlots = bucketHours(allSeries(powerEnv));
  const flowSlots = bucketHours(allSeries(cbpfEnv));
  const keys = new Set([...priceSlots.keys(), ...powerSlots.keys(), ...flowSlots.keys()]);
  const slots = new Map();
  for (const k of keys) {
    const p = priceSlots.get(k);
    const w = powerSlots.get(k);
    const f = flowSlots.get(k);
    const utc = p?.utc ?? w?.utc ?? f?.utc;
    slots.set(k, {
      utc,
      local: amsterdamLocal(utc),
      values: { ...(w?.values ?? {}), ...(f?.values ?? {}), ...(p?.values ?? {}) },
      weather: null,
    });
  }
  return slots;
}

/** Attach Open-Meteo hourly weather to slots (matched by hour key). */
export function attachWeather(slots, weatherEnv) {
  if (!weatherEnv) return slots;
  const weatherSlots = bucketHours(
    (weatherEnv.hourly.time ?? []).map((t, i) => ({
      // Open-Meteo emits local wall-clock labels without offset; resolve
      // the label to an instant in its stated zone so bucketing is exact.
      timestamp: localLabelToIso(t, weatherEnv.timezone ?? TZ),
      values: {
        wind: weatherEnv.hourly.wind_speed_10m?.[i] ?? null,
        solar: weatherEnv.hourly.shortwave_radiation?.[i] ?? null,
        temp: weatherEnv.hourly.temperature_2m?.[i] ?? null,
      },
    })),
  );
  for (const [k, slot] of slots) {
    const wx = weatherSlots.get(k);
    if (wx) slot.weather = wx.values;
  }
  return slots;
}

/** Map day buckets to the stored trailing-day shape (rounded, DST-aware). */
export function daysToTrailing(days) {
  return days.map((d) => {
    const price = d.slots.map((s) => roundForStorage(s.values.day_ahead_price ?? null, 1));
    const ren = d.slots.map((s) => roundForStorage(s.values.renewable_share_of_generation ?? null, 1));
    const load = d.slots.map((s) => roundForStorage(s.values.load ?? null, 0));
    const residual = d.slots.map((s) => roundForStorage(s.values.residual_load ?? null, 0));
    const intensity = d.slots.map((s) =>
      roundForStorage(
        computedIntensityGPerKWh(
          Object.fromEntries(PRODUCTION_TYPES.map((t) => [t, s.values[t] ?? null])),
          s.values.load ?? null,
        ),
        0,
      ),
    );
    const netImport = d.slots.map((s) => roundForStorage(s.values.sum ?? null, 2));
    const windMW = d.slots.map((s) =>
      roundForStorage(((s.values.wind_onshore ?? 0) + (s.values.wind_offshore ?? 0)) || null, 0),
    );
    const solarMW = d.slots.map((s) => roundForStorage(s.values.solar ?? null, 0));
    const flows = Object.fromEntries(
      FLOW_SERIES.map((n) => [n, d.slots.map((s) => roundForStorage(s.values[n] ?? null, 2))]),
    );
    const weather = d.slots.some((s) => s.weather)
      ? {
          wind: d.slots.map((s) => roundForStorage(s.weather?.wind ?? null, 1)),
          solar: d.slots.map((s) => roundForStorage(s.weather?.solar ?? null, 0)),
          temp: d.slots.map((s) => roundForStorage(s.weather?.temp ?? null, 1)),
        }
      : null;
    return {
      date: d.date,
      hours: d.hours,
      dst: d.dst,
      price,
      ren,
      intensity,
      load,
      residual,
      netImport,
      windMW,
      solarMW,
      flows,
      weather,
    };
  });
}

/** Convenience composition used by the daily snapshot. */
export function buildTrailingDays({ priceEnv, powerEnv, cbpfEnv, weatherEnv }) {
  const slots = attachWeather(slotsFromEnvelopes({ priceEnv, powerEnv, cbpfEnv }), weatherEnv);
  return daysToTrailing(bucketDays([...slots.values()]));
}

/** Convert an Open-Meteo local label "2026-11-01T00:00" to an ISO instant. */
function localLabelToIso(label, tz) {
  // Interpret the wall-clock label in the given zone by probing offsets.
  const naive = Date.parse(label + ":00Z");
  for (const offsetMin of [60, 120]) {
    const candidate = new Date(naive - offsetMin * 60_000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const rebuilt = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
    if (rebuilt === label.slice(0, 16)) {
      return new Date(naive - offsetMin * 60_000).toISOString();
    }
  }
  return new Date(naive).toISOString();
}

/* ---------------- per-year composites (hour x month means) ---------------- */

const COMPOSITE_SERIES = ["price", "ren", "intensity", "wind", "solar"];

/**
 * Per-year hour x month means for the heatmap layers and the weather
 * overlay (the atlas "full history" period). Input: day buckets covering the
 * year with raw slot values and weather. Represented as series -> 24 arrays
 * of 12 monthly means; null where no data.
 */
export function buildCompositesForYear(yearDays) {
  const sums = {};
  const counts = {};
  for (const s of COMPOSITE_SERIES) {
    sums[s] = Array.from({ length: 24 }, () => Array(12).fill(0));
    counts[s] = Array.from({ length: 24 }, () => Array(12).fill(0));
  }
  for (const day of yearDays) {
    const month = Number(day.date.slice(5, 7)) - 1;
    day.slots.forEach((slot) => {
      const h = slot.local.hour;
      const v = {
        price: slot.values.day_ahead_price,
        ren: slot.values.renewable_share_of_generation,
        intensity: computedIntensityGPerKWh(
          Object.fromEntries(PRODUCTION_TYPES.map((t) => [t, slot.values[t] ?? null])),
          slot.values.load ?? null,
        ),
        wind: slot.weather?.wind ?? null,
        solar: slot.weather?.solar ?? null,
      };
      for (const s of COMPOSITE_SERIES) {
        const val = v[s];
        if (val != null && Number.isFinite(val)) {
          sums[s][h][month] += val;
          counts[s][h][month] += 1;
        }
      }
    });
  }
  const out = {};
  for (const s of COMPOSITE_SERIES) {
    out[s] = sums[s].map((hours, h) =>
      hours.map((sum, m) => (counts[s][h][m] > 0 ? roundForStorage(sum / counts[s][h][m], 1) : null)),
    );
  }
  return out;
}

/* ---------------- per-year flow volumes (TWh) ---------------- */

/**
 * Per-neighbor import/export volumes per year from hourly cbpf (GW, imports
 * positive, exports negative — disclosed on the card). importTWh sums the
 * positive hours, exportTWh the absolute value of the negative hours, net
 * is their signed sum; the national total is the sum series.
 */
export function buildFlowVolumes(yearDays) {
  const neighbors = {};
  for (const n of FLOW_SERIES) neighbors[n] = { importGWh: 0, exportGWh: 0, hours: 0 };
  for (const day of yearDays) {
    day.slots.forEach((slot) => {
      for (const n of FLOW_SERIES) {
        const v = slot.values[n];
        if (v == null || !Number.isFinite(v)) continue;
        neighbors[n].hours += 1;
        if (v >= 0) neighbors[n].importGWh += v * 1; // hourly mean GW x 1 h
        else neighbors[n].exportGWh += -v * 1;
      }
    });
  }
  const out = {};
  for (const n of FLOW_SERIES) {
    const importTWh = neighbors[n].importGWh / 1e6;
    const exportTWh = neighbors[n].exportGWh / 1e6;
    out[n] = {
      importTWh: roundForStorage(importTWh, 2),
      exportTWh: roundForStorage(exportTWh, 2),
      netTWh: roundForStorage(importTWh - exportTWh, 2),
    };
  }
  return out;
}

/* ---------------- records / window / risk / derived ---------------- */

/** Hourly samples for records and risk, from day buckets with raw values. */
export function samplesFromDays(days) {
  const samples = [];
  for (const day of days) {
    day.slots.forEach((slot) => {
      samples.push({
        timestamp: new Date(slot.utc).toISOString(),
        utc: slot.utc,
        date: day.date,
        hour: slot.local.hour,
        price: slot.values.day_ahead_price ?? null,
        residualLoad: slot.values.residual_load ?? null,
        netImport: slot.values.sum ?? null,
        renShareGen: slot.values.renewable_share_of_generation ?? null,
        intensity: computedIntensityGPerKWh(
          Object.fromEntries(PRODUCTION_TYPES.map((t) => [t, slot.values[t] ?? null])),
          slot.values.load ?? null,
        ),
        windSolarMW:
          (slot.values.wind_onshore ?? 0) + (slot.values.wind_offshore ?? 0) + (slot.values.solar ?? 0),
        load: slot.values.load ?? null,
        mix: Object.fromEntries(PRODUCTION_TYPES.map((t) => [t, slot.values[t] ?? null])),
      });
    });
  }
  samples.sort((a, b) => a.utc - b.utc);
  return samples;
}

export function windowFromSamples(samples, trailingDays) {
  const cutoff = samples.length
    ? samples[samples.length - 1].utc - trailingDays * 86_400_000
    : 0;
  const inWindow = samples.filter((s) => s.utc >= cutoff);
  return computeWindow(
    inWindow.map((s) => ({ utc: s.utc, date: s.date, hour: s.hour, price: s.price, ren: s.renShareGen })),
  );
}

export function riskFromSamples(samples, windowResult) {
  const now = samples.length ? samples[samples.length - 1].utc : 0;
  const s30 = samples.filter((s) => s.utc >= now - 30 * 86_400_000);
  const s90 = samples.filter((s) => s.utc >= now - 90 * 86_400_000);
  // Red-hour share via the shared rule predicates (same code path as the
  // green/red cards), counted per actual slot so DST days weigh correctly.
  const pct = windowResult.percentiles;
  const usable = s30.filter((s) => s.price != null && s.renShareGen != null);
  const redShare = usable.length
    ? usable.filter((s) => isRedHour(s.price, s.renShareGen, pct)).length / usable.length
    : null;
  return computeRiskIndicators(
    s30.map((s) => ({ price: s.price, renShareGen: s.renShareGen, load: s.load, netImportGW: s.netImport, windSolarMW: s.windSolarMW })),
    s90.map((s) => ({ price: s.price, renShareGen: s.renShareGen, load: s.load, netImportGW: s.netImport, windSolarMW: s.windSolarMW })),
    redShare,
  );
}

/** Trailing-30-day average day profiles (24 wall hours) for the chapter visuals. */
export function profilesFromSamples(samples, daysBack = 30) {
  const now = samples.length ? samples[samples.length - 1].utc : 0;
  const inWindow = samples.filter((s) => s.utc >= now - daysBack * 86_400_000);
  const keys = ["price", "ren", "intensity", "load", "netImport", "fossil_gas", "solar", "wind", "residual"];
  const sums = Object.fromEntries(keys.map((k) => [k, Array(24).fill(0)]));
  const counts = Object.fromEntries(keys.map((k) => [k, Array(24).fill(0)]));
  for (const s of inWindow) {
    const h = s.hour;
    const row = {
      price: s.price,
      ren: s.renShareGen,
      intensity: s.intensity,
      load: s.load,
      netImport: s.netImport,
      fossil_gas: s.mix?.fossil_gas ?? null,
      solar: s.mix?.solar ?? null,
      wind: (s.mix?.wind_onshore ?? 0) + (s.mix?.wind_offshore ?? 0),
      residual: s.residualLoad,
    };
    for (const k of keys) {
      if (row[k] != null && Number.isFinite(row[k])) {
        sums[k][h] += row[k];
        counts[k][h] += 1;
      }
    }
  }
  const out = {};
  for (const k of keys) {
    out[k] = sums[k].map((sum, h) => (counts[k][h] > 0 ? roundForStorage(sum / counts[k][h], k === "price" ? 1 : 0) : null));
  }
  return out;
}

export function recordsFromSamples(samples) {
  const byDay = new Map();
  for (const s of samples) {
    const arr = byDay.get(s.date) ?? [];
    arr.push(s);
    byDay.set(s.date, arr);
  }
  let dunkel = null;
  for (const [date, arr] of byDay) {
    const d = dunkelflauteOfDay(date, arr.map((s) => s.renShareGen));
    if (d && (dunkel === null || d.meanRenShare < dunkel.meanRenShare)) dunkel = d;
  }
  return computeRecords(
    samples.map((s) => ({
      timestamp: s.timestamp,
      price: s.price,
      residualLoad: s.residualLoad,
      netImport: s.netImport,
      renShareGen: s.renShareGen,
      intensity: s.intensity,
      mix: s.mix,
    })),
    dunkel,
  );
}

export { computeScore, mergeRecords, EMISSION_FACTORS_VERSION };
