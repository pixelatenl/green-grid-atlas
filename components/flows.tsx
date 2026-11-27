import { Fragment } from "react";
import { snapshot, formatNumber, formatSigned } from "@/data/snapshot";
import { FamilySection } from "@/components/family-section";
import { ChartTooltip } from "@/components/chart-tooltip";
import { YAxis, axisY, niceAxis } from "@/components/chart-axis";

/*
  Where power flows: one aggregate panel of trailing-twelve-month import
  and export energy per neighbor (cbpf). Each hourly flow series is
  summed per sign, positive hours as the import side and negative hours
  as the export side, divided by 1000 for TWh; nulls and non-finite
  hours are skipped. Imports draw up in teal and exports down in orange
  from one shared zero axis, the country names sit under the bar pairs
  and the exact figures print at the bars. The sign convention disclosed
  on the card is the source's: imports positive, exports negative
  (energy-charts cbpf attributes).

  The calendar-year import, export and net history per neighbor lives on
  in the shared ChartTooltip island: each neighbor group is its own
  data-tip-root scope carrying that neighbor's series triple and
  full-height hit strips, one per tooltip label (the flowVolumes years
  plus the trailing window entry), so hover and tap step through the
  history inside the group. The bar pair stays focusable as
  chart-tooltip-trigger at the trailing entry, wide invisible hit strips
  snap the cursor/tap to the nearest label, the native <title> elements
  are gone (the custom tooltip plus a browser default would read as two
  tooltips), and the aria-labels stay as the screen-reader channel.

  The panel gets a computed left y-axis (nice 1/2/5 steps over the
  signed range of all ten bars, zero at the baseline, the unit stated
  once per axis) and computed geometry: five equal neighbor groups
  across the plot, each bar pair centered in its group.
*/

const NEIGHBOR_LABELS: Record<string, string> = {
  belgium: "Belgium",
  denmark: "Denmark",
  germany: "Germany",
  norway: "Norway",
  united_kingdom: "United Kingdom",
  sum: "All neighbors (net)",
};

/* The trailing window definition used by the chip: the snapshot's
   trailing series spans the trailing twelve months (its full-day
   array; the caption's "twelve months to" sentence and the tooltip's
   "12 months to" label state the same window). The chip counts months
   of window, never an annualized energy claim. */
const TRAILING_MONTHS = 12;
const chipText = `Last ${TRAILING_MONTHS} months`;

/* Sanctioned chart geometry: canvas, paddings and gutters. Axis domains
   and ticks are computed per series, never constants. */
const W = 720;
const AXIS_W = 36; // left gutter for the y-axis tick labels
const UNIT_H = 12; // top strip for the unit label
const PAD = 8;
const FIG_H = 14; // strips above and below the plot for the printed figures
const LABEL_H = 16; // bottom strip for the country labels
const PLOT_H = 160; // plot band for the bars
const BAR_W = 20;
const BAR_GAP = 8;

const H = PAD + UNIT_H + FIG_H + PLOT_H + FIG_H + PAD + LABEL_H;

/** Round for the compact client payload: one decimal, null stays null. */
const round1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

/* ---- build-time computation (Node, from the embedded snapshot) ---- */

const neighbors = Object.keys(NEIGHBOR_LABELS).filter((n) => n !== "sum");
const days = snapshot.trailing.days;

/** Trailing-window energy of one flow series: the sum of its positive
    hourly values is the import side, minus the sum of its negative
    hourly values the export side, divided by 1000 for TWh. Null and
    non-finite hours are skipped; an empty series yields null, not NaN. */
function trailingTWh(series: (number | null)[][]): { importTWh: number | null; exportTWh: number | null } {
  let imp = 0;
  let exp = 0;
  let seen = false;
  for (const day of series) {
    for (const v of day ?? []) {
      if (v == null || !Number.isFinite(v)) continue;
      seen = true;
      if (v > 0) imp += v;
      else exp += -v;
    }
  }
  if (!seen) return { importTWh: null, exportTWh: null };
  return { importTWh: imp / 1000, exportTWh: exp / 1000 };
}

interface TrailingVolume {
  importTWh: number | null;
  exportTWh: number | null;
  netTWh: number | null;
}

const trailing: Record<string, TrailingVolume> = {};
for (const n of [...neighbors, "sum"]) {
  const t = trailingTWh(days.map((d) => d.flows[n] ?? []));
  trailing[n] = {
    importTWh: t.importTWh,
    exportTWh: t.exportTWh,
    netTWh: t.importTWh != null && t.exportTWh != null ? t.importTWh - t.exportTWh : null,
  };
}

const years = snapshot.flowVolumes.years;
const yearLabels = years.map((y) => String(y.year));
const trailingLabel = snapshot.trailing.to ? `12 months to ${snapshot.trailing.to}` : "Trailing 12 months";
const tipLabels = [...yearLabels, trailingLabel];
const trailingIndex = years.length;

/* Tooltip payload: per neighbor an import, export and net series over the
   calendar years, with the trailing-window figures appended as the value
   at the extra trailing index. */
const volumeSeries = neighbors.flatMap((n) => {
  const label = NEIGHBOR_LABELS[n];
  const t = trailing[n];
  return [
    {
      name: `${label} import`,
      unit: "TWh",
      decimals: 1,
      values: [...years.map((y) => round1(y.neighbors[n]?.importTWh ?? null)), round1(t.importTWh)],
    },
    {
      name: `${label} export`,
      unit: "TWh",
      decimals: 1,
      values: [...years.map((y) => round1(y.neighbors[n]?.exportTWh ?? null)), round1(t.exportTWh)],
    },
    {
      name: `${label} net`,
      unit: "TWh",
      decimals: 1,
      values: [...years.map((y) => round1(y.neighbors[n]?.netTWh ?? null)), round1(t.netTWh)],
    },
  ];
});

/** One neighbor group: a nested SVG scope that is its own data-tip-root
    (the old seriesBase pattern), carrying the bar pair, the printed
    figures, the country label and the full-height hit strips. Local
    coordinates: the nested viewport maps 1:1 onto the panel. */
function NeighborGroup({
  neighbor,
  seriesBase,
  gx,
  groupW,
  y,
  zeroY,
}: {
  neighbor: string;
  seriesBase: number;
  gx: number;
  groupW: number;
  y: (v: number) => number;
  zeroY: number;
}) {
  const label = NEIGHBOR_LABELS[neighbor];
  const t = trailing[neighbor];
  const imp = t.importTWh;
  const exp = t.exportTWh;
  const pairW = 2 * BAR_W + BAR_GAP;
  const importX = (groupW - pairW) / 2;
  const exportX = importX + BAR_W + BAR_GAP;
  const importCX = importX + BAR_W / 2;
  const exportCX = exportX + BAR_W / 2;
  const slice = groupW / tipLabels.length;
  return (
    <svg
      x={gx}
      y={0}
      width={groupW}
      height={H}
      viewBox={`0 0 ${groupW} ${H}`}
      role="group"
      aria-label={`${label}: import and export bars, trailing twelve months`}
      data-tip-root
      data-units={groupW}
      data-x0={0}
      data-x1={groupW}
      data-tip-series={`${seriesBase},${seriesBase + 1},${seriesBase + 2}`}
      data-tip-qualifier="imports positive, exports negative"
    >
      {imp != null && Number.isFinite(imp) && (
        <Fragment>
          <rect
            className="chart-tooltip-trigger"
            tabIndex={0}
            data-tip={trailingIndex}
            data-tip-visual
            data-cx={importCX}
            x={importX}
            y={y(imp)}
            width={BAR_W}
            height={Math.max(0, zeroY - y(imp))}
            fill="var(--gg-flow-import)"
            aria-label={`${label} import, trailing twelve months: ${formatNumber(imp, 1)} TWh (imports positive, exports negative)`}
          />
          <text x={importCX} y={y(imp) - 4} textAnchor="middle" className="gg-label fill-muted-foreground tabular-nums">
            {formatNumber(imp, 1)}
          </text>
        </Fragment>
      )}
      {exp != null && Number.isFinite(exp) && (
        <Fragment>
          <rect
            className="chart-tooltip-trigger"
            tabIndex={0}
            data-tip={trailingIndex}
            data-tip-visual
            data-cx={exportCX}
            x={exportX}
            y={zeroY}
            width={BAR_W}
            height={Math.max(0, y(-exp) - zeroY)}
            fill="var(--gg-flow-export)"
            aria-label={`${label} export, trailing twelve months: ${formatNumber(exp, 1)} TWh (imports positive, exports negative)`}
          />
          <text x={exportCX} y={y(-exp) + 12} textAnchor="middle" className="gg-label fill-muted-foreground tabular-nums">
            {formatNumber(exp, 1)}
          </text>
        </Fragment>
      )}
      <text x={groupW / 2} y={H - 5} textAnchor="middle" className="gg-label fill-muted-foreground">
        {label}
      </text>
      {/* full-height hit strips, one per tooltip label, tiling the group */}
      {tipLabels.map((_, k) => (
        <rect
          key={k}
          className="chart-hit"
          data-tip={k}
          data-cx={(k + 0.5) * slice}
          x={k * slice}
          y={0}
          width={slice}
          height={H}
        />
      ))}
    </svg>
  );
}

/** The one aggregate panel: five neighbor groups on a shared signed
    axis, zero line across the plot, unit TWh on the axis. */
function FlowPanel() {
  const plotLeft = AXIS_W;
  const plotRight = W - PAD;
  const plotTop = PAD + UNIT_H + FIG_H;
  const plotBottom = plotTop + PLOT_H;

  // Computed signed axis over all ten bars, zero always in the domain.
  const signed: number[] = [];
  for (const n of neighbors) {
    const t = trailing[n];
    if (t.importTWh != null && Number.isFinite(t.importTWh)) signed.push(t.importTWh);
    if (t.exportTWh != null && Number.isFinite(t.exportTWh)) signed.push(-t.exportTWh);
  }
  const axis = niceAxis(signed.length ? Math.min(...signed) : 0, signed.length ? Math.max(...signed) : 0);
  const y = axisY(axis, plotTop, plotBottom);
  const zeroY = y(0);

  const groupW = (plotRight - plotLeft) / neighbors.length;

  const panelAria = `Import and export per neighbor, trailing twelve months${snapshot.trailing.to ? ` to ${snapshot.trailing.to}` : ""}: ${neighbors
    .map((n) => {
      const t = trailing[n];
      return `${NEIGHBOR_LABELS[n]} imported ${formatNumber(t.importTWh, 1)} TWh and exported ${formatNumber(t.exportTWh, 1)} TWh`;
    })
    .join("; ")}. Imports positive, exports negative.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={panelAria}>
      <YAxis axis={axis} plotLeft={plotLeft} plotRight={plotRight} plotTop={plotTop} plotBottom={plotBottom} unit="TWh" skipZero />
      <line x1={plotLeft} x2={plotRight} y1={zeroY} y2={zeroY} stroke="var(--border)" />
      {neighbors.map((n, g) => (
        <NeighborGroup
          key={n}
          neighbor={n}
          seriesBase={g * 3}
          gx={plotLeft + g * groupW}
          groupW={groupW}
          y={y}
          zeroY={zeroY}
        />
      ))}
    </svg>
  );
}

export function Flows() {
  const total = trailing.sum;
  const importTotal = total.importTWh;
  const exportTotal = total.exportTWh;
  const netTotal = total.netTWh;

  // Derived extremes over the five neighbors; a rule that cannot pick a
  // unique winner (no data, or a tie) omits its sentence gracefully.
  const cand: { n: string; imp: number; exp: number }[] = [];
  for (const n of neighbors) {
    const t = trailing[n];
    if (t.importTWh != null && t.exportTWh != null && Number.isFinite(t.importTWh) && Number.isFinite(t.exportTWh)) {
      cand.push({ n, imp: t.importTWh, exp: t.exportTWh });
    }
  }
  const traffics = cand.map((c) => ({ ...c, traffic: c.imp + c.exp }));
  const maxTraffic = traffics.length ? Math.max(...traffics.map((c) => c.traffic)) : null;
  const busiestList = traffics.filter((c) => c.traffic === maxTraffic);
  const busiest = busiestList.length === 1 ? busiestList[0] : null;
  const maxExport = cand.length ? Math.max(...cand.map((c) => c.exp)) : null;
  const topList = cand.filter((c) => c.exp === maxExport);
  const topExport = topList.length === 1 ? topList[0] : null;

  const parts: React.ReactNode[] = [];
  if (importTotal != null && exportTotal != null && netTotal != null) {
    parts.push(
      <Fragment key="national">
        Over the twelve months{snapshot.trailing.to ? ` to ${snapshot.trailing.to}` : ""}, the Netherlands imported{" "}
        <span className="tabular-nums">{formatNumber(importTotal, 1)} TWh</span> and exported{" "}
        <span className="tabular-nums">{formatNumber(exportTotal, 1)} TWh</span> across all neighbors, a net{" "}
        {netTotal < 0 ? "export" : "import"} of <span className="tabular-nums">{formatSigned(netTotal, 1)} TWh</span>.
      </Fragment>,
    );
  }
  if (busiest) {
    parts.push(
      <Fragment key="busiest">
        The busiest two-way border is {NEIGHBOR_LABELS[busiest.n]}:{" "}
        <span className="tabular-nums">{formatNumber(busiest.imp, 1)} TWh</span> in,{" "}
        <span className="tabular-nums">{formatNumber(busiest.exp, 1)} TWh</span> out.
      </Fragment>,
    );
  }
  if (topExport) {
    parts.push(
      <Fragment key="top">
        {NEIGHBOR_LABELS[topExport.n]} takes the most: <span className="tabular-nums">{formatNumber(topExport.exp, 1)} TWh</span> out.
      </Fragment>,
    );
  }
  parts.push(
    <Fragment key="caveat">
      Flows are physical: power can transit the Dutch grid on its way elsewhere, so these figures describe where electricity crosses
      the border, not who traded it.
    </Fragment>,
  );

  return (
    <FamilySection
      title={
        <>
          Where power flows
          {/* the window chip, same pattern as the chapters titles; the
              gg-heading-wide override lifts the .gg-heading 18ch cap so
              the chip stays on the title line instead of wrapping below
              it (the card content is wide enough for both) */}
          <span
            aria-hidden="true"
            className="gg-label ml-3 inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 align-middle text-muted-foreground"
          >
            {chipText}
          </span>
        </>
      }
      description="Cross-border physical flows (cbpf) between the Netherlands and its neighbors. Imports count up in teal, exports down in orange; the source's sign convention (imports positive, exports negative) is disclosed here."
      headingClassName="gg-heading-wide"
    >
      <h3 className="text-lg font-bold tracking-tight">Import and export per neighbor</h3>
      <ChartTooltip labels={tipLabels} series={volumeSeries}>
        <div className="mt-2 rounded-lg border border-border p-2">
          <FlowPanel />
        </div>
      </ChartTooltip>
      {/* Static legend row under the chart, same pattern as the chapters
          legend: swatches in the flow color tokens (the theme mapping pairs
          bg-gg-flow-* with the bars' fill-gg-flow-*, so one token drives
          both), standard label size, no hover behavior or state. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 gg-label text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2 w-3 rounded-[2px] bg-gg-flow-import" />
          Import
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2 w-3 rounded-[2px] bg-gg-flow-export" />
          Export
        </span>
      </div>
      <p className="mt-4 gg-caption">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? " " : ""}
            {part}
          </Fragment>
        ))}
      </p>
    </FamilySection>
  );
}
