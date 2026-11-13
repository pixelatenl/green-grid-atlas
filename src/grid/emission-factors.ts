/**
 * Emission-factor table, versioned artifact. The full table with per-factor
 * source and license lives in docs/emission-factors.md; this module is the
 * code copy of the same version and must stay in sync with it (the snapshot
 * stamps EMISSION_FACTORS_VERSION into snapshot.json so a page build can
 * always name the table it used).
 *
 * Default set: IPCC AR5 WGIII Annex III Table A.III.2 lifecycle medians,
 * g CO2-eq per kWh (see docs/emission-factors.md for the per-factor rows,
 * sources and licenses).
 */

export const EMISSION_FACTORS_VERSION = "ipcc-ar5-wg3-annex3-medians-v1";

export interface EmissionFactor {
  /** Lifecycle emissions, g CO2-eq per kWh. */
  gCO2eqPerKWh: number;
  /** What the energy-charts series id stands for. */
  label: string;
}

/** Keyed by energy-charts public_power series id. */
export const EMISSION_FACTORS: Record<string, EmissionFactor> = {
  fossil_hard_coal: { gCO2eqPerKWh: 820, label: "Hard coal" },
  fossil_gas: { gCO2eqPerKWh: 490, label: "Natural gas" },
  biomass: { gCO2eqPerKWh: 230, label: "Biomass (conservative median)" },
  waste: { gCO2eqPerKWh: 600, label: "Waste incineration" },
  others: { gCO2eqPerKWh: 24, label: "Other (assumed hydro-dominated residual)" },
  nuclear: { gCO2eqPerKWh: 12, label: "Nuclear" },
  wind_onshore: { gCO2eqPerKWh: 11, label: "Wind onshore" },
  wind_offshore: { gCO2eqPerKWh: 12, label: "Wind offshore" },
  solar: { gCO2eqPerKWh: 46, label: "Solar PV" },
};

/** Production series ids the intensity computation consumes. */
export const PRODUCTION_TYPES = Object.keys(EMISSION_FACTORS);
