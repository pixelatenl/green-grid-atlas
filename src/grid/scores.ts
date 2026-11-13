/**
 * European cleanliness score, per country (zone-generic). One request per
 * country per refresh: /v2/ren_share_daily_avg?country=XX&year=-1, the daily
 * renewable share of load for the trailing 365 days.
 *
 * Composition (named on the card and in the method drawer): score =
 * 0.5 × mean daily renewable share of load (trailing 365 days) +
 * 0.5 × share of days with renewable share ≥ 50%, scaled to 0-100
 * (clamped; the mean share itself can exceed 100% in exporter zones).
 * Basis: renewable share of LOAD (what consumption is served with), not of
 * generation — imports included on the consumption side. Null days are
 * skipped, never counted as zero.
 */

export const SCORE_PARAMS = {
  RENEWABLE_DAY_THRESHOLD_PCT: 50,
  MEAN_WEIGHT: 0.5,
  DAY_SHARE_WEIGHT: 0.5,
} as const;

export interface CountryScore {
  country: string;
  /** Mean daily renewable share of load, percent, trailing 365 days. */
  meanSharePct: number | null;
  /** Share of days at or above the renewable-day threshold, 0-1. */
  renewableDayShare: number | null;
  /** 0-100 score per the composition above. */
  score: number | null;
  /** Days in the sample. */
  days: number;
}

export function computeScore(country: string, dailyShares: (number | null)[]): CountryScore {
  const vals = dailyShares.filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) {
    return { country, meanSharePct: null, renewableDayShare: null, score: null, days: 0 };
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const dayShare =
    vals.filter((v) => v >= SCORE_PARAMS.RENEWABLE_DAY_THRESHOLD_PCT).length / vals.length;
  // Renewable share of load can exceed 100% in hydro/wind exporters; the
  // score is clamped to 0-100 (the mean itself is reported unclamped).
  const score = Math.max(
    0,
    Math.min(
      100,
      SCORE_PARAMS.MEAN_WEIGHT * mean + SCORE_PARAMS.DAY_SHARE_WEIGHT * 100 * dayShare,
    ),
  );
  return {
    country,
    meanSharePct: Math.round(mean * 10) / 10,
    renewableDayShare: Math.round(dayShare * 1000) / 1000,
    score: Math.round(score * 10) / 10,
    days: vals.length,
  };
}

/** Zones covered by the energy-charts country catalog, minus the eu/all aggregates. */
export const EUROPE_COUNTRIES = [
  "at", "ba", "be", "bg", "ch", "cy", "cz", "de", "dk", "ee", "es", "fi",
  "fr", "ge", "gr", "hr", "hu", "ie", "it", "lt", "lu", "lv", "md", "me",
  "mk", "nl", "no", "pl", "pt", "ro", "rs", "se", "si", "sk", "ua", "uk", "xk",
];
