/**
 * Heatmap layer scales. The hex stops are the code copy of the product
 * tokens appended in app/globals.css (light theme values; the dark theme is
 * derived by interpolating toward the dark stops — both palettes are listed
 * per layer so rendering needs no CSS reads). Colour spans the 5th–95th
 * percentile of the displayed values; null renders as a gap.
 */

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
