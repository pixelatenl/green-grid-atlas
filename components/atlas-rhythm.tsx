/*
  The atlas, rebuilt as rhythm grids: two synchronized pure-SVG grids of
  calendar month (rows) by local hour (columns), server-computed at build
  time in Node from the embedded snapshot via src/data/snapshot.ts. Grid
  one, "What you pay", is the mean NL day-ahead price per (month, hour) in
  EUR/MWh; grid two, "How clean", is the mean renewable share of generation
  per (month, hour) in percent. Below them, the "Weather that shapes it"
  subsection carries three mini-grids on the same month-hour axes.

  The month-hour aggregation runs in src/grid/rhythm-grids.ts at build
  time: each cell is the mean of that local hour across all days of that
  calendar month present in the trailing window, with the 23-hour and
  25-hour DST days handled by the existing wall-hour behavior
  (dayHourSequence). No fetches and no client-side aggregation of raw
  hours: the grids are plain SVG rendered from the precomputed cells; the
  only client island is the shared hover tooltip.

  Layout metrics (cell 26px, gap 2, gutter 66, top 26; weather minis use
  the same columns with 12px cell height) are SANCTIONED DESIGN CONSTANTS
  from the approved prototype, not statistics. Colour anchors live in
  src/grid/layer-scales.ts; domains are the min/max of each grid's own
  cells, computed here at build time.
*/

import { snapshot } from "@/data/snapshot";
import { formatDate } from "@/format-date";
import {
  WEATHER_EXTRACTORS,
  argExtremePerMonth,
  buildRhythmGrid,
  buildWeatherGrids,
  gridDomain,
  hourRangeLabel,
  priceExtractor,
  renExtractor,
  type RhythmGrid,
  type WeatherSeriesId,
} from "@/grid/rhythm-grids";
import {
  PRICE_RAMP,
  REN_RAMP,
  WEATHER_RAMPS,
  rampColor,
  rampGradientCss,
  rampTickValues,
  type RampDef,
} from "@/grid/layer-scales";
import { RhythmTooltip } from "@/components/rhythm-tooltip";

/* Sanctioned design constants: the approved prototype's layout metrics. */
const LAYOUT = {
  cell: 26,
  gap: 2,
  gutter: 66,
  top: 26,
  miniCellH: 12,
  miniTop: 20,
} as const;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/* ---- build-time computation (Node, from the embedded snapshot) ---- */

const win = { from: snapshot.trailing.from, to: snapshot.trailing.to };
const days = snapshot.trailing.days;

const priceGrid = buildRhythmGrid(days, win, priceExtractor);
const renGrid = buildRhythmGrid(days, win, renExtractor);
const weather = buildWeatherGrids(days, win);

const priceDomain = gridDomain(priceGrid);
const renDomain = gridDomain(renGrid);
const weatherDomains: Record<WeatherSeriesId, { lo: number; hi: number } | null> = {
  wind: gridDomain(weather.grids.wind),
  solar: gridDomain(weather.grids.solar),
  temp: gridDomain(weather.grids.temp),
};

/* Annotations: argmax over the built grids, never written by hand. */
const pricePeakHours = argExtremePerMonth(priceGrid, "max");
const renPeakHours = argExtremePerMonth(renGrid, "max");

const totalMonths = priceGrid.months.length;
const eveningPeakMonths = pricePeakHours.filter((h) => h != null && h >= 17 && h <= 20).length;
const nightCleanMonths = renPeakHours.filter((h) => h != null && h >= 0 && h <= 5).length;

const partialLabels = priceGrid.months.filter((m) => m.partial).map((m) => `${m.label}*`);
const fromLabel = win.from ? formatDate(win.from) : null;
const toLabel = win.to ? formatDate(win.to) : null;

const weatherAvailable = snapshot.weather.available;

/* ---- one pure-SVG rhythm grid figure ---- */

function RhythmFigure({
  title,
  subtitle,
  tipTitle,
  grid,
  ramp,
  domain,
  annotations,
  cellH,
  top,
  weatherQualifier,
  source,
  aria,
}: {
  title: string;
  subtitle: string;
  /** Line shown in the hover tooltip above the value. */
  tipTitle: string;
  grid: RhythmGrid;
  ramp: RampDef;
  domain: { lo: number; hi: number } | null;
  /** Per-month annotated hour (argmax), aligned with grid.months. */
  annotations: (number | null)[] | null;
  cellH: number;
  top: number;
  /** Weather mini-grids qualify the mean over weather days only. */
  weatherQualifier?: boolean;
  source: string;
  aria: string;
}) {
  const { cell, gap, gutter } = LAYOUT;
  const w = gutter + 24 * (cell + gap) - gap;
  const h = top + grid.months.length * cellH + (grid.months.length - 1) * gap;
  const ticks = domain ? rampTickValues(ramp, domain.lo, domain.hi) : [];
  const font = cellH <= LAYOUT.miniCellH ? 8 : 9;

  return (
    <figure className="mt-5 first:mt-0">
      <figcaption className="gg-caption font-semibold">
        {title}{" "}
        <span className="ml-1 gg-caption font-medium">{subtitle}</span>
      </figcaption>
      <div className="mt-1 overflow-x-auto">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="block h-auto min-w-[640px] w-full"
          role="img"
          aria-label={aria}
        >
          {/* hour axis, labels every 3 hours */}
          {HOURS.filter((hh) => hh % 3 === 0).map((hh) => (
            <text
              key={hh}
              x={gutter + hh * (cell + gap) + cell / 2}
              y={top - (cellH <= LAYOUT.miniCellH ? 6 : 8)}
              textAnchor="middle"
              fontSize={font}
              className="fill-muted-foreground"
            >
              {String(hh).padStart(2, "0")}
            </text>
          ))}
          {grid.months.map((m, mi) => (
            <g key={m.key}>
              <text
                x={gutter - 8}
                y={top + mi * (cellH + gap) + cellH / 2 + 3}
                textAnchor="end"
                fontSize={font}
                className="fill-muted-foreground"
              >
                {m.label}
                {m.partial ? "*" : ""}
              </text>
              {HOURS.map((hh) => {
                const c = grid.cells[mi][hh];
                const fill =
                  c.value == null || !domain
                    ? "var(--muted)"
                    : rampColor(ramp, c.value, domain.lo, domain.hi) ?? "var(--muted)";
                const annotated = annotations != null && annotations[mi] === hh;
                const qualifier = weatherQualifier
                  ? `mean over ${m.weatherDays} weather days of ${m.fullLabel}`
                  : `mean over ${m.days} days of ${m.fullLabel}`;
                return (
                  <rect
                    key={hh}
                    data-tip-visual
                    data-tip-heading={`${m.label}${m.partial ? "*" : ""} · ${hourRangeLabel(hh)}`}
                    data-tip-title={tipTitle}
                    data-tip-value={c.value == null ? "no data" : ramp.format(c.value)}
                    data-tip-qualifier={qualifier}
                    x={gutter + hh * (cell + gap)}
                    y={top + mi * (cellH + gap)}
                    width={cell}
                    height={cellH}
                    rx={2}
                    fill={fill}
                    className={annotated ? "rhythm-cell rhythm-annotation" : "rhythm-cell"}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      {/* legend: gradient from the anchors, ticks computed from the domain */}
      <div aria-hidden="true" className="mt-1 h-2 w-full rounded-full" style={{ background: rampGradientCss(ramp) }} />
      <div
        aria-hidden="true"
        className="relative mt-0.5 h-3 w-full gg-label tabular-nums text-muted-foreground"
      >
        {ramp.anchors.map((a, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: `${a.position * 100}%`,
              transform:
                i === 0 ? "none" : i === ramp.anchors.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {domain ? ramp.legendFormat(ticks[i]) : ""}
          </span>
        ))}
      </div>
      {source && <p className="mt-1 gg-caption">{source}</p>}
    </figure>
  );
}

/* ---- the card ---- */

export function AtlasRhythm() {
  const first = priceGrid.months[0];
  const last = priceGrid.months[priceGrid.months.length - 1];
  const monthSpan = first && last ? `${first.label} to ${last.label}` : "the trailing window";

  const priceAria = `Month-by-hour rhythm grid of the mean NL day-ahead price in EUR/MWh: rows are calendar months ${monthSpan}, columns are local hours 00 to 23. The outlined cell in each month marks its most expensive mean hour.`;
  const renAria = `Month-by-hour rhythm grid of the mean renewable share of NL generation in percent: rows are calendar months ${monthSpan}, columns are local hours 00 to 23. The outlined cell in each month marks its cleanest mean hour.`;

  return (
    <div>
      {/* derived sentences, computed from the built grids */}
      <div className="flex flex-col gap-1 text-sm">
        <p>
          In <span className="font-semibold tabular-nums">{eveningPeakMonths}</span> of{" "}
          <span className="font-semibold tabular-nums">{totalMonths}</span> months, the most expensive
          mean hour falls between 17:00 and 20:00.
        </p>
        <p>
          In <span className="font-semibold tabular-nums">{nightCleanMonths}</span> of{" "}
          <span className="font-semibold tabular-nums">{totalMonths}</span> months, the cleanest mean
          hour falls between 00:00 and 05:00.
        </p>
      </div>
      <p className="mt-2 gg-caption">Hover any cell for its exact value.</p>

      <RhythmTooltip>
        <div className="mt-2">
          <RhythmFigure
            title="What you pay"
            subtitle="mean day-ahead price per calendar month and local hour, EUR/MWh; outlined cell = the month's most expensive mean hour"
            tipTitle="What you pay, mean day-ahead price"
            grid={priceGrid}
            ramp={PRICE_RAMP}
            domain={priceDomain}
            annotations={pricePeakHours}
            cellH={LAYOUT.cell}
            top={LAYOUT.top}
            source="Source: NL day-ahead price (SMARD.de) via energy-charts.info, CC BY 4.0. Square-root colour scale over the grid's own min to max, computed at build time."
            aria={priceAria}
          />
          <RhythmFigure
            title="How clean"
            subtitle="mean renewable share of generation per calendar month and local hour, %; outlined cell = the month's cleanest mean hour"
            tipTitle="How clean, mean renewable share of generation"
            grid={renGrid}
            ramp={REN_RAMP}
            domain={renDomain}
            annotations={renPeakHours}
            cellH={LAYOUT.cell}
            top={LAYOUT.top}
            source="Source: renewable share of NL generation, ENTSO-E Transparency Platform A75/A65 generation basis. Linear colour scale over the grid's own min to max, computed at build time."
            aria={renAria}
          />
        </div>

        {/* weather small multiples on the same month-hour axes */}
        <section className="mt-8">
          <h3 className="text-lg font-extrabold tracking-tight">Weather that shapes it</h3>
          <p className="mt-1 gg-caption">
            {weatherAvailable
              ? `weather: ${weather.daysWithWeather} of ${weather.totalDays} days, Open-Meteo archive.`
              : "Weather data is unavailable in this snapshot, so no weather grids are shown."}
          </p>
          {weatherAvailable && (
            <div className="mt-2">
              {(Object.keys(WEATHER_EXTRACTORS) as WeatherSeriesId[]).map((id) => (
                <RhythmFigure
                  key={id}
                  title={`${WEATHER_RAMPS[id].label} (${WEATHER_RAMPS[id].unit})`}
                  subtitle="mean per calendar month and local hour"
                  tipTitle={`${WEATHER_RAMPS[id].label}, mean`}
                  grid={weather.grids[id]}
                  ramp={WEATHER_RAMPS[id]}
                  domain={weatherDomains[id]}
                  annotations={null}
                  cellH={LAYOUT.miniCellH}
                  top={LAYOUT.miniTop}
                  weatherQualifier
                  source=""
                  aria={`Month-by-hour rhythm grid of the mean ${WEATHER_RAMPS[id].label.toLowerCase()} in ${WEATHER_RAMPS[id].unit}: rows are calendar months ${monthSpan}, columns are local hours 00 to 23, over the trailing window. Source: Open-Meteo.`}
                />
              ))}
            </div>
          )}
          <p className="mt-2 gg-caption">
            Source: Open-Meteo historical weather archive (CC BY 4.0), central NL. Wind is shown in m/s,
            converted from the archive's km/h. Each mini-grid's mean per cell is taken only over days
            that carry weather values.
          </p>
        </section>
      </RhythmTooltip>

      {/* partial edge months footnote, cutoff dates computed from the window */}
      {partialLabels.length > 0 && fromLabel && toLabel && (
        <p className="mt-4 gg-caption">
          * {partialLabels.join(" and ")} {partialLabels.length === 1 ? "is" : "are"} partial: the
          trailing window starts {fromLabel} and ends {toLabel}.
        </p>
      )}
    </div>
  );
}
