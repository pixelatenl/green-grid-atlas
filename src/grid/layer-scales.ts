/**
 * Heatmap layer scales. The hex stops are the code copy of the product
 * tokens appended in app/globals.css (light theme values; the dark theme is
 * derived by interpolating toward the dark stops; both palettes are listed
 * per layer so rendering needs no CSS reads). Colour spans the 5th–95th
 * percentile of the displayed values; null renders as a gap.
 */

import type { WeatherSeriesId } from "./rhythm-grids.ts";

export type LayerId = "price" | "ren" | "intensity";

export interface LayerDef {
  id: LayerId;
  label: string;
  unit: string;
  /** Sequential low -> high stops, [light, dark] themes. */
  stops: { light: [string, string]; dark: [string, string] };
  format: (v: number) => string;
}

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function mix(a: string, b: string, t: number): string {
  const ca = hex(a);
  const cb = hex(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export const LAYERS: Record<LayerId, LayerDef> = {
  price: {
    id: "price",
    label: "Day-ahead price",
    unit: "EUR/MWh",
    stops: { light: ["#c4e5ec", "#a64b0c"], dark: ["#1f5766", "#f48822"] },
    format: (v) => `${v.toFixed(1)} EUR/MWh`,
  },
  ren: {
    id: "ren",
    label: "Renewable share of generation",
    unit: "%",
    stops: { light: ["#dceef2", "#166474"], dark: ["#174049", "#a7e2ee"] },
    format: (v) => `${v.toFixed(1)}%`,
  },
  intensity: {
    id: "intensity",
    label: "Computed carbon intensity (generation mix)",
    unit: "g CO2-eq/kWh",
    stops: { light: ["#dceef2", "#a64b0c"], dark: ["#174049", "#f48822"] },
    format: (v) => `${Math.round(v)} g CO2-eq/kWh`,
  },
};

export interface WeatherRow {
  id: "wind" | "solar" | "temp";
  label: string;
  unit: string;
  stops: { light: [string, string]; dark: [string, string] };
  format: (v: number) => string;
}

export const WEATHER_ROWS: WeatherRow[] = [
  { id: "wind", label: "Wind speed 10 m", unit: "km/h", stops: { light: ["#dceef2", "#2b8ba3"], dark: ["#174049", "#6fd0e2"] }, format: (v: number) => `${v.toFixed(1)} km/h` },
  { id: "solar", label: "Shortwave radiation", unit: "W/m²", stops: { light: ["#dceef2", "#a64b0c"], dark: ["#174049", "#f48822"] }, format: (v: number) => `${Math.round(v)} W/m²` },
  { id: "temp", label: "Temperature 2 m", unit: "°C", stops: { light: ["#dceef2", "#166474"], dark: ["#174049", "#a7e2ee"] }, format: (v: number) => `${v.toFixed(1)} °C` },
];

/** Percentile (linear interpolation) over the displayed values. */
export function pct(values: (number | null)[], p: number): number | null {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Map a value to a colour on the layer scale, given the displayed p5..p95. */
export function scaleColor(
  v: number | null,
  layer: { stops: { light: [string, string]; dark: [string, string] } },
  lo: number,
  hi: number,
  dark: boolean,
): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const [a, b] = dark ? layer.stops.dark : layer.stops.light;
  if (hi <= lo) return mix(a, b, 0.5);
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return mix(a, b, t);
}

/** Scale bounds: 5th–95th percentile of the displayed values (documented on the card). */
export function scaleBounds(values: (number | null)[]): { lo: number; hi: number } | null {
  const lo = pct(values, 5);
  const hi = pct(values, 95);
  if (lo == null || hi == null) return null;
  return { lo, hi: Math.max(hi, lo + 1e-9) };
}

/* ------------------------------------------------------------------------ *
 * Rhythm-grid ramps (the month x hour atlas grids).
 *
 * The anchor positions and hex stops below are SANCTIONED DESIGN
 * CONSTANTS from the approved prototype, not statistics: they are the
 * fixed palette of each grid. Everything else (domain, legend tick
 * values, gradient stops' placement) is computed at build time from the
 * grid data: the domain is the min/max of the grid's own cells, and
 * legend ticks are the inverse-position values at the anchor positions,
 * rounded to human values. No domain constant is ever copied from data.
 * ------------------------------------------------------------------------ */

export interface RampAnchor {
  /** Position 0..1 along the ramp. */
  position: number;
  /** Hex stop at that position. */
  color: string;
}

export interface RampDef {
  id: string;
  label: string;
  unit: string;
  /** Anchors sorted by position; sanctioned design constants. */
  anchors: RampAnchor[];
  /**
   * Position function over the data domain: "sqrt" takes the square root
   * of the linear position so spike hours do not wash out the normal
   * range; "linear" is the plain position.
   */
  mode: "sqrt" | "linear";
  /** Exact value format (hover tooltip). */
  format: (v: number) => string;
  /** Rounded human tick format for the legend; tick values are computed. */
  legendFormat: (v: number) => string;
}

/** "What you pay": mean day-ahead price, square-root positioned. */
export const PRICE_RAMP: RampDef = {
  id: "price",
  label: "What you pay",
  unit: "EUR/MWh",
  mode: "sqrt",
  anchors: [
    { position: 0, color: "#1e3a8a" }, // deep blue, negative
    { position: 0.25, color: "#93c5fd" }, // pale blue, cheap
    { position: 0.5, color: "#fde047" }, // yellow, moderate
    { position: 0.75, color: "#f97316" }, // orange, expensive
    { position: 1, color: "#7f1d1d" }, // dark red, extreme
  ],
  format: (v) => `${v.toFixed(1)} EUR/MWh`,
  legendFormat: (v) => `${Math.round(v)}`,
};

/** "How clean": mean renewable share of generation, linear. */
export const REN_RAMP: RampDef = {
  id: "ren",
  label: "How clean",
  unit: "%",
  mode: "linear",
  anchors: [
    { position: 0, color: "#f0fdf4" },
    { position: 0.35, color: "#bbf7d0" },
    { position: 0.65, color: "#4ade80" },
    { position: 0.85, color: "#15803d" },
    { position: 1, color: "#14532d" },
  ],
  format: (v) => `${v.toFixed(1)}%`,
  legendFormat: (v) => `${Math.round(v)}`,
};

/** Weather mini-grid ramps: each its own documented ramp, linear. */
export const WEATHER_RAMPS: Record<WeatherSeriesId, RampDef> = {
  wind: {
    id: "wind",
    label: "Wind speed",
    unit: "m/s",
    mode: "linear",
    anchors: [
      { position: 0, color: "#effafc" },
      { position: 0.5, color: "#6fc3d8" },
      { position: 1, color: "#0f353d" },
    ],
    format: (v) => `${v.toFixed(1)} m/s`,
    legendFormat: (v) => `${v.toFixed(1)}`,
  },
  solar: {
    id: "solar",
    label: "Solar irradiance",
    unit: "W/m²",
    mode: "linear",
    anchors: [
      { position: 0, color: "#fff8ec" },
      { position: 0.5, color: "#f5b04c" },
      { position: 1, color: "#a64b0c" },
    ],
    format: (v) => `${Math.round(v)} W/m²`,
    legendFormat: (v) => `${Math.round(v)}`,
  },
  temp: {
    id: "temp",
    label: "Temperature",
    unit: "°C",
    mode: "linear",
    anchors: [
      { position: 0, color: "#dbeafe" },
      { position: 0.5, color: "#fde68a" },
      { position: 1, color: "#c2410c" },
    ],
    format: (v) => `${v.toFixed(1)} °C`,
    legendFormat: (v) => `${Math.round(v)}`,
  },
};

/** Position of a value in the data domain under the ramp's mode, clamped 0..1. */
export function rampPosition(ramp: RampDef, v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  if (hi <= lo) return 0.5;
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return ramp.mode === "sqrt" ? Math.sqrt(t) : t;
}

/** Colour at ramp position t (piecewise linear between the anchor stops). */
export function rampColorAt(anchors: RampAnchor[], t: number): string {
  const sorted = [...anchors].sort((a, b) => a.position - b.position);
  const x = Math.max(0, Math.min(1, t));
  if (x <= sorted[0].position) return sorted[0].color;
  for (let i = 1; i < sorted.length; i++) {
    if (x <= sorted[i].position) {
      const span = sorted[i].position - sorted[i - 1].position;
      const f = span > 0 ? (x - sorted[i - 1].position) / span : 0;
      return mix(sorted[i - 1].color, sorted[i].color, f);
    }
  }
  return sorted[sorted.length - 1].color;
}

/** Colour of a value on the ramp over the domain [lo, hi]; null = no data. */
export function rampColor(ramp: RampDef, v: number | null, lo: number, hi: number): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return rampColorAt(ramp.anchors, rampPosition(ramp, v, lo, hi));
}

/**
 * Legend tick values: the domain values whose ramp position is each anchor
 * position (inverse of the position function), i.e. chosen in code from
 * the computed domain, never pasted constants.
 */
export function rampTickValues(ramp: RampDef, lo: number, hi: number): number[] {
  return ramp.anchors.map((a) => {
    const t = a.position;
    const lin = t * (ramp.mode === "sqrt" ? t : 1);
    return lo + lin * (hi - lo);
  });
}

/** CSS gradient string for the legend bar, built from the anchors. */
export function rampGradientCss(ramp: RampDef): string {
  const stops = [...ramp.anchors]
    .sort((a, b) => a.position - b.position)
    .map((a) => `${a.color} ${Math.round(a.position * 1000) / 10}%`)
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}
