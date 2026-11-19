# Data notes: Green Grid Atlas

Documentation-first: every pipeline decision below was verified against the
live sources on **13 November 2026** (probes run from this repo's Phase 0).
Future pipeline work starts from this file, not from re-probing. Re-probe only
when a source changes its contract; record the change here with a date.

## 1. energy-charts.info API v2 (base: `https://api.energy-charts.info`)

- Keyless HTTP GET JSON. Self-describing catalog at `/v2` (schema_version 2.0,
  endpoint list with parameters), OpenAPI at `/openapi.json`, machine-readable
  docs at `/llms-full.txt`.
- Uniform envelope for every data endpoint: `schema_version`, `endpoint`,
  `timezone`, `resolution` (null when a requested range mixes resolutions),
  `interval_minutes`, `unit`, `generated_at`, `available_from`,
  `available_until`, `series[]` (id/name/unit), `data[]` of
  `{timestamp, values{...}}`, `attributes`, `license`, `deprecated`.
  Timestamps are ISO 8601 **with explicit UTC offset**, mark the START of the
  period, and are stated in the zone's local time (`Europe/Amsterdam` for NL).
  `available_from`/`available_until` reflect what actually contains data.
- Endpoints used: `/v2/price` (param `bzn`), `/v2/public_power` (param
  `country`), `/v2/cbpf` (param `country`), `/v2/price_next_day` (param
  `bzn`). Also present: `cbet`, `public_power_forecast` (DE only, not NL),
  `total_power`, `installed_power`, `price_current`, `frequency`, ren-share
  endpoints. `start`/`end` accept ISO 8601, a day (`2026-01-01`, local
  midnight to last minute), or unix seconds. Empty `start` defaults to today;
  empty `end` to `start`. A full-year range in one request works
  (2025 price = 15,387 records, ~1.2 MB; `resolution` is null there because
  2025 mixes PT1H and PT15M; always infer resolution per record from
  timestamp spacing, never from the envelope field).

### Resolution and coverage, NL (measured 2026-11-13)

| Series | Recent window | History |
| --- | --- | --- |
| `/v2/price?bzn=NL` | PT15M from at least 2025-10-01 (2025-09-15 is PT1H; boundary pinned between 2025-09-15 and 2025-10-01) | PT1H from 2015-01-05 (verified 2015-01-05..10, 2015-06-01, 2020-06-01, 2024-01-01, 2025-06-01) |
| `/v2/public_power?country=nl` | PT15M (2026-11-10..13: 369 records, until 20:00 today; 2025-06-01 already PT15M) | PT1H (2015-06-01 verified, 24 records) |
| `/v2/cbpf?country=nl` | PT15M (370 records for 2026-11-10..13) | PT15M since at least 2015-06-01 (96 records) |
| `/v2/price_next_day?bzn=NL` | PT15M, 96 records for the next local day; `attributes.delivery_date`; HTTP 404 while tomorrow's auction is unpublished (typically early afternoon CET) | n/a |

- Recent-window price probe (Phase 0 item 1), `bzn=NL&start=2026-11-10&end=2026-11-13`:
  **PT15M**, 384 records, `available_from 2026-11-10T00:00:00+01:00`,
  `available_until 2026-11-13T23:45:00+01:00` (today included in full;
  day-ahead is published a day ahead), zero nulls, zero gaps, unit
  `EUR / MWh`, series id `day_ahead_price`. Note: the appendix's "PT1H" for
  the recent window is outdated; recent is PT15M. The pipeline normalizes
  everything to hourly aggregates for rendering and keeps PT15M only where
  the widget's tomorrow-shape needs it.
- `public_power` NL series ids (unit MW unless noted):
  `cross_border_electricity_trading, nuclear, biomass, fossil_hard_coal,
  fossil_gas, others, waste, wind_offshore, wind_onshore, solar, load,
  residual_load, renewable_share_of_load (%), renewable_share_of_generation (%)`.
- `cbpf` NL series ids (GW): `belgium, denmark, germany, norway,
  united_kingdom, sum`; `attributes.sign_convention`:
  "positive = import, negative = export".
- `price_next_day` NL: series id `day_ahead_price`, PT15M, license as price.

### DST on the source side (measured)

- Fall-back day 2026-10-25: price returns **100** PT15M records (25 hours);
  the 02:00 hour appears twice with different offsets (`+02:00` then `+01:00`).
- Spring-forward day 2026-03-29: **92** records (23 hours); no 02:00 slot.
- Rule implemented downstream: all grids render in Europe/Amsterdam local
  time; a day column count equals the day's actual hour count (23/24/25);
  the doubled fall-back hour renders as two explicitly labelled columns
  (02:00 CEST and 02:00 CET), the missing spring-forward hour as a visible
  gap, never silently shifted. See `src/grid/amsterdam-time.ts`.

## 2. Attribution and license (energy-charts.info)

The site (energy-charts.info, run by Fraunhofer ISE) renders its imprint/license
pages via JavaScript; the authoritative machine-readable statements served by
the API host (`https://api.energy-charts.info/openapi.json` info.description,
mirrored in `/llms-full.txt`) say, verbatim:

- Data License: **"Unless stated otherwise, the data provided by the
  Energy-Charts API is licensed under the CC BY 4.0 license. Proper attribution
  to Energy-Charts.info as the source is required."**
- **"Data license: CC BY 4.0 with attribution to energy-charts.info unless the
  response's `license` field states otherwise (day-ahead prices carry their
  license per bidding zone; several zones are CC BY 4.0 from Bundesnetzagentur
  | SMARD.de, all others are restricted to private and internal use)."**
- Observed per-response `license` fields (2026-11-13), recorded verbatim for
  the method drawer:
  - `/v2/price` and `/v2/price_next_day`, bzn=NL:
    `CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de`
  - `/v2/public_power` and `/v2/cbpf`, country=nl:
    `CC BY 4.0 (creativecommons.org/licenses/by/4.0), attribution: energy-charts.info`
- Publishing-notes / imprint URL referenced by the OpenAPI document:
  `https://energy-charts.info/publishing-notes.html`; contact:
  `https://energy-charts.info/contact.html`.
- Attribution line used in the footer credits zone (verbatim):
  **"Data: energy-charts.info (Fraunhofer ISE), CC BY 4.0; day-ahead prices
  CC BY 4.0 from Bundesnetzagentur | SMARD.de"** with links
  https://energy-charts.info and https://creativecommons.org/licenses/by/4.0/.

## 3. Open-Meteo historical weather (keyless, verified)

- Historical archive API: `https://archive-api.open-meteo.com/v1/archive`,
  keyless, no registration. Probe (2026-11-13): `latitude=52.1326&longitude=5.2913`
  (the API snaps to its model grid; requested 52.1326/5.2913, answered
  52.126537/5.3038673, elevation 44 m, central NL), `start_date=2026-11-01&
  end_date=2026-11-12&hourly=wind_speed_10m,shortwave_radiation,temperature_2m&
  timezone=Europe%2FAmsterdam` → HTTP 200, 288 hourly rows (2026-11-01T00:00
  .. 2026-11-12T23:00 local), units `wind_speed_10m km/h`,
  `shortwave_radiation W/m²`, `temperature_2m °C`, zero nulls. History back to
  1940 verified for 2015-03-29..30 (48 rows).
- DST note: Open-Meteo emits exactly 24 local-hour labels per calendar day on
  DST switch days too (2015-10-25 fall-back returns 24 slots 00:00–23:00), so
  the weather overlay joins to the grid on (local date, local hour) and never
  fabricates a 25th hour; on fall-back days the two 02:00 grid columns share
  the single 02:00 weather value. Overlay only, never blocks the card.
- License (open-meteo.com/en/licence, checked 2026-11-13): all API data is
  licensed **CC BY 4.0** ("Attribution"), attribution to Open-Meteo; weather
  model data from national agencies under their open licenses. Terms:
  https://open-meteo.com/en/terms (non-commercial free tier, 10,000 calls/day).
- Graceful degradation (Phase 0 item 3): all three variables are usable for
  the NL area, keyless; if any fetch fails in a snapshot run, the weather
  overlay block is omitted from the snapshot and the card renders without it.

## 4. Rate limiting / pacing rule (measured, and now the rule everywhere)

- Documented (api.energy-charts.info/llms-full.txt, verbatim): "Requests are
  rate limited per client IP and per endpoint (token bucket, short bursts
  allowed): 2 requests/minute by default (burst 4), `signal` 20/minute
  (burst 40), `price` 2/minute (burst 2); each `/v2` endpoint inherits the
  limit of its v1 counterpart. The limits are additionally adjusted
  dynamically to the current server load, so treat them as an upper bound
  rather than a guarantee. On HTTP 429, wait and retry (honour the
  `Retry-After` header, in seconds) and cache results on your side."
- Measured from this network, 2026-11-13 (Phase 0 item 4):
  - A second back-to-back request to `/v2/price` returns **HTTP 429** with
    `Retry-After: 20` and body "Too Many Requests"; the first request alone
    was fine.
  - Spaced probes: at 2 s spacing, 6 of 15 requests succeeded; at 5 s, 7 of
    10; at 10 s, 7 of 8 (one 429 mid-run). The token bucket refills at
    2/minute for `/price`, so **sustained safe spacing is one request per
    ~30 s per endpoint**; short bursts up to the burst size are allowed but
    were observed to trip the dynamic limiter under load.
- **Pacing rule used by every ingest script in this repo** (backfill.mjs,
  snapshot.mjs): one request at a time, never concurrent; minimum 31 s
  between requests to the same endpoint (enforced by a per-endpoint timer);
  on HTTP 429, wait the `Retry-After` header (fallback 20 s) times an
  exponential backoff factor (attempt n waits `retryAfter × n`, capped at
  120 s), up to 6 attempts; on other failures, backoff 5 s × attempt. All
  fetched responses are cached on disk (`scripts/.cache/`, gitignored) so
  re-runs do not re-hit the API. Open-Meteo is paced at ≥ 2 s between
  requests (its published free limit is 10,000 calls/day, 600/min).

## 5. Country coverage for the European card

- The v2 envelope is uniform across countries; `country` allowed values
  (catalog at `/v2`) cover ~38 zones (at, ba, be, bg, ch, ... , nl, no, pl, pt,
  ro, rs, se, si, sk, ua, uk, xk, plus eu/all aggregates). The production
  series catalog differs per country; the snapshot schema is keyed per zone
  and components render from the series list (zone-generic by design).
- NL refreshes daily in the snapshot run; all other countries refresh on the
  first snapshot run of each week.

## 6. ENTSO-E Transparency Platform, NL bidding zone (added 2026-11-16)

The energy-charts NL solar series is defective: on 2026-06-15 its NL solar peak was 319.3 MW against a
29.28 GW installed solar AC fleet (the same source's `/v2/installed_power`, latest `solar_ac` record), about
1 percent, and it sums to roughly 0.48 TWh per year, while CBS reports 25.52 billion kWh of Dutch solar
production in 2025 (provisional). NL generation and load therefore moved to ENTSO-E per-type data; every
other zone keeps its energy-charts feed.

- Endpoint: `https://web-api.tp.entsoe.eu/api`, GET only, XML response. Authentication via the
  `securityToken` query parameter, read from the `ENTSOE_API_TOKEN` environment variable (Actions
  repository secret; never logged, never cached to disk, never committed; the disk-cache keys in
  `scripts/lib-entsoe.mjs` are built from the document parameters only).
- Actual generation per production type: `documentType=A75`, `processType=A16` (realised),
  `in_Domain=10YNL----------L` (NL bidding zone EIC). One `TimeSeries` per `psrType`; `Period` carries
  `timeInterval` (start/end, UTC) and `resolution` (PT60M/PT15M); `Point` carries 1-based `position` and
  `quantity` in MW (`quantity_Measure_Unit.name` = MAW). Actual total load: `documentType=A65`,
  `processType=A16`, `outBiddingZone_Domain=10YNL----------L` (the load document requires
  `outBiddingZone_Domain`; generation takes `in_Domain`; both verified against the live API in the
  probe gate). The series element is capitalized `TimeSeries` with `psrType` nested under `MktPSRType`.
  Note: the `A69`/`A01` pair named in the original change request is the wind-and-solar day-ahead
  forecast (businessType A93/A94); it returns only B16/B18/B19 and its NL solar sums to roughly a
  third of the CBS figure; the probe gate records those numbers as an appendix. `A75`/`A16` is the
  actual per-type document.
- Window parameters `periodStart`/`periodEnd` as `yyyyMMddHHmm` in UTC; maximum one year per request
  (`scripts/lib-entsoe.mjs` `entsoeWindows` chunks by year at most; the trailing 365-day window fits in
  two requests per document type).
- Rate limit: 400 requests/minute per IP and per token; a 429 imposes a ten-minute ban. The fetch layer
  paces at one request per second, one at a time, and on 429 waits `Retry-After` (fallback 600 s) times
  the attempt number, capped at 900 s, up to 4 attempts.
- Dual-version platform responses and the fetch-layer integrity guard (added 2026-11-17, after probe runs
  43975014678 and 44049087239): every A75 response carries each psrType in two `TimeSeries` blocks (in the
  one-day documents two passes of ten series each, mRID 1-10 and 11-20, both PT15M, one block complete and
  one partial), and the documents carry no `docStatus` and no `revisionNumber`. On 2026-11-17 the platform
  served two conflicting versions of the same window minutes apart: a healthy variant (B20 summer peak
  11,185 MW, 117-119 GWh/day, gas max 7,493 MW, B16+B20 35.9-39.2 TWh/yr, total 122.2 TWh) and a degraded
  variant (B20 flat ~500-520 MW day and night, 12.3 GWh/day, gas ~123 MW at noon, 0.6 TWh/yr of gas, total
  generation 33.7 TWh/yr against a healthy 118.7 TWh/yr A65 load document, coherence ratio 0.28). The
  degraded variant is objectively false against the load document and the official statistics (CBS 2025:
  solar 25.5, onshore wind 16.4, offshore 15.6 TWh), not a revised truth, so rejecting it is a coherence
  judgment, not an editorial preference. Probe run 44049087239 then proved that BOTH versions coexist in
  every A75 document (the two blocks are always served together, in either document order), which is what
  motivated the structural block preference below. `parseEntsoeIntervals` groups the TimeSeries into
  blocks (a repeat of a psrType already seen in the current block starts a new block; every series belongs
  to exactly one block), computes each block's coverage (distinct timestamps covered by the block, summed
  over all its series), and dedups per (psrType, timestamp) with the preference chain docStatus A05 →
  higher revisionNumber → record from the block with the greater total coverage → finer resolution →
  first in document order. The block preference is a completeness preference, never a value comparison:
  the complete collection is the authoritative full accounting, the partial collection is a subset feed,
  the same family of structural preference as docStatus A05 or a higher revision number. The parser also
  reports, BEFORE dedup, per-psrType copy statistics (per TimeSeries copy: block, point count, first/last
  timestamp, mean MW over the copy's own covered timestamps, energy in GWh; per psrType: how many
  (psrType, timestamp) keys carry more than one record and how many of those carry differing values) and
  the per-block coverage figures, so the preference is auditable. `fetchNlPowerEnvelope` guards every year
  window with the coherence ratio as the SOLE gated check, with bounded fresh retries; the
  fetch-integrity constants (NOT probe-gate criteria; never edited to make a run pass):
  - coherence ratio band **0.6-1.4**: total generation energy / total load energy, computed only over
    timestamps where generation data exists. Derivation: Dutch annual generation has been roughly
    85-105% of load (CBS, record production and record exports in 2025), while the degraded variant
    observed in runs 43975014678/44049087239 sits at 0.28-0.32, far outside any honest window. With the
    block preference in place the ratio lands in band deterministically; a ratio failure now means
    genuinely incoherent serving, and failing legibly is the correct outcome.
  - materiality floor **50 MW**: per-copy divergence is REPORTED as evidence (never gated) only for
    psrTypes whose largest per-copy mean exceeds this floor. The ambiguity factor-2 gate of the first
    version of this guard was WITHDRAWN: run 44049087239 proved that large per-copy divergences are the
    normal serving pattern (both blocks always coexist), so a factor-2 divergence is not a defect signal
    and such a gate rejects healthy documents.
  - **3 attempts** per window: an attempt failing the coherence check re-fetches that window's A75
    document fresh (bypassing the disk cache, paced as usual); the first passing attempt is kept. If no
    attempt passes, the window is marked failed and surfaced with the full attempts table (per attempt:
    ratio, per-type copy-divergence evidence, block coverage figures, coverage), so the probe's
    entsoeFetch criterion fails with a legible reason and the stop rule applies. Copies are never summed,
    versions are never mixed across retries, there is never a fallback to another data source. If the two
    blocks ever tie in total coverage, the chain falls through to finer resolution and then document
    order, so the attempt may draw either version; the ratio band then catches a degraded draw legibly,
    a structural misfire fails loudly, it never ships silently.
  - coverage (the fraction of the window's load-bearing timestamps that also carry generation data) is
    reported per window and per attempt but NOT gated; the probe criteria catch undercoverage, and the
    daily snapshot's fresh windows legitimately tolerate sparse coverage at the publication lag.
- Timestamps are UTC interval starts (`...Z`). The pipeline converts them to Europe/Amsterdam through
  the shared `bucketHours`/`hourKey` path (a 25-hour fall-back day keeps both 02:00 slots, a 23-hour
  spring-forward day has none) and every build verifies the conversion hour-by-hour against the
  unchanged energy-charts price series (`verifyHourAlignment`): every ENTSO-E hour key must exist in
  the price series; price-only hours are a publication lag, not an error.
- psrType → site series mapping (`PSR_TYPES` in `scripts/lib-entsoe.mjs`): B16 Solar and B20 Other
  renewable → `distribution_renewables` (one aggregate series; see the composition decision below),
  B19 Wind Onshore → `wind_onshore`, B18 Wind Offshore → `wind_offshore`, B01 Biomass → `biomass`,
  B17 Waste → `waste`, B14 Nuclear → `nuclear`, B02/B05 → `fossil_hard_coal`, B03/B04 → `fossil_gas`,
  everything else (hydro B10/B11/B12, geothermal B09, marine B13, oil/peat, other B15, unknown) →
  `others`. The emission-factor table is keyed by site series ids; `distribution_renewables` carries the
  solar PV median factor (46 g CO2-eq/kWh), the same value the old `solar` key carried.
- Composition decision (product owner, 2026-11-16): for the NL zone the TSO reports solar plus other
  distribution-connected renewables as a single upscaled estimate under B20, while B16 carries only the
  small directly measured share; the missing onshore wind volume and the B20 excess are the same volume
  (B19 annualizes low against the official onshore figure while B16+B20 runs high against the official
  solar figure, and the implied renewable total matches). The site ships the aggregate as
  `distribution_renewables`, honestly labeled, and never decomposes it; every component is renewable, so
  the renewable share is unaffected.
- Renewable set, computed explicitly from the A75 per-type series via the per-psrType renewable flags:
  B16+B20 distribution-connected renewables, Wind Onshore, Wind Offshore, Biomass, Hydro Run-of-river and
  poundage, Hydro Water Reservoir, Hydro Pumped Storage (generation side), Geothermal, Waste (psrTypes
  B16, B20, B19, B18, B01, B11, B12, B10, B09, B17).
- Composition check against the old feed (recomputed from the cached energy-charts per-type feeds,
  2025, PT15M): `renewable_share_of_generation` ≈ (biomass + waste + wind_onshore + wind_offshore +
  solar) / total generation, mean absolute difference about 1.3 percentage points (the served share is
  not exactly reproducible from the per-type feeds; the site keeps the served definition's composition,
  and the ENTSO-E renewable set above matches it; hydro/geothermal for NL sit inside energy-charts'
  `others`, which the served share does not count as renewable). Residual load =
  `load − wind_onshore − wind_offshore − distribution_renewables` (mean absolute difference 0.04 MW on
  the 2025 cache).
  `renewable_share_of_load` ≈ (same renewable sum) / load; the daily score share for NL is the mean of
  the hourly shares per Amsterdam-local day, matching the energy-charts `ren_share_daily_avg` definition
  used by the other 35 zones (mean absolute difference 0.57 points on the 49 comparable days).
- Probe gate (`scripts/probe-entsoe.mjs`, run in Actions with the secret; full report recorded in the PR
  description). All criteria are computed from one deduplicated trailing-year A75/A65 series; the
  2026-06-15 and 2026-01-15 sample days are extracted from it: (1) the aggregate's peak in the summer
  sample day's local midday window (10:00-15:00) must be at least 10 percent of the daylight-connected
  fleet, solar AC 29.28 GW plus onshore wind 7.18 GW = 36.46 GW (energy-charts installed_power, latest
  record), expected 30-45 percent; (2) the B16+B20 aggregate must annualize to 30-42 TWh/yr (official
  solar 25.5 plus official onshore wind 16.4, with slack for the window offset); (3) diurnality: the
  trailing-year mean of the aggregate over local midday hours (10:00-15:00) must be at least 3 times its
  mean over local night hours (00:00-05:00), expected about 4-5; plus the hour-alignment check and a
  double-count cross-check that must agree with criterion 2 to the MWh. If any criterion fails, the
  backfill does not run. The fetch layer's block preference and window coherence check (see the
  dual-version bullet above) run before the criteria; its per-window attempts table (ratio, per-copy
  divergence evidence, block coverage, accepted attempt) and the accepted attempt's per-type copy
  statistics are printed in the probe report figures (`windowAttempts`, `trailingWindowCopies`). A one-off cross-zone solar audit (`scripts/audit-zones.mjs`, energy-charts
  only) checks all 36 score zones' observed solar peak on 2026-06-15 as a share of installed solar AC
  capacity; the pre-fix NL shows about 1 percent.
- Rolling fetch ends are Amsterdam-local dates (added 2026-11-18). Backfill run 44199925847
  failed the full-history alignment check with `Error: ENTSO-E UTC->CET/CEST alignment check
  FAILED for full history: 1 hour keys not present in the reference series (first:
  2026-11-18T00:60). Aborting; nothing was written.` The key `2026-11-18T00:60` is the DST-safe
  slot format (local date, local hour, UTC offset in minutes): local hour 00 of 2026-11-18 at
  UTC+1, a valid slot, not a corrupt timestamp. Cause: the energy-charts price reference ended
  at the calendar date built from the UTC date of the run instant while the ENTSO-E fetch ended
  at the instant itself, so between 00:00 and 01:00 local in winter (00:00 to 02:00 in summer)
  the Amsterdam-local date is one day ahead of the UTC date and the ENTSO-E window reached one
  local hour beyond the price reference; the alignment check correctly refused, and nothing was
  written. Rule: rolling fetch ends (energy-charts price/cbpf, Open-Meteo) are Amsterdam-local
  dates via `dayKey` from `src/grid/amsterdam-time.ts` in `scripts/backfill.mjs`,
  `scripts/snapshot.mjs` and the probe's alignment reference in `scripts/probe-entsoe.mjs`,
  while the ENTSO-E fetch stays instant-based (periodEnd = now). The energy-charts end date is
  inclusive through the full end date in zone-local time, so one local day of coverage is
  exactly sufficient; the Open-Meteo request is already explicitly timezone Europe/Amsterdam.
- Daily per-type profiles (added 2026-11-19). The daily snapshot run rebuilds the per-type keys of
  `derived.profiles30d` (`fossil_gas`, `distribution_renewables`, `wind`) by joining the live ENTSO-E
  NL envelope onto the samples rebuilt from the stored trailing days, because the stored day structure
  carries no per-type mix. The join keys on the slot's UTC instant through the shared `bucketHours`
  path (`mixMapFromPowerEnv` in `scripts/lib-snapshot.mjs`), reusing the full-year envelope the run
  already fetches for the NL score, so no new fetch is added. Hours with a missing envelope entry
  contribute honest nulls: `profilesFromSamples` counts each key independently, and `wind` is null
  rather than zero when a sample carries no wind entries.

## Snapshot data contract

`src/data/snapshot.json` (generated, committed; see `src/data/snapshot.ts` for
the typed view) carries: `retrievedAt`; trailing 12 months of hourly NL series
(price, renewable_share_of_generation, computed intensity, rounded);
per-year composites (per-year hour × month means per series); records;
green window and red hours values; risk indicators; per-country score
summaries; weather overlay; narration cache with SHA-256 context signatures.
Target total under 2 MB. Never store raw history beyond what the page
renders; the backfill keeps only aggregates.
