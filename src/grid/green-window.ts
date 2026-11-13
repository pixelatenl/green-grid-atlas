/**
 * The green window rule — the product's signature. ONE documented rule,
 * shared by the green-window card, the red-hours mirror card and the
 * heatmap transition markers; green and red are computed by the SAME
 * function with inverted thresholds and comparators, so the pair can never
 * contradict. All constants live here (WINDOW_PARAMS) and are repeated
 * verbatim in the method drawer (WINDOW_RULE_TEXT); they are never
 * hand-tuned per snapshot and may change between builds only by editing
 * this file, with any change stated in the PR description.
 */

export const WINDOW_PARAMS = {
  /** Trailing window length in days; each hour is an independent sample. */
  TRAILING_DAYS: 30,
  /** Green: price at or below this percentile of the trailing price distribution. */
  GREEN_PRICE_PERCENTILE: 30,
  /** Green: renewable share at or above this percentile of the trailing renewable-share distribution. */
  GREEN_RENEWABLE_PERCENTILE: 70,
  /** Red (exact inverse, same code path): price at or above this percentile. */
  RED_PRICE_PERCENTILE: 70,
  /** Red: renewable share at or below this percentile. */
  RED_RENEWABLE_PERCENTILE: 30,
} as const;

/**
 * The rule, verbatim as repeated in the method drawer. Keep in sync with
 * WINDOW_PARAMS and the implementation below.
 */
export const WINDOW_RULE_TEXT = `The green window is computed from the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days of hourly values (price and renewable share of generation), each hour independent. A green hour has price at or below the ${WINDOW_PARAMS.GREEN_PRICE_PERCENTILE}th percentile of the trailing price distribution AND renewable share at or above the ${WINDOW_PARAMS.GREEN_RENEWABLE_PERCENTILE}th percentile of the trailing renewable-share distribution. A red hour is the exact inverse through the same code path: price at or above the ${WINDOW_PARAMS.RED_PRICE_PERCENTILE}th percentile AND renewable share at or below the ${WINDOW_PARAMS.RED_RENEWABLE_PERCENTILE}th percentile. For each day, the contiguous hour bands qualifying are collected; the rendered window is the modal recurring band (the band shape most frequent in the trailing window), displayed with its frequency share (share of trailing days having that band). Single qualifying hours outside bands are shown on the heatmap but do not form the window. Percentiles use linear interpolation on the sorted hourly sample. Basis: renewable share of generation (NL generation mix); price is the NL day-ahead price.`;

/** One hourly sample of the trailing window. */
export interface WindowHour {
  /** UTC ms of the slot start. */
  utc: number;
  /** Amsterdam local date YYYY-MM-DD. */
  date: string;
  /** Amsterdam local wall-clock hour 0-23. */
  hour: number;
  /** Day-ahead price, EUR/MWh. */
  price: number;
  /** Renewable share of generation, percent 0-100. */
  ren: number;
}

export interface Band {
  startHour: number;
  endHour: number;
}

export interface WindowSide {
  thresholds: { price: number; ren: number };
  /** Qualifying wall-clock hours per day, for the heatmap markers. */
  qualifyingHours: Record<string, number[]>;
  /** Contiguous bands of length >= 2 per day (single hours excluded). */
  bands: Record<string, Band[]>;
  /** Single qualifying hours per day (shown on the heatmap, never a window). */
  singles: Record<string, number[]>;
  /** The modal recurring band and its frequency share of trailing days. */
  modalBand: Band | null;
  frequencyShare: number;
  /** Number of trailing days in the sample. */
  days: number;
}

export interface WindowResult {
  params: typeof WINDOW_PARAMS;
  /** Trailing-distribution percentiles, all four. */
  percentiles: { priceP30: number; priceP70: number; renP30: number; renP70: number };
  green: WindowSide;
  red: WindowSide;
  /** First and last UTC ms of the trailing window used. */
  windowStartUtc: number;
  windowEndUtc: number;
}

type Op = "le" | "ge";
const passes = (value: number, threshold: number, op: Op) =>
  op === "le" ? value <= threshold : value >= threshold;

/**
 * Percentile with linear interpolation between closest ranks (the
 * "type 7" definition), p in [0, 100]. Input need not be sorted.
 */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * The one code path behind both sides: classify each day's wall-clock
 * hours with the given threshold/comparator pair, then extract contiguous
 * bands. Green calls it with (priceP30, "le", renP70, "ge"); red with
 * (priceP70, "ge", renP30, "le") — the exact inverse parameters.
 */
function classifySide(
  hours: WindowHour[],
  priceThreshold: number,
  priceOp: Op,
  renThreshold: number,
  renOp: Op,
): WindowSide {
  const byDay = new Map<string, WindowHour[]>();
  for (const h of hours) {
    const arr = byDay.get(h.date) ?? [];
    arr.push(h);
    byDay.set(h.date, arr);
  }
  const days = [...byDay.keys()].sort();
  const qualifyingHours: Record<string, number[]> = {};
  const bands: Record<string, Band[]> = {};
  const singles: Record<string, number[]> = {};
  const bandCounts = new Map<string, { band: Band; count: number }>();

  for (const date of days) {
    // A wall-clock hour qualifies if any of its slots qualifies (the doubled
    // 02:00 on a fall-back day is one wall hour).
    const qual = new Set<number>();
    for (const h of byDay.get(date)!) {
      if (passes(h.price, priceThreshold, priceOp) && passes(h.ren, renThreshold, renOp)) {
        qual.add(h.hour);
      }
    }
    const sorted = [...qual].sort((a, b) => a - b);
    qualifyingHours[date] = sorted;
    // Contiguous runs over wall hours 0..23 (no wrap across midnight).
    const runs: Band[] = [];
    let runStart: number | null = null;
    let prev: number | null = null;
    for (const h of sorted) {
      if (runStart === null) {
        runStart = h;
      } else if (h !== prev! + 1) {
        runs.push({ startHour: runStart, endHour: prev! });
        runStart = h;
      }
      prev = h;
    }
    if (runStart !== null) runs.push({ startHour: runStart, endHour: prev! });
    const kept = runs.filter((r) => r.endHour > r.startHour);
    singles[date] = runs.filter((r) => r.endHour === r.startHour).map((r) => r.startHour);
    bands[date] = kept;
    for (const b of kept) {
      const key = `${b.startHour}-${b.endHour}`;
      const entry = bandCounts.get(key) ?? { band: b, count: 0 };
      entry.count += 1;
      bandCounts.set(key, entry);
    }
  }

  let modalBand: Band | null = null;
  let modalCount = 0;
  for (const { band, count } of bandCounts.values()) {
    if (count > modalCount || (count === modalCount && modalBand && band.startHour < modalBand.startHour)) {
      modalBand = band;
      modalCount = count;
    }
  }
  return {
    thresholds: { price: priceThreshold, ren: renThreshold },
    qualifyingHours,
    bands,
    singles,
    modalBand,
    frequencyShare: days.length > 0 ? modalCount / days.length : 0,
    days: days.length,
  };
}

/**
 * Compute the green window and the red hours from trailing hourly samples.
 * `hours` should already be restricted to the trailing WINDOW_PARAMS.TRAILING_DAYS
 * days (the caller slices by date); every hour present is an independent sample.
 */
export function computeWindow(hours: WindowHour[]): WindowResult {
  const usable = hours.filter((h) => Number.isFinite(h.price) && Number.isFinite(h.ren));
  const prices = usable.map((h) => h.price);
  const rens = usable.map((h) => h.ren);
  const priceP30 = percentile(prices, WINDOW_PARAMS.GREEN_PRICE_PERCENTILE);
  const priceP70 = percentile(prices, WINDOW_PARAMS.RED_PRICE_PERCENTILE);
  const renP30 = percentile(rens, WINDOW_PARAMS.RED_RENEWABLE_PERCENTILE);
  const renP70 = percentile(rens, WINDOW_PARAMS.GREEN_RENEWABLE_PERCENTILE);
  const green = classifySide(usable, priceP30, "le", renP70, "ge");
  const red = classifySide(usable, priceP70, "ge", renP30, "le");
  return {
    params: WINDOW_PARAMS,
    percentiles: { priceP30, priceP70, renP30, renP70 },
    green,
    red,
    windowStartUtc: usable.length ? Math.min(...usable.map((h) => h.utc)) : 0,
    windowEndUtc: usable.length ? Math.max(...usable.map((h) => h.utc)) : 0,
  };
}

/** Format a band as "12:00–15:00" (wall-clock, Europe/Amsterdam). */
export function formatBand(band: Band): string {
  const f = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${f(band.startHour)}–${f(band.endHour + 1)}`;
}

/**
 * Per-hour predicates on the shared rule: green when price ≤ p30 AND ren ≥
 * p70; red when price ≥ p70 AND ren ≤ p30 (exact inverse). Used by the
 * risk indicator so the red-hour share is the same code path as the cards.
 */
export function isGreenHour(price: number, ren: number, p: { priceP30: number; renP70: number }): boolean {
  return price <= p.priceP30 && ren >= p.renP70;
}
export function isRedHour(price: number, ren: number, p: { priceP70: number; renP30: number }): boolean {
  return price >= p.priceP70 && ren <= p.renP30;
}
