/**
 * The records set ("The extremes" coda). Pure functions over hourly series;
 * the backfill computes them over the full 2015-present history, the daily
 * snapshot re-checks the trailing window for new records. Every record
 * carries its timestamp (Europe/Amsterdam, explicit offset) and, where the
 * rule asks for it, the production mix of that hour.
 */

import { dateHourLabel, parseTs } from "./amsterdam-time.ts";

export interface RecordEntry {
  /** Series the record is about. */
  key: string;
  label: string;
  /** ISO timestamp with explicit offset, as served by the source. */
  timestamp: string;
  /** Amsterdam local label, e.g. "14:00 +01:00". */
  localLabel: string;
  /** The record value, in the record's unit. */
  value: number;
  unit: string;
  /** Production mix (MW per type) at the record hour, when applicable. */
  mix?: Record<string, number | null>;
}

export interface HourSample {
  timestamp: string;
  price?: number | null;
  residualLoad?: number | null;
  netImport?: number | null;
  renShareGen?: number | null;
  intensity?: number | null;
  mix?: Record<string, number | null>;
}

function better(a: RecordEntry | null, b: RecordEntry, mode: "max" | "min"): RecordEntry {
  if (!a) return b;
  const av = a.value;
  const bv = b.value;
  return mode === "max" ? (bv > av ? b : a) : bv < av ? b : a;
}

function entry(
  key: string,
  label: string,
  s: HourSample,
  value: number,
  unit: string,
  withMix: boolean,
): RecordEntry {
  return {
    key,
    label,
    timestamp: s.timestamp,
    localLabel: dateHourLabel(parseTs(s.timestamp)),
    value: Math.round(value * 100) / 100,
    unit,
    ...(withMix
      ? {
          mix: Object.fromEntries(
            Object.entries(s.mix ?? {}).map(([k, v]) => [k, v == null ? null : Math.round(v)]),
          ),
        }
      : {}),
  };
}

/**
 * Compute all records over the given hourly samples. `dunkelflauteDay` is
 * passed in separately because it is a daily aggregate (lowest daily mean
 * renewable share of generation), computed by the caller.
 */
export function computeRecords(
  samples: HourSample[],
  dunkelflauteDay: { date: string; meanRenShare: number; mix?: Record<string, number | null> } | null,
): RecordEntry[] {
  let highestPrice: RecordEntry | null = null;
  let mostNegativePrice: RecordEntry | null = null;
  let highestResidual: RecordEntry | null = null;
  let biggestImport: RecordEntry | null = null;
  let dirtiest: RecordEntry | null = null;
  let cleanest: RecordEntry | null = null;
  for (const s of samples) {
    if (s.price != null && Number.isFinite(s.price)) {
      highestPrice = better(highestPrice, entry("highestPrice", "Highest price hour", s, s.price, "EUR/MWh", false), "max");
      mostNegativePrice = better(mostNegativePrice, entry("mostNegativePrice", "Most negative price hour", s, s.price, "EUR/MWh", false), "min");
    }
    if (s.residualLoad != null && Number.isFinite(s.residualLoad)) {
      highestResidual = better(highestResidual, entry("highestResidualLoad", "Highest residual load hour", s, s.residualLoad, "MW", true), "max");
    }
    if (s.netImport != null && Number.isFinite(s.netImport)) {
      biggestImport = better(biggestImport, entry("biggestImport", "Biggest import hour", s, s.netImport, "GW", true), "max");
    }
    if (s.intensity != null && Number.isFinite(s.intensity)) {
      dirtiest = better(dirtiest, entry("dirtiestHour", "Dirtiest hour on record", s, s.intensity, "g CO2-eq/kWh", true), "max");
      cleanest = better(cleanest, entry("cleanestHour", "Cleanest hour on record", s, s.intensity, "g CO2-eq/kWh", true), "min");
    }
  }
  const records = [highestPrice, mostNegativePrice, highestResidual, biggestImport, dirtiest, cleanest].filter(
    (r): r is RecordEntry => r !== null,
  );
  if (dunkelflauteDay) {
    records.push({
      key: "dunkelflauteDay",
      label: "Dunkelflaute record day",
      timestamp: `${dunkelflauteDay.date}T12:00:00+01:00`,
      localLabel: `${dunkelflauteDay.date} (daily mean)`,
      value: dunkelflauteDay.meanRenShare,
      unit: "% renewable share of generation (daily mean)",
      mix: dunkelflauteDay.mix,
    });
  }
  return records;
}

/** Merge a new candidate record list into the stored one (same keys win on better value). */
export function mergeRecords(stored: RecordEntry[], candidates: RecordEntry[]): RecordEntry[] {
  const byKey = new Map(stored.map((r) => [r.key, r]));
  for (const c of candidates) {
    const existing = byKey.get(c.key);
    if (!existing) {
      byKey.set(c.key, c);
    } else {
      const mode = c.key === "mostNegativePrice" || c.key === "cleanestHour" ? "min" : "max";
      byKey.set(c.key, better(existing, c, mode));
    }
  }
  const order = ["highestPrice", "mostNegativePrice", "highestResidualLoad", "biggestImport", "dirtiestHour", "cleanestHour", "dunkelflauteDay"];
  return order.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
}

/** Lowest daily mean renewable share of generation = Dunkelflaute record day. */
export function dunkelflauteOfDay(
  date: string,
  renShares: (number | null)[],
): { date: string; meanRenShare: number } | null {
  const vals = renShares.filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return { date, meanRenShare: vals.reduce((a, b) => a + b, 0) / vals.length };
}
