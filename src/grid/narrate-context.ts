/**
 * Narration contexts, shared by scripts/narrate.mjs (build-time generation)
 * and the page (build-time signature verification). Deterministic code
 * computes every figure and builds the context; the model only narrates
 * the context. The SHA-256 of each context JSON is the signature stored
 * with the snapshot: a visual is re-narrated only when its context hash
 * changes, and the page renders a stored narration only when its stored
 * signature still matches the context it is rendered against.
 */

import { createHash } from "node:crypto";
import { formatBand, type WindowResult } from "./green-window.ts";

/** Minimal structural view of the snapshot the contexts need. */
export interface NarrationSnapshot {
  retrievedAt: string;
  zone: string;
  greenWindow: WindowResult & { rule: string };
  derived: { profiles30d: Record<string, (number | null)[]> };
  records: { key: string; label: string; timestamp: string; localLabel: string; value: number; unit: string }[];
  risk: { indicators: { key: string; label: string; value: number | null; unit: string; level: string }[] };
}

export interface NarrationContext {
  title: string;
  shows: string;
  figures: Record<string, string>;
}

const fmt = (v: number | null, digits = 1) =>
  v == null ? "unknown" : Number(v).toFixed(digits);

function profileFacts(profiles: Record<string, (number | null)[]>) {
  const at = (key: string, h: number) => profiles[key]?.[h] ?? null;
  const maxOf = (key: string) => {
    const arr = profiles[key] ?? [];
    let best = -Infinity;
    let bh = 0;
    arr.forEach((v, i) => {
      if (v != null && v > best) {
        best = v;
        bh = i;
      }
    });
    return { value: arr.length ? best : null, hour: bh };
  };
  const minOf = (key: string) => {
    const arr = profiles[key] ?? [];
    let worst = Infinity;
    let bh = 0;
    arr.forEach((v, i) => {
      if (v != null && v < worst) {
        worst = v;
        bh = i;
      }
    });
    return { value: arr.length ? worst : null, hour: bh };
  };
  return { at, maxOf, minOf };
}

/** The visuals that may carry an AI narration (cap: 2 calls each, 16/run). */
export const NARRATED_VISUALS = [
  "greenWindow",
  "redHours",
  "morningGasRamp",
  "solarValley",
  "eveningPeak",
  "windNight",
  "coda",
] as const;

export type NarratedVisual = (typeof NARRATED_VISUALS)[number];

export function buildContexts(snap: NarrationSnapshot): Record<NarratedVisual, NarrationContext> {
  const gw = snap.greenWindow;
  const p = gw.percentiles;
  const gb = gw.green.modalBand;
  const rb = gw.red.modalBand;
  const pf = profileFacts(snap.derived.profiles30d);
  const rec = (key: string) => snap.records.find((r) => r.key === key);
  const risk = (key: string) => snap.risk.indicators.find((i) => i.key === key);

  const contexts: Record<NarratedVisual, NarrationContext> = {
    greenWindow: {
      title: "The green window",
      shows:
        "The modal recurring band of green hours (cheap and renewable) in the trailing 30 days of the Dutch grid, with its frequency share.",
      figures: {
        modalBand: gb ? formatBand(gb) : "none",
        frequencySharePct: fmt(gw.green.frequencyShare * 100, 1) + "%",
        trailingDays: String(gw.green.days),
        priceP30_EUR_MWh: fmt(p.priceP30, 2),
        priceP70_EUR_MWh: fmt(p.priceP70, 2),
        renP70_pct: fmt(p.renP70, 1),
        renP30_pct: fmt(p.renP30, 1),
        basis: "renewable share of generation; NL day-ahead price",
      },
    },
    redHours: {
      title: "The red hours",
      shows:
        "The mirror of the green window: hours that are expensive AND low-renewable in the trailing 30 days, exact inverse rule, same code path.",
      figures: {
        modalBand: rb ? formatBand(rb) : "none",
        frequencySharePct: fmt(gw.red.frequencyShare * 100, 1) + "%",
        trailingDays: String(gw.red.days),
        priceP70_EUR_MWh: fmt(p.priceP70, 2),
        renP30_pct: fmt(p.renP30, 1),
        redHourSharePct: fmt((risk("redHoursShare")?.value ?? 0) * 100, 1) + "%",
      },
    },
    morningGasRamp: {
      title: "The morning gas ramp",
      shows:
        "The trailing-30-day average day profile of gas-fired production and price: gas ramps up in the morning while prices climb.",
      figures: {
        gasPeakMW: fmt(pf.maxOf("fossil_gas").value, 0),
        gasPeakHour: `${String(pf.maxOf("fossil_gas").hour).padStart(2, "0")}:00`,
        gasMinMW: fmt(pf.minOf("fossil_gas").value, 0),
        gasMinHour: `${String(pf.minOf("fossil_gas").hour).padStart(2, "0")}:00`,
        priceAtGasPeak_EUR_MWh: fmt(pf.at("price", pf.maxOf("fossil_gas").hour), 1),
        pricePeak_EUR_MWh: fmt(pf.maxOf("price").value, 1),
        pricePeakHour: `${String(pf.maxOf("price").hour).padStart(2, "0")}:00`,
      },
    },
    solarValley: {
      title: "The solar valley",
      shows:
        "The trailing-30-day average day profile of solar production and price: midday solar pushes prices down, opening the green window.",
      figures: {
        solarPeakMW: fmt(pf.maxOf("solar").value, 0),
        solarPeakHour: `${String(pf.maxOf("solar").hour).padStart(2, "0")}:00`,
        priceValley_EUR_MWh: fmt(pf.minOf("price").value, 1),
        priceValleyHour: `${String(pf.minOf("price").hour).padStart(2, "0")}:00`,
        renAtSolarPeak_pct: fmt(pf.at("ren", pf.maxOf("solar").hour), 1),
        greenBand: gb ? formatBand(gb) : "none",
      },
    },
    eveningPeak: {
      title: "The evening peak",
      shows:
        "The trailing-30-day average day profile of load, price and net imports: the evening demand peak is the red-hours territory.",
      figures: {
        loadPeakMW: fmt(pf.maxOf("load").value, 0),
        loadPeakHour: `${String(pf.maxOf("load").hour).padStart(2, "0")}:00`,
        pricePeak_EUR_MWh: fmt(pf.maxOf("price").value, 1),
        pricePeakHour: `${String(pf.maxOf("price").hour).padStart(2, "0")}:00`,
        importAtLoadPeak_GW: fmt(pf.at("netImport", pf.maxOf("load").hour), 2),
        importCoverSharePct: fmt((risk("importCoverShare")?.value ?? 0) * 100, 1) + "%",
        redBand: rb ? formatBand(rb) : "none",
      },
    },
    windNight: {
      title: "The wind night",
      shows:
        "The trailing-30-day average day profile of wind production and renewable share: windy nights are when the grid runs cleanest.",
      figures: {
        windPeakMW: fmt(pf.maxOf("wind").value, 0),
        windPeakHour: `${String(pf.maxOf("wind").hour).padStart(2, "0")}:00`,
        renPeakPct: fmt(pf.maxOf("ren").value, 1),
        renPeakHour: `${String(pf.maxOf("ren").hour).padStart(2, "0")}:00`,
        priceAtWindPeak_EUR_MWh: fmt(pf.at("price", pf.maxOf("wind").hour), 1),
        intensityMin_g: fmt(pf.minOf("intensity").value, 0),
      },
    },
    coda: {
      title: "The extremes",
      shows:
        "The dirtiest versus cleanest hour on record and the record set (highest/ most negative price, highest residual load, biggest import, Dunkelflaute day).",
      figures: {
        dirtiest: `${rec("dirtiestHour")?.localLabel ?? "?"} at ${fmt(rec("dirtiestHour")?.value ?? null, 0)} g CO2-eq/kWh`,
        cleanest: `${rec("cleanestHour")?.localLabel ?? "?"} at ${fmt(rec("cleanestHour")?.value ?? null, 0)} g CO2-eq/kWh`,
        highestPrice: `${rec("highestPrice")?.localLabel ?? "?"} at ${fmt(rec("highestPrice")?.value ?? null, 2)} EUR/MWh`,
        mostNegativePrice: `${rec("mostNegativePrice")?.localLabel ?? "?"} at ${fmt(rec("mostNegativePrice")?.value ?? null, 2)} EUR/MWh`,
        biggestImport: `${rec("biggestImport")?.localLabel ?? "?"} at ${fmt(rec("biggestImport")?.value ?? null, 2)} GW`,
        dunkelflaute: rec("dunkelflauteDay") ? `${fmt(rec("dunkelflauteDay")!.value, 1)}% daily mean renewable share` : "none",
      },
    },
  };
  return contexts;
}

/** SHA-256 context signature of one visual. */
export function contextSignature(context: NarrationContext): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

export function contextSignatures(snap: NarrationSnapshot): Record<string, string> {
  const contexts = buildContexts(snap);
  return Object.fromEntries(
    Object.entries(contexts).map(([k, v]) => [k, contextSignature(v)]),
  );
}
