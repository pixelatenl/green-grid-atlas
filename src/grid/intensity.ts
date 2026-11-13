/**
 * Computed carbon intensity, generation-mix basis. See
 * docs/emission-factors.md for the versioned factor table and the
 * imports-not-attributed disclosure (repeated verbatim in the method drawer).
 */

import { EMISSION_FACTORS } from "./emission-factors.ts";

/**
 * Intensity in g CO2-eq/kWh = Σ(production_MW × factor) / load_MW.
 * Returns null when load is missing or non-positive, or no production
 * series with a known factor is present (rendered as a gap, never as zero).
 */
export function computedIntensityGPerKWh(
  mixMW: Record<string, number | null>,
  loadMW: number | null,
): number | null {
  if (loadMW == null || !Number.isFinite(loadMW) || loadMW <= 0) return null;
  let emissions = 0;
  let knownMW = 0;
  for (const [type, mw] of Object.entries(mixMW)) {
    const factor = EMISSION_FACTORS[type];
    if (factor && mw != null && Number.isFinite(mw)) {
      emissions += mw * factor.gCO2eqPerKWh;
      knownMW += mw;
    }
  }
  if (knownMW <= 0) return null;
  return emissions / loadMW;
}
