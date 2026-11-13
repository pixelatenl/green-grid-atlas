/**
 * Normalization of energy-charts envelope records into Amsterdam-local hour
 * slots and day buckets, with the DST rule applied: slots are keyed by
 * (local date, local hour, UTC offset), so a 25-hour fall-back day keeps
 * two 02:00 slots and a 23-hour spring-forward day has 23 slots. Values
 * are averaged per slot from whatever resolution the source served (PT1H or
 * PT15M); missing values stay null and render as gaps, never as zero.
 */

import {
  amsterdamLocal,
  dayKey,
  dstShape,
  hourKey,
  parseTs,
  type LocalParts,
} from "./amsterdam-time.ts";

/** A raw envelope record: { timestamp, values }. */
export interface RawRecord {
  timestamp: string;
  values: Record<string, number | null>;
}

export interface HourSlot {
  /** UTC ms of the slot start (the hour's first interval). */
  utc: number;
  /** Amsterdam local parts of the slot. */
  local: LocalParts;
  /** Averaged values by series id; null when every source record was null. */
  values: Record<string, number | null>;
}

export interface DayBucket {
  /** Amsterdam local date YYYY-MM-DD. */
  date: string;
  /** Slots in chronological order; length is the day's actual hour count. */
  slots: HourSlot[];
  /** Actual hour count: 23, 24 or 25. */
  hours: number;
  dst: "spring" | "fall" | "normal";
}

/** Average per-series values of all raw records landing in one hour slot. */
export function bucketHours(records: RawRecord[]): Map<string, HourSlot> {
  const groups = new Map<string, { utc: number; sum: Record<string, number>; count: Record<string, number> }>();
  for (const rec of records) {
    const utc = parseTs(rec.timestamp);
    if (!Number.isFinite(utc)) continue;
    const key = hourKey(utc);
    let g = groups.get(key);
    if (!g) {
      g = { utc, sum: {}, count: {} };
      groups.set(key, g);
    }
    for (const [id, v] of Object.entries(rec.values)) {
      if (v == null || !Number.isFinite(v)) continue;
      g.sum[id] = (g.sum[id] ?? 0) + v;
      g.count[id] = (g.count[id] ?? 0) + 1;
    }
  }
  const out = new Map<string, HourSlot>();
  for (const [key, g] of groups) {
    const values: Record<string, number | null> = {};
    const ids = new Set([...Object.keys(g.sum), ...Object.keys(g.count)]);
    for (const id of ids) {
      values[id] = g.count[id] ? g.sum[id] / g.count[id] : null;
    }
    out.set(key, { utc: g.utc, local: amsterdamLocal(g.utc), values });
  }
  return out;
}

/** Group hour slots into Amsterdam-local day buckets (DST-aware). */
export function bucketDays(slots: HourSlot[]): DayBucket[] {
  const byDay = new Map<string, HourSlot[]>();
  for (const s of slots) {
    const date = dayKey(s.utc);
    const arr = byDay.get(date) ?? [];
    arr.push(s);
    byDay.set(date, arr);
  }
  const days: DayBucket[] = [];
  for (const [date, arr] of byDay) {
    arr.sort((a, b) => a.utc - b.utc);
    // Distinct (hour, offset) pairs = actual hour count of the day.
    const hourOffsets = new Set(arr.map((s) => `${s.local.hour}:${s.local.offsetMin}`));
    days.push({ date, slots: arr, hours: hourOffsets.size, dst: dstShape(hourOffsets.size) });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days;
}

/** Round for snapshot storage; null stays null. */
export function roundForStorage(v: number | null, digits: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
