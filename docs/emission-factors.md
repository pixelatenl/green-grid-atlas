# Emission factors — computed carbon intensity

Versioned artifact: **`ipcc-ar5-wg3-annex3-medians-v1`** (stamped into
`snapshot.json` as `emissionFactorsVersion`; the code copy lives in
`src/grid/emission-factors.ts` and must stay in sync with this table).

Default set: **IPCC, 2014: Climate Change 2014: Mitigation of Climate Change.
Contribution of Working Group III to the Fifth Assessment Report, Annex III,
Table A.III.2 — lifecycle emission medians (g CO2-eq/kWh)**.
Source: https://www.ipcc.ch/report/ar5/wg3/ — IPCC AR5 is published open
access under **Creative Commons Attribution-NonCommercial-ShareAlike 3.0 IGO
(CC BY-NC-SA 3.0 IGO)**, https://creativecommons.org/licenses/by-nc-sa/3.0/igo/.

| energy-charts series id | Factor (g CO2-eq/kWh) | Label | Source row |
| --- | --- | --- | --- |
| `fossil_hard_coal` | 820 | Hard coal | IPCC AR5 WGIII Annex III, Table A.III.2, coal median |
| `fossil_gas` | 490 | Natural gas | same table, natural gas median |
| `biomass` | 230 | Biomass (conservative median) | same table, biopower median; sustainably sourced biomass can be far lower, the median is used deliberately |
| `waste` | 600 | Waste incineration | same table, MSW/waste median |
| `others` | 24 | Other (assumed hydro-dominated residual) | same table, hydropower median used as proxy; assumption disclosed here and in the method drawer |
| `nuclear` | 12 | Nuclear | same table, nuclear median |
| `wind_onshore` | 11 | Wind onshore | same table, wind onshore median |
| `wind_offshore` | 12 | Wind offshore | same table, wind offshore median |
| `solar` | 46 | Solar PV | same table, solar PV median |

## Computed intensity rule

Computed carbon intensity of the NL grid, per hour:

```
intensity [g CO2-eq/kWh] = Σ(production_type_MW × factor) / load_MW
```

**Basis: generation mix.** Only domestic production types are multiplied by
the factors and divided by total load. **Imports are not attributed**: the
physical cross-border flows carry no fuel mix, so an import-heavy hour shows
a lower computed intensity than the power actually consumed would cause. This
limitation is disclosed verbatim in the method drawer wherever intensity is
shown.

A factor table revision is a versioned change: bump
`EMISSION_FACTORS_VERSION`, update this table and
`src/grid/emission-factors.ts` together, and state the change in the PR
description.
