import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { ChartTooltip } from "@/components/chart-tooltip";
import { YAxis, axisY, niceAxis } from "@/components/chart-axis";
import { WINDOW_PARAMS } from "@/grid/green-window";

/*
  The four chapters: the gas day, the daylight renewables valley, the
  evening peak, the wind workhorse. Each is a derived headline sentence
  (every figure computed at render time from the snapshot's
  trailing-30-day average day profiles) plus its evidence visual: a
  24-hour profile chart, pure SVG, with a computed left y-axis for the
  bars, a normalized overlay line on its own scale, and bars that are
  keyboard-focusable with per-bar labels. The shared ChartTooltip shows
  the exact values; no native <title> remains on any migrated figure.

  The framing prose stays time-neutral on purpose: every specific hour,
  count and magnitude is owned by the computed sentences, so prose and
  data can never contradict.
*/

const profiles = snapshot.derived.profiles30d;

/* Sanctioned chart geometry: canvas, paddings and gutters. The axis
   domain and ticks are NOT constants; they are computed per series. */
const W = 720;
const H = 160;
const PAD = 8; // right and bottom padding
const AXIS_W = 36; // left gutter for the y-axis tick labels
const UNIT_H = 12; // top strip for the unit label
const LABEL_H = 14; // bottom strip for the hour labels

const plotLeft = AXIS_W;
const plotRight = W - PAD;
const plotTop = PAD + UNIT_H;
const plotBottom = H - PAD - LABEL_H;
const plotW = plotRight - plotLeft;
const plotH = plotBottom - plotTop;
const bw = plotW / 24;

/* Window chip text, shown beside each chapter section title: the chip
   states the chart's time basis at title level; the day count is
   interpolated from WINDOW_PARAMS, never hardcoded. */
const chipText = `Avg day, last ${WINDOW_PARAMS.TRAILING_DAYS} days`;

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const hourLabels = HOURS.map(hh);

/** Round a series for the compact client payload (integers or 1 decimal). */
const roundFor = (v: number | null, decimals: number) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals);

function argExtreme(key: string, mode: "max" | "min"): { hour: number; value: number | null } {
  const arr = profiles[key] ?? [];
  let best = mode === "max" ? -Infinity : Infinity;
  let bh = 0;
  let found = false;
  arr.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v) && (mode === "max" ? v > best : v < best)) {
      best = v;
      bh = i;
      found = true;
    }
  });
  return { hour: bh, value: found ? best : null };
}

const at = (key: string, hour: number) => profiles[key]?.[hour] ?? null;

/** Pure-SVG 24-hour profile: bars for `series` on a computed y-axis,
    line overlay for `overlay` on its own normalized scale (exactly as
    before), hit strips per hour for cursor snapping and touch. */
function DayProfile({
  series,
  seriesLabel,
  seriesUnit,
  overlay,
  overlayLabel,
  overlayUnit,
  overlayDecimals = 1,
  barClass,
}: {
  series: (number | null)[];
  seriesLabel: string;
  seriesUnit: string;
  overlay?: (number | null)[];
  overlayLabel?: string;
  overlayUnit?: string;
  overlayDecimals?: number;
  barClass: string;
}) {
  const vals = series.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const peak = vals.length ? Math.max(...vals) : null;
  // The y-axis domain: zero at the baseline, top = the series maximum
  // rounded up to a nice 1/2/5 step; every tick is computed from the data.
  const axis = niceAxis(0, peak ?? 0);
  const yOf = axisY(axis, plotTop, plotBottom);
  const ovals = (overlay ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const opeak = ovals.length ? Math.max(...ovals) : null;
  // Guard the divisor: an all-zero overlay would make v/omax NaN.
  const omax = opeak != null && opeak > 0 ? opeak : 1;
  // Overlay path points and peak hour, computed once for the line, the
  // halo underneath it and the peak dot.
  const overlayPts = (overlay ?? [])
    .map((v, h) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      const x = plotLeft + h * bw + bw / 2;
      const y = plotBottom - (v / omax) * plotH;
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");
  let peakHour = -1;
  let peakVal = -Infinity;
  (overlay ?? []).forEach((v, h) => {
    if (typeof v === "number" && Number.isFinite(v) && v > peakVal) {
      peakVal = v;
      peakHour = h;
    }
  });
  const peakX = plotLeft + peakHour * bw + bw / 2;
  const peakY = plotBottom - (peakVal / omax) * plotH;
  const summary = `${seriesLabel} by hour of an average day over the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days. Peak ${
    peak != null ? `${formatNumber(peak, 0)} ${seriesUnit}` : "no data"
  }${overlay && overlayLabel && opeak != null ? `; ${overlayLabel} peaks at ${formatNumber(opeak, 1)} ${overlayUnit}` : ""}.`;
  const qualifier = `Average day over the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days; the ${overlayLabel ?? "overlay"} line is scaled to its own maximum`;
  return (
    <>
      <ChartTooltip
        labels={hourLabels}
        series={[
          { name: seriesLabel, unit: seriesUnit, decimals: 0, values: series.map((v) => roundFor(v, 0)) },
          ...(overlay && overlayLabel && overlayUnit
            ? [{ name: overlayLabel, unit: overlayUnit, decimals: overlayDecimals, values: overlay.map((v) => roundFor(v, overlayDecimals)) }]
            : []),
        ]}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-4 w-full"
          role="img"
          aria-label={summary}
          data-tip-root
          data-units={W}
          data-x0={plotLeft}
          data-x1={plotRight}
          data-tip-series={overlay ? "0,1" : "0"}
          data-tip-qualifier={qualifier}
        >
          {/* skipTop drops the chart's top border (the topmost gridline);
              the chapter charts read cleaner without it, and the topmost
              tick label still renders. Every other YAxis consumer keeps
              the default and renders byte-identical output. */}
          <YAxis axis={axis} plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} unit={seriesUnit} skipTop />
          {series.map((v, h) => {
            const valid = typeof v === "number" && Number.isFinite(v);
            const height = valid ? (v / axis.hi) * plotH : 0;
            return (
              <rect
                key={h}
                tabIndex={0}
                className={`chart-tooltip-trigger ${barClass}`}
                data-tip={h}
                data-tip-visual
                data-cx={plotLeft + h * bw + bw / 2}
                x={plotLeft + h * bw + 1}
                y={plotBottom - height}
                width={Math.max(1, bw - 2)}
                height={Math.max(0, height)}
                aria-label={`${hh(h)}, ${seriesLabel} ${valid ? `${formatNumber(v, 0)} ${seriesUnit}` : "no data"}`}
              />
            );
          })}
          {overlay && (
            <>
              {/* Halo first: the same path painted in the card surface color
                  before the line draws, so the overlay separates from every
                  bar fill it crosses in both themes. strokeWidth 5 and the
                  dot radii are sanctioned geometry constants; the halo is
                  static geometry (pointer-events none, aria-hidden), so it
                  cannot affect layout or interaction. */}
              <polyline
                fill="none"
                stroke="var(--card)"
                strokeWidth={5}
                strokeLinecap="round"
                points={overlayPts}
                aria-hidden="true"
                pointerEvents="none"
              />
              {peakHour >= 0 && (
                <circle cx={peakX} cy={peakY} r={5} fill="var(--card)" aria-hidden="true" pointerEvents="none" />
              )}
              <polyline
                fill="none"
                stroke="var(--gg-chart-overlay)"
                strokeWidth="2"
                points={overlayPts}
                aria-label={overlayLabel ?? ""}
              />
              {peakHour >= 0 && (
                <circle cx={peakX} cy={peakY} r={2.5} fill="var(--gg-chart-overlay)" aria-hidden="true" pointerEvents="none" />
              )}
            </>
          )}
          {/* wide invisible hit strips, one per hour, full chart height:
              cursor snapping and touch taps land on these */}
          {HOURS.map((h) => (
            <rect
              key={`hit-${h}`}
              className="chart-hit"
              data-tip={h}
              data-cx={plotLeft + h * bw + bw / 2}
              x={plotLeft + h * bw}
              y={0}
              width={bw}
              height={H}
            />
          ))}
          {[0, 6, 12, 18, 23].map((h) => (
            <text
              key={h}
              x={plotLeft + h * bw + bw / 2}
              y={H - 2}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="9"
            >
              {hh(h)}
            </text>
          ))}
        </svg>
      </ChartTooltip>
      {/* Static legend row under the chart, replacing the peak-dot
          micro-label: the pinned label was hard to read at 9px and could
          run outside the plot, while a static row cannot overflow and
          reads at the standard label size. No hover behavior, no state,
          no layout change. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 gg-label text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          {/* The theme mapping in app/globals.css generates the color
              utilities in pairs, so fill-gg-bar-wind and bg-gg-bar-wind
              resolve to one token. The other bar series pair the same
              way: fill-gg-bar-gas with bg-gg-bar-gas for gas and
              fill-gg-bar-renewables with bg-gg-bar-renewables for
              renewables and fill-gg-bar-load with bg-gg-bar-load for
              load. */}
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-3 rounded-[2px] ${barClass.replace(/^fill-/, "bg-")}`}
          />
          {seriesLabel} ({seriesUnit})
        </span>
        {overlay && overlayLabel && overlayUnit && (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-[2px] w-4"
              style={{ background: "var(--gg-chart-overlay)" }}
            />
            {overlayLabel} ({overlayUnit}, own scale)
          </span>
        )}
      </div>
    </>
  );
}

function Chapter({
  id,
  title,
  description,
  headline,
  children,
}: {
  id: string;
  title: React.ReactNode;
  description: string;
  headline: React.ReactNode;
  children: React.ReactNode;
}) {
  const narration = narrationFor(id);
  return (
    /* Chapter titles are derived phrases (the valley title is the
       longest), so every one uses the documented gg-heading-wide
       override: the heading spans the full card content width like
       the green window and red hours titles, instead of wrapping at
       the .gg-heading 18ch scale cap. */
    <FamilySection
      title={
        <>
          {title}
          {/* Window chip at title level, on the same line as the section
              title ("The gas day" and its three siblings): a pill in the
              family chip pattern (gg-label, border token, card surface)
              that states the chart's time basis visibly. The day count is
              interpolated from WINDOW_PARAMS, never hardcoded. aria-hidden:
              the svg summary and the tooltip qualifier already state the
              window, so the chip never double-announces. */}
          <span
            aria-hidden="true"
            className="gg-label ml-3 inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 align-middle text-muted-foreground"
          >
            {chipText}
          </span>
        </>
      }
      description={description}
      headingClassName="gg-heading-wide"
    >
      {/* Divider between the section description (card header) and the
         derived headline (card body): a 1px rule in the border token,
         spanning the content width. Static geometry only; the card's
         own gap-6 sits above it, mb-4 below it. Chapters only: the
         window cards keep their current header-to-body rhythm. */}
      <hr className="mb-4 border-t border-border" />
      <p className="gg-headline">{headline}</p>
      {children}
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}

export function Chapters() {
  const gasPeak = argExtreme("fossil_gas", "max");
  const gasMin = argExtreme("fossil_gas", "min");
  const daylightRenewablesPeak = argExtreme("distribution_renewables", "max");
  const priceMin = argExtreme("price", "min");
  const priceMax = argExtreme("price", "max");
  const loadPeak = argExtreme("load", "max");
  const windPeak = argExtreme("wind", "max");
  const renPeak = argExtreme("ren", "max");
  const intMin = argExtreme("intensity", "min");
  const importCover = snapshot.risk.indicators.find((i) => i.key === "importCoverShare")?.value ?? null;

  return (
    <>
      <Chapter
        id="morningGasRamp"
        title="The gas day"
        description="What the average day does to gas-fired plants and prices: gas fills the gap between demand and clean supply, dips when clean supply is high, and rises again when demand picks up."
        headline={
          <>
            Between {hh(gasMin.hour)} and {hh(gasPeak.hour)}, average gas-fired output climbs from{" "}
            {formatNumber(gasMin.value, 0)} MW to <span className="tabular-nums">{formatNumber(gasPeak.value, 0)} MW</span>,
            while the average price moves from {formatNumber(at("price", gasMin.hour), 1)} to{" "}
            {formatNumber(at("price", gasPeak.hour), 1)} EUR/MWh.
          </>
        }
      >
        <DayProfile
          series={profiles.fossil_gas ?? []}
          seriesLabel="Gas-fired production"
          seriesUnit="MW"
          overlay={profiles.price ?? []}
          overlayLabel="Day-ahead price"
          overlayUnit="EUR/MWh"
          overlayDecimals={1}
          barClass="fill-gg-bar-gas"
        />
      </Chapter>

      <Chapter
        id="solarValley"
        title="The daylight renewables valley"
        description="Distribution-connected renewables flood the grid in the sunny hours and prices sag with them."
        headline={
          <>
            Daylight renewables peak at <span className="tabular-nums">{formatNumber(daylightRenewablesPeak.value, 0)} MW</span> around{" "}
            {hh(daylightRenewablesPeak.hour)}, and the average day-ahead price bottoms at{" "}
            <span className="tabular-nums">{formatNumber(priceMin.value, 1)} EUR/MWh</span> at {hh(priceMin.hour)},
            the heart of the green window.
          </>
        }
      >
        <DayProfile
          series={profiles.distribution_renewables ?? []}
          seriesLabel="Distribution-connected renewables"
          seriesUnit="MW"
          overlay={profiles.price ?? []}
          overlayLabel="Day-ahead price"
          overlayUnit="EUR/MWh"
          overlayDecimals={1}
          barClass="fill-gg-bar-renewables"
        />
      </Chapter>

      <Chapter
        id="eveningPeak"
        title="The evening peak"
        description="At the daily demand peak, prices follow and imports fill the gap."
        headline={
          <>
            Load peaks at <span className="tabular-nums">{formatNumber(loadPeak.value, 0)} MW</span> at{" "}
            {hh(loadPeak.hour)} with prices at <span className="tabular-nums">{formatNumber(priceMax.value, 1)} EUR/MWh</span>{" "}
            at {hh(priceMax.hour)}, and over the trailing {WINDOW_PARAMS.TRAILING_DAYS} days net imports covered{" "}
            <span className="tabular-nums">{formatNumber((importCover ?? 0) * 100, 1)}%</span> of Dutch load.
          </>
        }
      >
        <DayProfile
          series={profiles.load ?? []}
          seriesLabel="Load"
          seriesUnit="MW"
          overlay={profiles.price ?? []}
          overlayLabel="Day-ahead price"
          overlayUnit="EUR/MWh"
          overlayDecimals={1}
          barClass="fill-gg-bar-load"
        />
      </Chapter>

      <Chapter
        id="windNight"
        title="The wind workhorse"
        description="Wind is the workhorse of the Dutch grid whenever it blows: high renewable share, low computed intensity, low prices."
        headline={
          <>
            Wind reaches <span className="tabular-nums">{formatNumber(windPeak.value, 0)} MW</span> at {hh(windPeak.hour)},
            renewable share of generation peaks at <span className="tabular-nums">{formatNumber(renPeak.value, 1)}%</span>{" "}
            at {hh(renPeak.hour)}, and computed intensity bottoms at{" "}
            <span className="tabular-nums">{formatNumber(intMin.value, 0)} g CO2-eq/kWh</span> (generation-mix basis).
          </>
        }
      >
        <DayProfile
          series={profiles.wind ?? []}
          seriesLabel="Wind production (onshore + offshore)"
          seriesUnit="MW"
          overlay={profiles.intensity ?? []}
          overlayLabel="Computed carbon intensity"
          overlayUnit="g CO2-eq/kWh"
          overlayDecimals={0}
          barClass="fill-gg-bar-wind"
        />
      </Chapter>
    </>
  );
}
