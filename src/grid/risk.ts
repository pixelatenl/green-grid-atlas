/**
 * The five derived risk indicators. Honest framing: these are indicators
 * computed from open data, not a grid-security assessment. Each indicator
 * has one documented rule (INDICATOR_RULES, repeated verbatim in the method
 * drawer) and a calm/watch/high level from documented thresholds. All inputs
 * are trailing-window hourly samples from the snapshot; nulls are skipped,
 * never treated as zero.
 */

import { percentile } from "./green-window.ts";

export interface RiskSample {
  price: number | null;
  renShareGen: number | null;
  load: number | null;
  netImportGW: number | null;
  windSolarMW: number | null;
}

export type RiskLevel = "calm" | "watch" | "high";

export interface RiskIndicator {
  key: string;
  label: string;
  /** The rule, verbatim (also in INDICATOR_RULES for the method drawer). */
  rule: string;
  /** Computed value in the indicator's unit, null when not computable. */
  value: number | null;
  unit: string;
  level: RiskLevel | "unknown";
}

export const RISK_PARAMS = {
  /** Trailing window for the 30-day indicators. */
  DAYS_30: 30,
  /** Trailing window for the Dunkelflaute run. */
  DAYS_90: 90,
  /** Wind+solar below this share of load counts as a Dunkelflaute hour. */
  DUNKELFAUTE_LOAD_SHARE: 20,
  /** Level thresholds, documented in INDICATOR_RULES. */
  NEGATIVE_PRICE_SHARE: { watch: 0.01, high: 0.05 },
  RED_HOURS_SHARE: { watch: 0.2, high: 0.35 },
  IMPORT_COVER_SHARE: { watch: 0.25, high: 0.4 },
  PRICE_SPREAD_EUR: { watch: 150, high: 250 },
  DUNKELFAUTE_RUN_HOURS: { watch: 24, high: 48 },
} as const;

export const INDICATOR_RULES: Record<string, string> = {
  negativePriceShare: `Share of trailing-${RISK_PARAMS.DAYS_30}-day hours with day-ahead price below 0 EUR/MWh. Watch at ≥ ${(RISK_PARAMS.NEGATIVE_PRICE_SHARE.watch * 100).toFixed(0)}%, high at ≥ ${(RISK_PARAMS.NEGATIVE_PRICE_SHARE.high * 100).toFixed(0)}%.`,
  redHoursShare: `Share of trailing-${RISK_PARAMS.DAYS_30}-day hours qualifying as red hours under the green window rule (price ≥ 70th percentile AND renewable share of generation ≤ 30th percentile, same code path as the green window). Watch at ≥ ${(RISK_PARAMS.RED_HOURS_SHARE.watch * 100).toFixed(0)}%, high at ≥ ${(RISK_PARAMS.RED_HOURS_SHARE.high * 100).toFixed(0)}%.`,
  importCoverShare: `Over the trailing ${RISK_PARAMS.DAYS_30} days: Σ max(0, net physical import in GW × 1000) / Σ load in MW — the share of Dutch load covered by net imports (cross-border physical flows, imports positive). Watch at ≥ ${(RISK_PARAMS.IMPORT_COVER_SHARE.watch * 100).toFixed(0)}%, high at ≥ ${(RISK_PARAMS.IMPORT_COVER_SHARE.high * 100).toFixed(0)}%.`,
  priceSpread: `Trailing-${RISK_PARAMS.DAYS_30}-day hourly price spread: 90th minus 10th percentile of day-ahead price, EUR/MWh. Watch at ≥ ${RISK_PARAMS.PRICE_SPREAD_EUR.watch} EUR/MWh, high at ≥ ${RISK_PARAMS.PRICE_SPREAD_EUR.high} EUR/MWh.`,
  dunkelflauteRun: `Longest consecutive run of hours in the trailing ${RISK_PARAMS.DAYS_90} days with wind onshore + wind offshore + solar below ${RISK_PARAMS.DUNKELFAUTE_LOAD_SHARE}% of load. Watch at ≥ ${RISK_PARAMS.DUNKELFAUTE_RUN_HOURS.watch} h, high at ≥ ${RISK_PARAMS.DUNKELFAUTE_RUN_HOURS.high} h.`,
};

function levelOf(value: number | null, watch: number, high: number): RiskLevel | "unknown" {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value >= high) return "high";
  if (value >= watch) return "watch";
  return "calm";
}

/**
 * Compute the five indicators. `samples30` are the trailing-30-day hourly
 * samples; `samples90` the trailing-90-day ones (for the Dunkelflaute run,
 * in chronological order). `redHoursShare` is passed in from the green
 * window rule so indicator 2 uses the exact same code path result.
 */
export function computeRiskIndicators(
  samples30: RiskSample[],
  samples90: RiskSample[],
  redHoursShare: number | null,
): RiskIndicator[] {
  const prices = samples30.map((s) => s.price).filter((v): v is number => v != null && Number.isFinite(v));
  const negative = prices.filter((p) => p < 0).length;
  const negativeShare = prices.length > 0 ? negative / prices.length : null;

  const loads = samples30.map((s) => s.load).filter((v): v is number => v != null && v > 0);
  const imports = samples30.map((s) => s.netImportGW).filter((v): v is number => v != null);
  let importCover: number | null = null;
  if (loads.length > 0) {
    let sumLoad = 0;
    let sumImport = 0;
    for (let i = 0; i < samples30.length; i++) {
      const l = samples30[i].load;
      const imp = samples30[i].netImportGW;
      if (l != null && l > 0 && imp != null && Number.isFinite(imp)) {
        sumLoad += l;
        sumImport += Math.max(0, imp * 1000);
      }
    }
    importCover = sumLoad > 0 ? sumImport / sumLoad : null;
  }

  const spread =
    prices.length > 0 ? percentile(prices, 90) - percentile(prices, 10) : null;

  let run = 0;
  let best = 0;
  for (const s of samples90) {
    const ws = s.windSolarMW;
    const l = s.load;
    const isDunkel = ws != null && l != null && l > 0 && ws / l < RISK_PARAMS.DUNKELFAUTE_LOAD_SHARE / 100;
    run = isDunkel ? run + 1 : 0;
    if (run > best) best = run;
  }
  const dunkelflauteRun = samples90.length > 0 ? best : null;

  const p = RISK_PARAMS;
  return [
    {
      key: "negativePriceShare",
      label: "Negative-price hours",
      rule: INDICATOR_RULES.negativePriceShare,
      value: negativeShare,
      unit: "share of hours",
      level: levelOf(negativeShare, p.NEGATIVE_PRICE_SHARE.watch, p.NEGATIVE_PRICE_SHARE.high),
    },
    {
      key: "redHoursShare",
      label: "Red-hour share",
      rule: INDICATOR_RULES.redHoursShare,
      value: redHoursShare,
      unit: "share of hours",
      level: levelOf(redHoursShare, p.RED_HOURS_SHARE.watch, p.RED_HOURS_SHARE.high),
    },
    {
      key: "importCoverShare",
      label: "Load covered by net imports",
      rule: INDICATOR_RULES.importCoverShare,
      value: importCover,
      unit: "share of load",
      level: levelOf(importCover, p.IMPORT_COVER_SHARE.watch, p.IMPORT_COVER_SHARE.high),
    },
    {
      key: "priceSpread",
      label: "Price spread (p90−p10)",
      rule: INDICATOR_RULES.priceSpread,
      value: spread,
      unit: "EUR/MWh",
      level: levelOf(spread, p.PRICE_SPREAD_EUR.watch, p.PRICE_SPREAD_EUR.high),
    },
    {
      key: "dunkelflauteRun",
      label: "Longest Dunkelflaute run",
      rule: INDICATOR_RULES.dunkelflauteRun,
      value: dunkelflauteRun,
      unit: "hours",
      level: levelOf(dunkelflauteRun, p.DUNKELFAUTE_RUN_HOURS.watch, p.DUNKELFAUTE_RUN_HOURS.high),
    },
  ];
}
