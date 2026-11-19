/**
 * Month-by-hour rhythm grids, built at build time in Node from the
 * snapshot's trailing days (imported through src/data/snapshot.ts by the
 * atlas card; no fetches, no client-side aggregation of raw hours).
 *
 * Aggregation rule (mirrored verbatim in the method drawer): each cell is
 * the mean of one local hour across all days of that calendar month present
 * in the trailing window. Every stored slot of a trailing day is mapped to
 * its Europe/Amsterdam wall-clock hour through the existing DST wall-hour
 * sequence (dayHourSequence in src/grid/amsterdam-time.ts), so a 23-hour
 * spring-forward day simply contributes no 02:00 sample and a 25-hour
 * fall-back day contributes both of its 02:00 slots to the 02:00 cell.
 * Nothing is silently shifted. Months are calendar months across the
 * window; the edge months are partial when the window's first or last day
 * cuts them. Null cells (no data for that month-hour) stay null.
 *
 * Weather cells use the same axes; the mean per cell is taken only over
 * days that carry weather values.
 */

import { dayHourSequence } from "./amsterdam-time.ts";
import type { TrailingDay } from "../data/snapshot.ts";

export type RhythmSeriesId = "price" | "ren";
export type WeatherSeriesId = "wind" | "solar" | "temp";

/** Open-Meteo wind_speed_10m arrives in km/h; the card shows m/s. */
export const KMH_PER_MS = 3.6;

export interface RhythmMonth {
  /** Calendar month key, "YYYY-MM". */
  key: string;
  /** Short row label, "Nov 25". */
  label: string;
  /** Full month name with year, "November 2025". */
  fullLabel: string;
  /** True when the trailing window cuts this (edge) month. */
  partial: boolean;
  /** Days of this calendar month present in the trailing window. */
  days: number;
  /** Days of this month that carry weather values. */
  weatherDays: number;
}

export interface RhythmCell {
  /** Mean of the contributing hourly samples; null = no data. */
  value: number | null;
  /** Number of hourly samples behind the mean (a 25-hour day can add two). */
  samples: number;
}

export interface RhythmGrid {
  months: RhythmMonth[];
  /** cells[monthIndex][hour], hour 0-23. */
  cells: RhythmCell[][];
}

export interface WindowBounds {
  from: string | null;
  to: string | null;
}

/** Value extractor: one stored slot of a day, already mapped to wall hour. */
export type SlotExtractor = (day: TrailingDay, slotIndex: number, wallHour: number) => number | null;

const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Build the month list (chronological calendar months across the window). */
export function rhythmMonths(days: TrailingDay[], win: WindowBounds): RhythmMonth[] {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byKey = new Map<string, { days: number; weatherDays: number }>();
  for (const d of sorted) {
    const key = d.date.slice(0, 7);
    const m = byKey.get(key) ?? { days: 0, weatherDays: 0 };
    m.days += 1;
    if (d.weather) m.weatherDays += 1;
    byKey.set(key, m);
  }
  const fromKey = win.from?.slice(0, 7) ?? null;
  const toKey = win.to?.slice(0, 7) ?? null;
  const fromDay = win.from ? Number(win.from.slice(8, 10)) : null;
  const toDay = win.to ? Number(win.to.slice(8, 10)) : null;
  const out: RhythmMonth[] = [];
  for (const [key, m] of byKey) {
    const [y, mo] = key.split("-").map(Number);
    const anchor = new Date(`${key}-02T00:00:00Z`);
    const partial =
      (key === fromKey && fromDay != null && fromDay > 1) ||
      (key === toKey && toDay != null && toDay < daysInMonth(y, mo));
    out.push({
      key,
      label: monthShort.format(anchor),
      fullLabel: monthLong.format(anchor),
      partial,
      days: m.days,
      weatherDays: m.weatherDays,
    });
  }
  out.sort((a, b) => (a.key < b.key ? -1 : 1));
  return out;
}

/**
 * Aggregate the trailing days into one month x hour grid. See the header
 * comment for the aggregation rule (mean of one local hour across the
 * month's days, DST wall-hour collapse via dayHourSequence).
 */
export function buildRhythmGrid(days: TrailingDay[], win: WindowBounds, extract: SlotExtractor): RhythmGrid {
  const months = rhythmMonths(days, win);
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  const sum: number[][] = months.map(() => Array(24).fill(0));
  const count: number[][] = months.map(() => Array(24).fill(0));
  for (const d of days) {
    const mi = monthIndex.get(d.date.slice(0, 7));
    if (mi == null) continue;
    const seq = dayHourSequence(d.dst);
    for (let i = 0; i < seq.length; i++) {
      const h = seq[i];
      const v = extract(d, i, h);
      if (v == null || !Number.isFinite(v)) continue;
      sum[mi][h] += v;
      count[mi][h] += 1;
    }
  }
  const cells: RhythmCell[][] = months.map((_, mi) =>
    Array.from({ length: 24 }, (_, h) => ({
      value: count[mi][h] > 0 ? sum[mi][h] / count[mi][h] : null,
      samples: count[mi][h],
    })),
  );
  return { months, cells };
}

/** Day-ahead price per slot, EUR/MWh. */
export const priceExtractor: SlotExtractor = (d, i) => d.price[i] ?? null;

/** Renewable share of generation per slot, percent. */
export const renExtractor: SlotExtractor = (d, i) => d.ren[i] ?? null;

/** Mean wind speed per slot, converted from the archive's km/h to m/s. */
export const windExtractor: SlotExtractor = (d, i) => {
  const v = d.weather?.wind[i];
  return v == null || !Number.isFinite(v) ? null : v / KMH_PER_MS;
};

/** Mean shortwave radiation per slot, W/m2. */
export const solarExtractor: SlotExtractor = (d, i) => d.weather?.solar[i] ?? null;

/** Mean 2 m temperature per slot, degrees C. */
export const tempExtractor: SlotExtractor = (d, i) => d.weather?.temp[i] ?? null;

export const WEATHER_EXTRACTORS: Record<WeatherSeriesId, SlotExtractor> = {
  wind: windExtractor,
  solar: solarExtractor,
  temp: tempExtractor,
};

/** All three weather mini-grids plus the coverage counts. */
export function buildWeatherGrids(days: TrailingDay[], win: WindowBounds) {
  const grids = {
    wind: buildRhythmGrid(days, win, windExtractor),
    solar: buildRhythmGrid(days, win, solarExtractor),
    temp: buildRhythmGrid(days, win, tempExtractor),
  } as Record<WeatherSeriesId, RhythmGrid>;
  return {
    grids,
    daysWithWeather: days.filter((d) => d.weather).length,
    totalDays: days.length,
  };
}

/** Min and max of the grid's own cells (the colour domain, build-time). */
export function gridDomain(grid: RhythmGrid): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of grid.cells) {
    for (const c of row) {
      if (c.value == null || !Number.isFinite(c.value)) continue;
      if (c.value < lo) lo = c.value;
      if (c.value > hi) hi = c.value;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { lo, hi: Math.max(hi, lo + 1e-9) };
}

/**
 * Argmax (or argmin) over each month's non-null cells; the annotated hour
 * per month. Returns hours aligned with grid.months, null for empty months.
 */
export function argExtremePerMonth(grid: RhythmGrid, mode: "max" | "min"): (number | null)[] {
  return grid.months.map((_, mi) => {
    let best: number | null = null;
    let bestHour = -1;
    for (let h = 0; h < 24; h++) {
      const v = grid.cells[mi][h].value;
      if (v == null || !Number.isFinite(v)) continue;
      if (best === null || (mode === "max" ? v > best : v < best)) {
        best = v;
        bestHour = h;
      }
    }
    return best === null ? null : bestHour;
  });
}

/** Hour label "17:00". */
export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Cell hour range label "17:00-18:00" (23:00 cell ends at 00:00). */
export function hourRangeLabel(h: number): string {
  return `${hourLabel(h)}\u2013${hourLabel((h + 1) % 24)}`;
}
