import { Drawer } from "@/components/drawer";
import { formatDate } from "@/format-date";
import { snapshot } from "@/data/snapshot";
import { WINDOW_RULE_TEXT, WINDOW_PARAMS } from "@/grid/green-window";

/*
  Probe gate figures from scripts/probe-entsoe.mjs, Actions run 43975014678
  (run with the ENTSOE_API_TOKEN secret; full report recorded in the pull
  request description). Each figure names its source inline where it is used.
*/
const PROBE_PEAK_GW = "0.7"; // ENTSO-E A75/A16 aggregate peak, 2026-06-15 local midday, GW
const PROBE_PEAK_SHARE_PCT = "2"; // peak as % of the daylight-connected fleet
const PROBE_DAYLIGHT_FLEET_GW = "36.46"; // energy-charts installed_power latest record: solar_ac + wind_onshore, GW
const PROBE_ANNUAL_TWH = "4.7"; // ENTSO-E B16+B20 trailing-year aggregate, annualized TWh/yr
const PROBE_DIURNAL_RATIO = "1.3"; // trailing-year local midday mean / night mean of the aggregate

/*
  The Method and sources drawer, seated in the family footer's extra slot.
  Server component: everything renders at build time into the drawer body
  (the drawer stays mounted, hidden plus inert), so the whole method ships
  in the static HTML. Verbatim blocks: the energy-charts attribution, the
  basis disclosure, the green window rule, the DST rule.
*/
export function MethodDrawer() {
  const s = snapshot.sources;
  return (
    <Drawer
      label="Method and sources"
      title="Method and sources"
      description="Every figure on this page traces to the committed snapshot, which records its source, license and retrieval date for each series."
    >
      <div className="flex flex-col gap-5 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h3 className="font-semibold text-foreground">Sourcing rule</h3>
          <p className="mt-1">
            Every figure on this page is fetched by scripts/backfill.mjs (once, full history) and
            scripts/snapshot.mjs (daily, 12:35 UTC) from the cited open data sources, politely paced
            (one request at a time, ≥ 31 s per endpoint, Retry-After honored), and stored with
            provenance in public/data/snapshot.json. Nothing statistical is hand-entered; all derived
            values are computed at render time or snapshot time from snapshot fields by the shared rule
            modules in src/grid. No API call ever happens from the client.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">Sources and licenses</h3>
          <ul className="mt-1 list-disc space-y-2 pl-5">
            <li>
              <a href={s.energyCharts.url} className="underline underline-offset-4 hover:text-foreground">energy-charts.info</a>{" "}
              (Fraunhofer ISE), API{" "}
              <a href={s.energyCharts.api} className="underline underline-offset-4 hover:text-foreground">{s.energyCharts.api}</a>,{" "}
              OpenAPI at{" "}
              <a href={s.energyCharts.docs} className="underline underline-offset-4 hover:text-foreground">{s.energyCharts.docs}</a>.{" "}
              {s.energyCharts.license}{" "}
              <a href={s.energyCharts.licenseUrl} className="underline underline-offset-4 hover:text-foreground">CC BY 4.0</a>.
              Verbatim from the API docs: “{s.energyCharts.licenseNote}” Day-ahead price series (NL) carry their
              own per-response license field, verbatim: “{s.priceLicense}”. Production and flow series carry,
              verbatim: “{s.powerLicense}”. Endpoints used:{" "}
              {Object.entries(s.endpoints).map(([k, v]) => (
                <code key={k} className="mx-1 rounded bg-muted px-1 text-xs">{v}</code>
              ))}
              Retrieved {formatDate(s.retrievedAt)}.
            </li>
            <li>
              <a href={s.openMeteo.url} className="underline underline-offset-4 hover:text-foreground">Open-Meteo</a>{" "}
              historical weather archive ({" "}
              <a href={s.openMeteo.api} className="underline underline-offset-4 hover:text-foreground">{s.openMeteo.api}</a>), keyless, for the
              weather overlay at {snapshot.weather.point?.latitude}, {snapshot.weather.point?.longitude} (central
              NL). License{" "}
              <a href={s.openMeteo.licenseUrl} className="underline underline-offset-4 hover:text-foreground">CC BY 4.0</a>{" "}
              (see <a href={s.openMeteo.licencePage} className="underline underline-offset-4 hover:text-foreground">open-meteo.com/en/licence</a>).
              Retrieved {formatDate(s.retrievedAt)}. If the weather fetch fails, the overlay is omitted and the
              card renders without it — it never blocks the page.
            </li>
            {s.entsoe && (
              <li>
                <a href={s.entsoe.url} className="underline underline-offset-4 hover:text-foreground">ENTSO-E Transparency Platform</a>{" "}
                (API{" "}
                <a href={s.entsoe.api} className="underline underline-offset-4 hover:text-foreground">{s.entsoe.api}</a>), the
                source of the NL generation and load series: document type{" "}
                <code className="rounded bg-muted px-1 text-xs">{s.entsoe.documentTypes.generationPerType}</code>{" "}
                (actual generation per production type) and{" "}
                <code className="rounded bg-muted px-1 text-xs">{s.entsoe.documentTypes.actualTotalLoad}</code>{" "}
                (actual total load), process type{" "}
                <code className="rounded bg-muted px-1 text-xs">{s.entsoe.processType}</code>, bidding zone EIC{" "}
                <code className="rounded bg-muted px-1 text-xs">{s.entsoe.domainEIC}</code>. {s.entsoe.licenseNote}{" "}
                Retrieved {formatDate(s.entsoe.retrievedAt ?? s.retrievedAt)}.
              </li>
            )}
            <li>
              Emission factors: IPCC AR5 WGIII Annex III Table A.III.2 lifecycle medians, version{" "}
              <code className="rounded bg-muted px-1 text-xs">{snapshot.emissionFactorsVersion}</code> — full
              per-factor table with sources and licenses in docs/emission-factors.md, code copy in
              src/grid/emission-factors.ts.
            </li>
          </ul>
        </section>

        {s.entsoe && (
          <section>
            <h3 className="font-semibold text-foreground">NL generation and load: sourcing basis</h3>
            <p className="mt-1">
              The Netherlands hourly generation per production type and actual total load come from the ENTSO-E
              Transparency Platform (document types {s.entsoe.documentTypes.generationPerType} and{" "}
              {s.entsoe.documentTypes.actualTotalLoad}, process type {s.entsoe.processType}, bidding zone EIC{" "}
              {s.entsoe.domainEIC}), retrieved daily by the snapshot job and once for the full-history backfill.
              ENTSO-E timestamps are UTC interval starts; the pipeline converts them explicitly to
              Europe/Amsterdam local time through the same slot keying as every other series, and every build
              verifies the conversion hour-by-hour against the unchanged energy-charts price series. Renewable
              shares are computed from the per-type feeds: the renewable set is distribution-connected renewables
              (psrType B16 Solar plus B20 Other renewable), wind onshore, wind offshore, biomass, hydro
              run-of-river and poundage, hydro water reservoir, hydro pumped storage (generation side),
              geothermal and waste, over total generation for the share of generation and over actual load for
              the share of load.
            </p>
            <p className="mt-1">
              Dutch solar and other distribution-connected renewables are reported by the TSO as a single
              upscaled estimate (ENTSO-E psrType B20 Other renewable plus B16 Solar); the site presents that
              aggregate rather than a decomposition, and the renewable share is unaffected because every
              component is renewable. The probe gate recorded an aggregate peak of {PROBE_PEAK_GW} GW on the
              2026-06-15 midday window, about {PROBE_PEAK_SHARE_PCT}% of the {PROBE_DAYLIGHT_FLEET_GW} GW
              daylight-connected fleet (energy-charts installed_power, latest record: solar AC plus onshore
              wind), an annualized aggregate of {PROBE_ANNUAL_TWH} TWh per year, and a midday-to-night mean
              ratio of {PROBE_DIURNAL_RATIO} across the trailing year.
            </p>
            <p className="mt-1">
              Fetch integrity: the platform serves each production type in two TimeSeries copies and its
              documents carry no status or revision marker, so a window can arrive as two conflicting published
              versions. The fetch layer therefore checks every window before accepting it — total generation
              energy must sit between 0.6 and 1.4 times the window's load energy (Dutch generation has been
              roughly 85–105% of load, per CBS), and above a 50 MW materiality floor the duplicate copies'
              means must agree within a factor of 2 — re-fetching the window fresh up to 3 times. These are
              fetch-integrity constants of the data pipeline, not display thresholds. An earlier probe run
              drew a defective platform variant of the same window; that run's figures are not shown here.
            </p>
            <p className="mt-1">
              Historical note: the energy-charts NL solar series was defective (detected November 2026). It
              yielded about 0.48 TWh of solar per year against a 29.28 GW installed fleet (the same source's
              installed_power endpoint), while CBS reports 25.52 billion kWh of Dutch solar production in 2025
              (provisional). Fixed in November 2026 by switching NL generation and load to ENTSO-E per-type
              data. The full probe report and the cross-zone solar audit are recorded in the pull request
              description.
            </p>
          </section>
        )}

        <section>
          <h3 className="font-semibold text-foreground">Basis disclosure (verbatim)</h3>
          <p className="mt-1">
            Computed carbon intensity uses the <strong>generation mix</strong>: domestic production types times the
            emission-factor table, divided by load. <strong>Imports are not attributed</strong> — cross-border flows
            carry no fuel mix, so import-heavy hours show a lower computed intensity than the power actually
            consumed would cause. This limitation applies everywhere intensity is shown (the intensity layer
            label, the green window card captions, the coda).
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">The green window rule (verbatim)</h3>
          <p className="mt-1">{WINDOW_RULE_TEXT}</p>
          <p className="mt-1 text-xs">
            Constants: trailing {WINDOW_PARAMS.TRAILING_DAYS} days, green price ≤ p{WINDOW_PARAMS.GREEN_PRICE_PERCENTILE} / renewables ≥
            p{WINDOW_PARAMS.GREEN_RENEWABLE_PERCENTILE}, red price ≥ p{WINDOW_PARAMS.RED_PRICE_PERCENTILE} / renewables ≤ p
            {WINDOW_PARAMS.RED_RENEWABLE_PERCENTILE}. They live only in src/grid/green-window.ts and change only
            by editing that file; any change is stated in the PR description.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">Risk indicator rules</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {snapshot.risk.indicators.map((i) => (
              <li key={i.key}>
                <strong>{i.label}:</strong> {i.rule}
              </li>
            ))}
          </ul>
          <p className="mt-1">{snapshot.risk.note}.</p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">DST rule (verbatim)</h3>
          <p className="mt-1">
            All grids render in Europe/Amsterdam local time. The two 23-hour and 25-hour days each year render
            their actual hour count — 23 or 25 columns — with the missing spring-forward hour shown as an explicit
            gap cell and the doubled fall-back 02:00 shown as two labelled columns (02:00 +02:00 and 02:00
            +01:00). Nothing is ever silently shifted.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">Units</h3>
          <p className="mt-1">
            Prices EUR/MWh (day-ahead, NL bidding zone). Production, load, residual load MW. Cross-border physical
            flows GW, imports positive / exports negative. Renewable shares percent. Computed intensity g
            CO2-eq/kWh. Volumes TWh. Weather: wind speed 10 m km/h, shortwave radiation W/m², temperature 2 m °C.
            Timestamps are interval starts in Europe/Amsterdam with explicit UTC offset.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">Suppression and gap rendering</h3>
          <p className="mt-1">
            Missing or suppressed source values are stored as null and rendered as grey gap cells with a "no
            data" label — never as zero, never interpolated. The heatmap colour scale spans the 5th–95th
            percentile of the displayed values; the legend prints both ends.
          </p>
        </section>

        <section>
          <h3 className="font-semibold text-foreground">AI disclosure</h3>
          <p className="mt-1">
            The “AI insight (Experimental)” captions are generated at snapshot time by Mistral
            (mistral-small-latest, temperature 0.2) from the same aggregates that power the visual, gated by
            SHA-256 context signatures, validated so every numeral comes from the context (numerals-only
            guidance, prose-ratio lint), capped at two calls per visual and sixteen per run, and hidden when
            generation fails. They render verbatim as static text; no AI call happens in the browser. Key lives
            only in the MISTRAL_API_KEY Actions secret.
          </p>
        </section>
      </div>
    </Drawer>
  );
}
