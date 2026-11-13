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

## Snapshot data contract

`src/data/snapshot.json` (generated, committed; see `src/data/snapshot.ts` for
the typed view) carries: `retrievedAt`; trailing 12 months of hourly NL series
(price, renewable_share_of_generation, computed intensity — rounded);
per-year composites (per-year hour × month means per series); records;
green window and red hours values; risk indicators; per-country score
summaries; weather overlay; narration cache with SHA-256 context signatures.
Target total under 2 MB. Never store raw history beyond what the page
renders; the backfill keeps only aggregates.
