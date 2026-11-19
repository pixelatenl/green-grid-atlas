import { snapshot, formatNumber, formatSigned } from "@/data/snapshot";
import { formatDate } from "@/format-date";
import { FamilySection } from "@/components/family-section";
import { ChartTooltip } from "@/components/chart-tooltip";
import { YAxis, axisY, niceAxis } from "@/components/chart-axis";

/*
  Where power flows: a per-neighbor physical flow timeline (cbpf, GW, daily
  means over the trailing 12 months) plus per-neighbor import and export
  volumes in TWh per year. Sign convention disclosed on the card: imports
  positive, exports negative (energy-charts cbpf attributes).

  Every chart gets a computed left y-axis (nice 1/2/5 steps from the
  series, zero at the baseline, unit stated once per axis) and migrates
  onto the shared ChartTooltip island: wide invisible hit strips snap
  the cursor/tap to the nearest day or year, the native <title> elements
  are gone (the custom tooltip plus a browser default would read as two
  tooltips), and the aria-labels stay as the screen-reader channel.
*/

const NEIGHBOR_LABELS: Record<string, string> = {
  belgium: "Belgium",
  denmark: "Denmark",
  germany: "Germany",
  norway: "Norway",
  united_kingdom: "United Kingdom",
  sum: "All neighbors (net)",
};

/* Sanctioned chart geometry: canvas, paddings and gutters. Axis domains
   and ticks are computed per series, never constants. */
const W = 720;
const AXIS_W = 36; // left gutter for the y-axis tick labels
const UNIT_H = 12; // top strip for the unit label

/** Daily means of a flow series over the trailing days. */
function dailyMeans(series: (number | null)[][], dates: string[]): { date: string; value: number | null }[] {
  return dates.map((date, i) => {
    const vals = series[i]?.filter((v): v is number => v != null && Number.isFinite(v)) ?? [];
    return {
      date,
      value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    };
  });
}

/** Round for the compact client payload: one decimal, null stays null. */
const round1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

/* ---- build-time computation (Node, from the embedded snapshot) ---- */

const neighbors = Object.keys(NEIGHBOR_LABELS).filter((n) => n !== "sum");
const volumeCharts = [...neighbors, "sum"];

const days = snapshot.trailing.days;
const dateLabels = days.map((d) => formatDate(d.date));
const timelinePoints: Record<string, { date: string; value: number | null }[]> = {};
for (const n of neighbors) {
  timelinePoints[n] = dailyMeans(
    days.map((d) => d.flows[n] ?? []),
    days.map((d) => d.date),
  );
}
const timelineSeries = neighbors.map((n) => ({
  name: `${NEIGHBOR_LABELS[n]} daily mean flow`,
  unit: "GW",
  decimals: 1,
  values: timelinePoints[n].map((p) => round1(p.value)),
}));

const years = snapshot.flowVolumes.years;
const yearLabels = years.map((y) => String(y.year));
const volumeSeries = volumeCharts.flatMap((n) => {
  const label = NEIGHBOR_LABELS[n] ?? n;
  return [
    { name: `${label} import`, unit: "TWh", decimals: 1, values: years.map((y) => round1(y.neighbors[n]?.importTWh ?? null)) },
    { name: `${label} export`, unit: "TWh", decimals: 1, values: years.map((y) => round1(y.neighbors[n]?.exportTWh ?? null)) },
    { name: `${label} net`, unit: "TWh", decimals: 1, values: years.map((y) => round1(y.neighbors[n]?.netTWh ?? null)) },
  ];
});

function FlowTimeline({ neighbor, seriesIndex }: { neighbor: string; seriesIndex: number }) {
  const points = timelinePoints[neighbor];
  const vals = points.map((p) => p.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const max = vals.length ? Math.max(...vals) : 1;
  const min = vals.length ? Math.min(...vals) : -1;
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const H = 90;
  const PAD = 6;
  const plotLeft = AXIS_W;
  const plotRight = W - PAD;
  const plotTop = PAD + UNIT_H;
  const plotBottom = H - PAD;
  // Computed axis: zero at the baseline, nice 1/2/5 steps from the data.
  const axis = niceAxis(min, max);
  const y = axisY(axis, plotTop, plotBottom);
  const zeroY = y(0);
  const step = (plotRight - plotLeft) / Math.max(1, points.length - 1);
  const stripW = Math.max(step, 12); // wide touch targets, at least one per day
  const path = points
    .map((p, i) => {
      if (p.value == null) return null;
      const x = plotLeft + i * step;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y(p.value).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const label = NEIGHBOR_LABELS[neighbor] ?? neighbor;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`${label}: daily mean physical flow over the trailing 12 months, GW, imports positive exports negative. Range ${formatNumber(min, 1)} to ${formatNumber(max, 1)} GW, mean ${formatNumber(mean, 1)} GW.`}
      data-tip-root
      data-units={W}
      data-x0={plotLeft}
      data-x1={plotRight}
      data-tip-series={String(seriesIndex)}
      data-tip-qualifier="imports positive, exports negative"
    >
      <YAxis axis={axis} plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} unit="GW" skipZero />
      <line x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeDasharray="3 3" />
      <path
        d={path}
        fill="none"
        stroke="var(--gg-flow-import)"
        strokeWidth="1.5"
        tabIndex={0}
        aria-label={`${label} flow timeline, trailing 12 months, daily means in GW`}
        data-tip-heading={`${label}: daily mean flow, trailing 12 months`}
        data-tip-title="GW, imports positive, exports negative"
        data-tip-value={`range ${formatNumber(min, 1)} to ${formatNumber(max, 1)} GW`}
        data-tip-qualifier={`mean ${formatNumber(mean, 1)} GW`}
      />
      {/* wide invisible hit strips, one per day, full chart height */}
      {points.map((p, i) => (
        <rect
          key={p.date}
          className="chart-hit"
          data-tip={i}
          data-cx={plotLeft + i * step}
          x={plotLeft + i * step - stripW / 2}
          y={0}
          width={stripW}
          height={H}
        />
      ))}
      <text x={plotLeft} y={12} className="fill-muted-foreground" fontSize="9">
        {label}: daily mean ({formatNumber(min, 0)} … {formatNumber(max, 0)})
      </text>
    </svg>
  );
}

function VolumeBars({ neighbor, seriesBase }: { neighbor: string; seriesBase: number }) {
  const label = NEIGHBOR_LABELS[neighbor] ?? neighbor;
  const nets = years.map((y) => y.neighbors[neighbor]?.netTWh ?? null);
  const vals = nets.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const H = 110;
  const PAD = 8;
  const LABEL_H = 14; // bottom strip for the year labels
  const plotLeft = AXIS_W;
  const plotRight = W - PAD;
  const plotTop = PAD + UNIT_H;
  const plotBottom = H - PAD - LABEL_H;
  // Computed signed axis over the net values, zero at the baseline.
  const min = vals.length ? Math.min(...vals, 0) : 0;
  const max = vals.length ? Math.max(...vals, 0) : 0;
  const axis = niceAxis(min, max);
  const y = axisY(axis, plotTop, plotBottom);
  const zeroY = y(0);
  const bw = (plotRight - plotLeft) / years.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`${label}: net physical flow per year in TWh, imports positive, exports negative.`}
      data-tip-root
      data-units={W}
      data-x0={plotLeft}
      data-x1={plotRight}
      data-tip-series={`${seriesBase},${seriesBase + 1},${seriesBase + 2}`}
      data-tip-qualifier="imports positive, exports negative"
    >
      <YAxis axis={axis} plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} unit="TWh" skipZero />
      <line x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} stroke="var(--border)" />
      {years.map((yr, i) => {
        const v = yr.neighbors[neighbor]?.netTWh ?? null;
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
        const h = axis.hi > 0 ? (Math.abs(v) / (v >= 0 ? axis.hi : Math.abs(axis.lo))) * (v >= 0 ? zeroY - plotTop : plotBottom - zeroY) : 0;
        const x = plotLeft + i * bw + 2;
        return (
          <rect
            key={yr.year}
            tabIndex={0}
            className="chart-tooltip-trigger"
            data-tip={i}
            data-tip-visual
            data-cx={plotLeft + i * bw + bw / 2}
            x={x}
            y={v >= 0 ? zeroY - h : zeroY}
            width={Math.max(2, bw - 4)}
            height={Math.max(1, h)}
            fill={v >= 0 ? "var(--gg-flow-import)" : "var(--gg-flow-export)"}
            aria-label={`${label} ${yr.year}: net ${formatSigned(v, 1)} TWh (imports positive, exports negative)`}
          />
        );
      })}
      {/* wide invisible hit strips, one per year, full chart height */}
      {years.map((yr, i) => (
        <rect
          key={`hit-${yr.year}`}
          className="chart-hit"
          data-tip={i}
          data-cx={plotLeft + i * bw + bw / 2}
          x={plotLeft + i * bw}
          y={0}
          width={bw}
          height={H}
        />
      ))}
      {years.map((yr, i) => (
        <text
          key={yr.year}
          x={plotLeft + i * bw + bw / 2}
          y={H - 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="9"
        >
          {String(yr.year).slice(2)}
        </text>
      ))}
    </svg>
  );
}

export function Flows() {
  const lastYear = years[years.length - 1];
  const total = lastYear?.neighbors.sum;

  return (
    <FamilySection
      title="Where power flows"
      description="Cross-border physical flows (cbpf) between the Netherlands and its neighbors, in GW. Imports are positive, exports negative; that sign convention is the source's and is disclosed here."
    >
      <ChartTooltip labels={dateLabels} series={timelineSeries}>
        <div className="grid gap-4 sm:grid-cols-2">
          {neighbors.map((n, k) => (
            <div key={n} className="rounded-lg border border-border p-2">
              <FlowTimeline neighbor={n} seriesIndex={k} />
            </div>
          ))}
        </div>
      </ChartTooltip>
      <p className="mt-4 text-sm text-muted-foreground">
        Daily mean physical flows, trailing 12 months ({snapshot.trailing.from} – {snapshot.trailing.to}).
      </p>

      <h3 className="mt-6 text-lg font-bold tracking-tight">Net flow per neighbor, TWh per year</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Imports positive (teal), exports negative (orange).{" "}
        {lastYear && total ? (
          <>
            In {lastYear.year} the national net balance was{" "}
            <span className="tabular-nums">{formatSigned(total.netTWh, 1)} TWh</span> (import{" "}
            {formatNumber(total.importTWh, 1)} TWh, export {formatNumber(total.exportTWh, 1)} TWh across all
            neighbors).
          </>
        ) : (
          "National net balance per year below."
        )}
      </p>
      <ChartTooltip labels={yearLabels} series={volumeSeries}>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {volumeCharts.map((n, k) => (
            <div key={n} className="rounded-lg border border-border p-2">
              <VolumeBars neighbor={n} seriesBase={k * 3} />
            </div>
          ))}
        </div>
      </ChartTooltip>
    </FamilySection>
  );
}
