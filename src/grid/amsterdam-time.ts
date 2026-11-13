/**
 * Europe/Amsterdam local-time helpers, dependency-free (Intl only).
 *
 * DST rule (implemented here, documented in the method drawer): every grid
 * on this site renders in Europe/Amsterdam local time. The energy-charts
 * timestamps carry an explicit UTC offset and mark the START of each
 * interval, so a fall-back day really contains two 02:00 slots (one +02:00,
 * one +01:00) and a spring-forward day has no 02:00 slot at all. We never
 * re-derive local time by adding a fixed offset; we ask the IANA database
 * via Intl, and we key hour slots by (local date, local hour, UTC offset),
 * so a 25-hour day keeps both 02:00 slots as separate, explicitly labelled
 * columns and a 23-hour day renders 23 columns. Nothing is silently shifted.
 */

const TZ = "Europe/Amsterdam";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const offsetFormatter = new Intl.DateTimeFormat("en", {
  timeZone: TZ,
  timeZoneName: "longOffset",
});

export interface LocalParts {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local wall-clock hour 0-23. */
  hour: number;
  /** Local minute 0-59. */
  minute: number;
  /** UTC offset of this instant in Amsterdam, in minutes (+60 or +120). */
  offsetMin: number;
}

/** Parse an ISO 8601 timestamp (with or without offset) to UTC ms. */
export function parseTs(ts: string): number {
  return Date.parse(ts);
}

/** Amsterdam local calendar parts of a UTC instant. */
export function amsterdamLocal(utcMs: number): LocalParts {
  const parts = partsFormatter.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const date = `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(
    get("day"),
  ).padStart(2, "0")}`;
  const offsetName = offsetFormatter
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName);
  const offsetMin = m
    ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
    : 0;
  return { date, hour: get("hour") % 24, minute: get("minute"), offsetMin };
}

/** Offset label like "+02:00" for display of doubled DST hours. */
export function offsetLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(
    abs % 60,
  ).padStart(2, "0")}`;
}

/**
 * Hour-slot key: local date + local hour + UTC offset. Distinct keys make
 * the two 02:00 slots of a fall-back day distinct; a spring-forward day
 * simply has no key with hour 2.
 */
export function hourKey(utcMs: number): string {
  const p = amsterdamLocal(utcMs);
  return `${p.date}T${String(p.hour).padStart(2, "0")}:${p.offsetMin}`;
}

/** Human label for a slot hour: "14:00", or "02:00 +02:00" on doubled days. */
export function hourLabel(utcMs: number): string {
  const p = amsterdamLocal(utcMs);
  const hh = `${String(p.hour).padStart(2, "0")}:00`;
  return `${hh} ${offsetLabel(p.offsetMin)}`;
}

/** Short label without offset: "14:00". */
export function hourLabelShort(utcMs: number): string {
  const p = amsterdamLocal(utcMs);
  return `${String(p.hour).padStart(2, "0")}:00`;
}

/** Full label with date: "2026-11-13 17:00 +01:00". */
export function dateHourLabel(utcMs: number): string {
  const p = amsterdamLocal(utcMs);
  return `${p.date} ${String(p.hour).padStart(2, "0")}:00 ${offsetLabel(p.offsetMin)}`;
}

/** Local date key of a UTC instant: YYYY-MM-DD. */
export function dayKey(utcMs: number): string {
  return amsterdamLocal(utcMs).date;
}

/**
 * Classify a local day's DST shape from its slot count: 23-hour spring day,
 * 25-hour fall day, otherwise normal. The count is the actual number of
 * distinct (hour, offset) slots — never an assumed 24.
 */
export function dstShape(hourCount: number): "spring" | "fall" | "normal" {
  if (hourCount === 23) return "spring";
  if (hourCount === 25) return "fall";
  return "normal";
}

/**
 * Wall-clock hours of a day's slots, in chronological order: a fall-back
 * day lists hour 2 twice (once at +02:00, once at +01:00), a spring-forward
 * day skips hour 2. This is how a stored day's slot array maps back to
 * wall hours without re-deriving anything silently.
 */
export function dayHourSequence(shape: "spring" | "fall" | "normal"): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (shape === "spring" && h === 2) continue; // 02:00 does not exist
    hours.push(h);
    if (shape === "fall" && h === 2) hours.push(2); // 02:00 happens twice
  }
  return hours;
}

/**
 * Resolve an Amsterdam local (date, wall hour, occurrence) back to a UTC
 * instant. `occurrence` distinguishes the two 02:00 slots on a fall-back
 * day: 0 is the first (+02:00), 1 the second (+01:00). Probes the two
 * possible offsets and picks the one whose local parts match exactly.
 */
export function resolveLocalUtc(date: string, hour: number, occurrence = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  for (const offsetMin of occurrence === 0 ? [120, 60] : [60, 120]) {
    const utc = Date.UTC(y, m - 1, d, hour, 0, 0) - offsetMin * 60_000;
    const p = amsterdamLocal(utc);
    if (p.date === date && p.hour === hour && p.offsetMin === offsetMin) return utc;
  }
  // Fallback: first matching offset.
  return Date.UTC(y, m - 1, d, hour, 0, 0) - 60 * 60_000;
}

/** UTC instant of slot `index` of a stored day (date + dst shape + slot array). */
export function slotUtc(date: string, shape: "spring" | "fall" | "normal", index: number): number {
  const seq = dayHourSequence(shape);
  const hour = seq[Math.min(index, seq.length - 1)];
  const occurrence = shape === "fall" && hour === 2 && index > 2 ? 1 : 0;
  return resolveLocalUtc(date, hour, occurrence);
}
