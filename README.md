# Green Grid Atlas

When is the greenest hour on the Dutch grid? An hour-by-day atlas of
day-ahead price, renewable share of generation and computed carbon
intensity since 2015, plus cross-border flows, risk indicators, a European
cleanliness score and the records — built from open data and refreshed
daily.

Live: https://grid-atlas.pixelate.nl — source: this repository.

## Data

- **energy-charts.info (Fraunhofer ISE), API v2** — keyless HTTP JSON
  (`https://api.energy-charts.info/v2`): NL day-ahead price (`/v2/price`),
  public power (`/v2/public_power`), cross-border physical flows
  (`/v2/cbpf`), tomorrow's prices (`/v2/price_next_day`), and per-zone daily
  renewable-share averages (`/v2/ren_share_daily_avg`). License **CC BY 4.0**
  with attribution to energy-charts.info; NL day-ahead prices carry
  **CC BY 4.0 from Bundesnetzagentur | SMARD.de** (per-response `license`
  field). Verified facts, pacing rule and attribution lines:
  [docs/data-notes.md](docs/data-notes.md).
- **Open-Meteo** historical weather archive — hourly wind speed 10 m,
  shortwave radiation and temperature 2 m for the NL area, keyless, CC BY 4.0.
- **Emission factors** for computed intensity: IPCC AR5 WGIII Annex III
  lifecycle medians — [docs/emission-factors.md](docs/emission-factors.md).

All ingest is politely paced (one request at a time, ≥ 31 s per endpoint,
`Retry-After` honored on 429) and cached on disk. See
`docs/data-notes.md` for the measured rate-limit behavior.

## Pipeline

- `scripts/backfill.mjs` — **one-time**, run locally or on the mini PC, never
  in CI: fetches the full 2015→present NL history, chunked per year, and writes
  only aggregates (per-year hour×month composites, per-year flow volumes, the
  records set, the trailing-12-month window) into `public/data/snapshot.json`.
- `scripts/snapshot.mjs` — **daily** (cron 12:35 UTC in
  `.github/workflows/snapshot.yml`): fetches yesterday complete, today
  partial and `price_next_day`; updates the rolling aggregates, records,
  derived indicators (green window, red hours, risk, profiles) and score
  summaries (NL daily, all zones on the first run of each ISO week); runs the
  signature-gated narration step; commits the snapshot to main, which triggers
  the deploy chain.
- `scripts/narrate.mjs` — the AI narration step: mistral-small-latest,
  temperature 0.2, numerals-only guidance, prose-ratio lint, SHA-256 context
  signatures, at most two calls per visual and sixteen per run, fail-soft.
  Key from `MISTRAL_API_KEY` (Actions secret) only.

## The green window rule

One documented rule, shared by the green card, the red-hours mirror and the
heatmap markers — implemented once in `src/grid/green-window.ts` (constants
`WINDOW_PARAMS`), repeated verbatim in the site's method drawer: trailing 30
days of hourly values; green = price ≤ p30 AND renewable share of generation
≥ p70; red = the exact inverse (price ≥ p70 AND ren ≤ p30); the rendered
window is the modal recurring band with its frequency share.

## Stack

Next.js (App Router, static export) · React 19 · TypeScript · Tailwind CSS v4
· no chart libraries (pure SVG/CSS) · family registry components from
[pixelatenl/open-data-family](https://github.com/pixelatenl/open-data-family)
(copied verbatim from the local registry tree; diffs are only the product
values in `src/family.ts` and the appended product-token section in
`app/globals.css`).

## Develop

```bash
npm ci
npm run dev        # or: npm run build && npx serve out
npm run snapshot   # daily refresh (needs the backfill to have run once)
```

DST rule: all grids render in Europe/Amsterdam local time; the 23-hour and
25-hour days render their actual hour count (23 or 25 columns), with the
missing or doubled hour handled explicitly — documented in the method drawer.
