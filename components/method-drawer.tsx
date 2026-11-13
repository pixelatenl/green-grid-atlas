import { Drawer } from "@/components/drawer";
import { formatDate } from "@/format-date";
import { snapshot } from "@/data/snapshot";
import { WINDOW_RULE_TEXT, WINDOW_PARAMS } from "@/grid/green-window";

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
            <li>
              Emission factors: IPCC AR5 WGIII Annex III Table A.III.2 lifecycle medians, version{" "}
              <code className="rounded bg-muted px-1 text-xs">{snapshot.emissionFactorsVersion}</code> — full
              per-factor table with sources and licenses in docs/emission-factors.md, code copy in
              src/grid/emission-factors.ts.
            </li>
          </ul>
        </section>

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
