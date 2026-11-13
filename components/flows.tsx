import { snapshot, formatNumber, formatSigned } from "@/data/snapshot";
import { FamilySection } from "@/components/family-section";

/*
  Where power flows: a per-neighbor physical flow timeline (cbpf, GW, daily
  means over the trailing 12 months) plus per-neighbor import and export
  volumes in TWh per year. Sign convention disclosed on the card: imports
  positive, exports negative (energy-charts cbpf attributes).
*/

const NEIGHBOR_LABELS: Record<string, string> = {
  belgium: "Belgium",
  denmark: "Denmark",
  germany: "Germany",
  norway: "Norway",
  united_kingdom: "United Kingdom",
  sum: "All neighbors (net)",
};

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

function FlowTimeline({ neighbor }: { neighbor: string }) {
  const days = snapshot.trailing.days;
  const dates = days.map((d) => d.date);
  const series = days.map((d) => d.flows[neighbor] ?? []);
  const points = dailyMeans(series, dates);
  const vals = points.map((p) => p.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const max = vals.length ? Math.max(...vals) : 1;
  const min = vals.length ? Math.min(...vals) : -1;
  const W = 720;
  const H = 90;
  const PAD = 6;
  const zeroY = H - PAD - ((0 - min) / (max - min || 1)) * (H - PAD * 2);
  const step = (W - PAD * 2) / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      if (p.value == null) return null;
      const x = PAD + i * step;
      const y = H - PAD - ((p.value - min) / (max - min || 1)) * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const label = NEIGHBOR_LABELS[neighbor] ?? neighbor;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`${label}: daily mean physical flow over the trailing 12 months, GW, imports positive exports negative. Range ${formatNumber(min, 1)} to ${formatNumber(max, 1)} GW, mean ${formatNumber(mean, 1)} GW.`}
    >
      <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--gg-flow-import)" strokeWidth="1.5" tabIndex={0} aria-label={`${label} flow timeline, trailing 12 months, daily means in GW`}>
        {/* single string child: array children SSR empty and break hydration */}
        <title>{`${label}: daily mean flow, trailing 12 months. Range ${formatNumber(min, 1)} to ${formatNumber(max, 1)} GW (imports positive, exports negative), mean ${formatNumber(mean, 1)} GW.`}</title>
      </path>
      <text x={PAD} y={12} className="fill-muted-foreground" fontSize="9">
        {label} — daily mean GW ({formatNumber(min, 0)} … {formatNumber(max, 0)})
      </text>
    </svg>
  );
}

function VolumeBars({ neighbor }: { neighbor: string }) {
  const years = snapshot.flowVolumes.years;
  const label = NEIGHBOR_LABELS[neighbor] ?? neighbor;
  const nets = years.map((y) => y.neighbors[neighbor]?.netTWh ?? null);
  const vals = nets.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  // Guard the divisor: an all-zero neighbor (e.g. Denmark) would make v/max NaN.
  const max = vals.length ? Math.max(...vals.map((v) => Math.abs(v))) : 0;
  const W = 720;
  const H = 110;
  const PAD = 8;
  const bw = (W - PAD * 2) / years.length;
  const zeroY = H / 2;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`${label}: net physical flow per year in TWh, imports positive, exports negative.`}
    >
      <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="var(--border)" />
      {years.map((y, i) => {
        const v = y.neighbors[neighbor]?.netTWh ?? null;
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
        const h = max > 0 ? (Math.abs(v) / max) * (H / 2 - PAD) : 0;
        const x = PAD + i * bw + 2;
        return (
          <rect
            key={y.year}
            tabIndex={0}
            className="chart-tooltip-trigger"
            x={x}
            y={v >= 0 ? zeroY - h : zeroY}
            width={Math.max(2, bw - 4)}
            height={Math.max(1, h)}
            fill={v >= 0 ? "var(--gg-flow-import)" : "var(--gg-flow-export)"}
            aria-label={`${label} ${y.year}: net ${formatSigned(v, 1)} TWh (imports positive, exports negative)`}
          >
            {/* single string child: array children SSR empty and break hydration */}
            <title>{`${label} ${y.year}: import ${formatNumber(y.neighbors[neighbor]?.importTWh, 1)} TWh, export ${formatNumber(y.neighbors[neighbor]?.exportTWh, 1)} TWh, net ${formatSigned(v, 1)} TWh`}</title>
          </rect>
        );
      })}
      {years.map((y, i) => (
        <text
          key={y.year}
          x={PAD + i * bw + bw / 2}
          y={H - 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="9"
        >
          {String(y.year).slice(2)}
        </text>
      ))}
    </svg>
  );
}

export function Flows() {
  const neighbors = Object.keys(NEIGHBOR_LABELS).filter((n) => n !== "sum");
  const years = snapshot.flowVolumes.years;
  const lastYear = years[years.length - 1];
  const total = lastYear?.neighbors.sum;

  return (
    <FamilySection
      title="Where power flows"
      description="Cross-border physical flows (cbpf) between the Netherlands and its neighbors, in GW. Imports are positive, exports negative — that sign convention is the source's and is disclosed here."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {neighbors.map((n) => (
          <div key={n} className="rounded-lg border border-border p-2">
            <FlowTimeline neighbor={n} />
          </div>
        ))}
      </div>
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
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        {[...neighbors, "sum"].map((n) => (
          <div key={n} className="rounded-lg border border-border p-2">
            <VolumeBars neighbor={n} />
          </div>
        ))}
      </div>
    </FamilySection>
  );
}
