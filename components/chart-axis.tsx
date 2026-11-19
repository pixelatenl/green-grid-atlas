import { formatNumber } from "@/data/snapshot";

/*
  Computed y-axes for the pure-SVG charts. Nothing here is a statistical
  literal: the domain and every tick are computed at build time from the
  series being drawn. The only policy is the standard nice-number
  pattern (steps from the 1, 2, 5 family) with three to five ticks, zero
  always included at the baseline, and the top of the axis is the series
  maximum rounded up to a human step. The chart geometry (plot edges,
  gutters) is set per chart as a sanctioned design constant.
*/

export interface AxisSpec {
  lo: number;
  hi: number;
  step: number;
  ticks: number[];
  /** Fraction digits needed to print the step cleanly. */
  decimals: number;
}

/**
 * Nice axis over [minV, maxV] with zero always in the domain (the
 * baseline). For signed charts (flow timelines, volume bars) the bottom
 * is the minimum rounded down to a nice step; for non-negative bar
 * series the bottom is zero.
 */
export function niceAxis(minV: number, maxV: number, targetCount = 4): AxisSpec {
  const loRaw = Math.min(0, minV);
  const hiRaw = Math.max(0, maxV);
  if (!(hiRaw > 0) && !(loRaw < 0)) {
    // Degenerate all-zero series: still an honest 0..1 axis, never NaN.
    return { lo: 0, hi: 1, step: 0.5, ticks: [0, 0.5, 1], decimals: 1 };
  }
  const span = hiRaw - loRaw;
  const rough = span / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const build = (st: number) => {
    const lo = Math.floor(loRaw / st) * st;
    const hi = Math.ceil(hiRaw / st) * st;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + st / 2; v += st) ticks.push(Number(v.toPrecision(12)));
    return { lo, hi, ticks };
  };
  let { lo, hi, ticks } = build(step);
  // Keep the tick count in the promised three to five.
  while (ticks.length > 5 && step < span) {
    step *= 2;
    ({ lo, hi, ticks } = build(step));
  }
  while (ticks.length < 3 && step > 1e-9) {
    step /= 2;
    ({ lo, hi, ticks } = build(step));
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return { lo, hi, step, ticks, decimals };
}

/** Map a data value to a y pixel inside the plot band. */
export const axisY =
  (axis: AxisSpec, plotTop: number, plotBottom: number) =>
  (v: number): number =>
    plotBottom - ((v - axis.lo) / (axis.hi - axis.lo)) * (plotBottom - plotTop);

/**
 * The single left y-axis: thin horizontal gridlines in the existing
 * border token, muted tick labels, the unit stated once at the top of
 * the axis, and a thin vertical axis line. `skipZero` leaves out the
 * zero gridline on charts that already draw their own zero line.
 */
export function YAxis({
  axis,
  plotLeft,
  plotRight,
  plotTop,
  plotBottom,
  unit,
  skipZero = false,
}: {
  axis: AxisSpec;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  unit: string;
  skipZero?: boolean;
}) {
  const y = axisY(axis, plotTop, plotBottom);
  return (
    <g>
      <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} stroke="var(--border)" strokeWidth={1} />
      {axis.ticks.map((t) => (
        <g key={t}>
          {!(skipZero && t === 0) && (
            <line x1={plotLeft} x2={plotRight} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          )}
          <text x={plotLeft - 4} y={y(t) + 3} textAnchor="end" fontSize="9" className="fill-muted-foreground">
            {formatNumber(t, axis.decimals)}
          </text>
        </g>
      ))}
      <text x={4} y={10} fontSize="9" className="fill-muted-foreground">
        {unit}
      </text>
    </g>
  );
}
