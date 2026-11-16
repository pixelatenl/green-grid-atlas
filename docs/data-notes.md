# Data notes — Green Grid Atlas

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
  2025 mixes PT1H and PT15M — always infer resolution per record from
  timestamp spacing, never from the envelope field).

### Resolution and coverage, NL (measured 2026-11-13)

| Series | Recent window | History |
| --- | --- | --- |
| `/v2/price?bzn=NL` | PT15M from at least 2025-10-01 (2025-09-15 is PT1H; boundary pinned between 2025-09-15 and 2025-10-01) | PT1H from 2015-01-05 (verified 2015-01-05..10, 2015-06-01, 2020-06-01, 2024-01-01, 2025-06-01) |
| `/v2/public_power?country=nl` | PT15M (2026-11-10..13: 369 records, until 20:00 today; 2025-06-01 already PT15M) | PT1H (2015-06-01 verified, 24 records) |
| `/v2/cbpf?country=nl` | PT15M (370 records for 2026-11-10..13) | PT15M since at least 2015-06-01 (96 records) |
| `/v2/price_next_day?bzn=NL` | PT15M, 96 records for the next local day; `attributes.delivery_date`; HTTP 404 while tomorrow's auction is unpublished (typically early afternoon CET) | — |

- Recent-window price probe (Phase 0 item 1), `bzn=NL&start=2026-11-10&end=2026-11-13`:
  **PT15M**, 384 records, `available_from 2026-11-10T00:00:00+01:00`,
  `available_until 2026-11-13T23:45:00+01:00` (today included in full —
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
  gap — never silently shifted. See `src/grid/amsterdam-time.ts`.

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
  **"Data: energy-charts.info (Fraunhofer ISE), CC BY 4.0 — day-ahead prices
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
  the single 02:00 weather value. Overlay only — never blocks the card.
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
    `Retry-After: 20` and body "Too Many Requests" — the first request alone
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
  repository secret; never logged, never cached to disk, never committed — the disk-cache keys in
  `scripts/lib-entsoe.mjs` are built from the document parameters only).
- Generation per production type: `documentType=A69`, `processType=A01`, `in_Domain=10YNL----------L`
  (NL bidding zone EIC). One `timeSeries` per `psrType`; `Period` carries `timeInterval` (start/end, UTC)
  and `resolution` (PT60M/PT15M); `Point` carries 1-based `position` and `quantity` in MW. Actual total
  load: `documentType=A65`, process type `A01`, `out_Domain=10YNL----------L`
  (the load document takes `out_Domain`; generation takes `in_Domain`).
- Window parameters `periodStart`/`periodEnd` as `yyyyMMddHHmm` in UTC; maximum one year per request
  (`scripts/lib-entsoe.mjs` `entsoeWindows` chunks by year at most; the trailing 365-day window fits in
  two requests per document type).
- Rate limit: 400 requests/minute per IP and per token; a 429 imposes a ten-minute ban. The fetch layer
  paces at one request per second, one at a time, and on 429 waits `Retry-After` (fallback 600 s) times
  the attempt number, capped at 900 s, up to 4 attempts.
- Timestamps are UTC interval starts (`...Z`). The pipeline converts them to Europe/Amsterdam through
  the shared `bucketHours`/`hourKey` path (a 25-hour fall-back day keeps both 02:00 slots, a 23-hour
  spring-forward day has none) and every build verifies the conversion hour-by-hour against the
  unchanged energy-charts price series (`verifyHourAlignment`): every ENTSO-E hour key must exist in
  the price series; price-only hours are a publication lag, not an error.
- psrType → site series mapping (`PSR_TYPES` in `scripts/lib-entsoe.mjs`): B16 Solar → `solar`,
  B19 Wind Onshore → `wind_onshore`, B18 Wind Offshore → `wind_offshore`, B01 Biomass → `biomass`,
  B17 Waste → `waste`, B14 Nuclear → `nuclear`, B02/B05 → `fossil_hard_coal`, B03/B04 → `fossil_gas`,
  everything else (hydro B10/B11/B12, geothermal B09, marine B13, oil/peat, other B15/B20, unknown) →
  `others`. The emission-factor table is keyed by energy-charts series ids and is unchanged.
- Renewable set, computed explicitly from the A69 per-type series: Solar, Wind Onshore, Wind Offshore,
  Biomass, Hydro Run-of-river and poundage, Hydro Water Reservoir, Hydro Pumped Storage (generation
  side only — A69 is generation), Geothermal, Waste (psrTypes B16, B19, B18, B01, B11, B12, B10, B09, B17).
- Composition check against the old feed (recomputed from the cached energy-charts per-type feeds,
  2025, PT15M): `renewable_share_of_generation` ≈ (biomass + waste + wind_onshore + wind_offshore +
  solar) / total generation, mean absolute difference about 1.3 percentage points (the served share is
  not exactly reproducible from the per-type feeds; the site keeps the served definition's composition,
  and the ENTSO-E renewable set above matches it — hydro/geothermal for NL sit inside energy-charts'
  `others`, which the served share does not count as renewable). Residual load =
  `load − wind_onshore − wind_offshore − solar` (mean absolute difference 0.04 MW on the 2025 cache).
  `renewable_share_of_load` ≈ (same renewable sum) / load; the daily score share for NL is the mean of
  the hourly shares per Amsterdam-local day, matching the energy-charts `ren_share_daily_avg` definition
  used by the other 35 zones (mean absolute difference 0.57 points on the 49 comparable days).
- Probe gate (`scripts/probe-entsoe.mjs`, run in Actions with the secret; figures recorded in the PR
  description): summer midday solar peak in the multi-GW range consistent with the installed fleet,
  trailing-window solar annualized in a plausible band around the CBS-reported ~25 TWh/yr, and summer
  solar above winter solar. If any criterion fails, the backfill does not run. A one-off cross-zone
  solar audit (`scripts/audit-zones.mjs`, energy-charts only) checks all 36 score zones' observed solar
  peak on 2026-06-15 as a share of installed solar AC capacity; the pre-fix NL shows about 1 percent.

## Snapshot data contract

`src/data/snapshot.json` (generated, committed; see `src/data/snapshot.ts` for
the typed view) carries: `retrievedAt`; trailing 12 months of hourly NL series
(price, renewable_share_of_generation, computed intensity — rounded);
per-year composites (per-year hour × month means per series); records;
green window and red hours values; risk indicators; per-country score
summaries; weather overlay; narration cache with SHA-256 context signatures.
Target total under 2 MB. Never store raw history beyond what the page
renders; the backfill keeps only aggregates.
