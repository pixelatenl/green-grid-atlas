import raw from "../../public/data/snapshot.json";
import type { WindowResult } from "@/grid/green-window";
import type { RiskIndicator } from "@/grid/risk";

/*
  Typed view over the committed snapshot (public/data/snapshot.json, written
  by scripts/backfill.mjs and refreshed daily by scripts/snapshot.mjs; the
  same file is served same-origin at /data/snapshot.json for the widget and
  embeds). Every figure rendered on the page comes from this module;
  components never hardcode statistical literals.
*/

export interface TrailingDay {
  date: string;
  hours: number;
  dst: "spring" | "fall" | "normal";
  price: (number | null)[];
  ren: (number | null)[];
  intensity: (number | null)[];
  load: (number | null)[];
  residual: (number | null)[];
  netImport: (number | null)[];
  windMW: (number | null)[];
  solarMW: (number | null)[];
  flows: Record<string, (number | null)[]>;
  weather: { wind: (number | null)[]; solar: (number | null)[]; temp: (number | null)[] } | null;
}

export interface CompositeYear {
  year: number;
  /** series -> 24 hours x 12 months means; null where no data. */
  series: Record<string, (number | null)[][]>;
}

export interface FlowVolume {
  importTWh: number | null;
  exportTWh: number | null;
  netTWh: number | null;
}

export interface RecordEntry {
  key: string;
  label: string;
  timestamp: string;
  localLabel: string;
  value: number;
  unit: string;
  mix?: Record<string, number | null>;
}

export interface Snapshot {
  schemaVersion: number;
  zone: string;
  timezone: string;
  retrievedAt: string;
  emissionFactorsVersion: string;
  sources: {
    name?: string;
    energyCharts: {
      name: string;
      url: string;
      api: string;
      docs: string;
      licenseNote: string;
      license: string;
      licenseUrl: string;
    };
    priceLicense: string;
    powerLicense: string;
    openMeteo: {
      name: string;
      url: string;
      api: string;
      docs: string;
      license: string;
      licenseUrl: string;
      licencePage: string;
    };
    retrievedAt: string;
    endpoints: Record<string, string>;
  };
  weather: { available: boolean; point?: { latitude: number; longitude: number }; note?: string };
  trailing: { from: string | null; to: string | null; days: TrailingDay[] };
  nextDay: { deliveryDate: string | null; resolution: string; price15m: (number | null)[] } | null;
  composites: { years: CompositeYear[] };
  flowVolumes: { years: { year: number; neighbors: Record<string, FlowVolume> }[] };
  records: RecordEntry[];
  greenWindow: WindowResult & { rule: string };
  risk: { indicators: RiskIndicator[]; note: string };
  derived: { profiles30d: Record<string, (number | null)[]> };
  scores: {
    retrievedAt: string;
    basis: string;
    composition: string;
    countries: { country: string; meanSharePct: number | null; renewableDayShare: number | null; score: number | null; days: number }[];
  };
  narration: { signatures: Record<string, string>; visuals: Record<string, string> };
}

export const snapshot = raw as Snapshot;

/** en-GB number formatting per the family derived-sentence convention. */
export const nf = new Intl.NumberFormat("en-GB");
export function formatNumber(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function formatSigned(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = formatNumber(v, digits);
  return v > 0 ? `+${s}` : s;
}


