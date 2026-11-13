import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { WINDOW_PARAMS } from "@/grid/green-window";

/*
  The four chapters: the morning gas ramp, the solar valley, the evening
  peak, the wind night. Each is a derived headline sentence (every figure
  computed at render time from the snapshot's trailing-30-day average day
  profiles) plus its evidence visual — a 24-hour profile chart, pure SVG,
  bars keyboard-focusable with per-bar labels.
*/

const profiles = snapshot.derived.profiles30d;

function argExtreme(key: string, mode: "max" | "min"): { hour: number; value: number | null } {
  const arr = profiles[key] ?? [];
  let best = mode === "max" ? -Infinity : Infinity;
  let bh = 0;
  arr.forEach((v, i) => {
    if (v != null && (mode === "max" ? v > best : v < best)) {
      best = v;
      bh = i;
    }
  });
  return { hour: bh, value: arr.length ? best : null };
}

const at = (key: string, hour: number) => profiles[key]?.[hour] ?? null;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Pure-SVG 24-hour profile: bars for `series`, line overlay for `overlay`. */
function DayProfile({
  series,
  seriesLabel,
  seriesUnit,
  overlay,
  overlayLabel,
  overlayUnit,
  barClass,
}: {
  series: (number | null)[];
  seriesLabel: string;
  seriesUnit: string;
  overlay?: (number | null)[];
  overlayLabel?: string;
  overlayUnit?: string;
  barClass: string;
}) {
  const W = 720;
  const H = 160;
  const PAD = 8;
  const vals = series.filter((v): v is number => v != null);
  const max = vals.length ? Math.max(...vals) : 1;
  const ovals = (overlay ?? []).filter((v): v is number => v != null);
  const omax = ovals.length ? Math.max(...ovals) : 1;
  const bw = (W - PAD * 2) / 24;
  const summary = `${seriesLabel} by hour of an average day over the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days. Peak ${formatNumber(
    max,
    0,
  )} ${seriesUnit}${overlay && overlayLabel ? `; ${overlayLabel} peaks at ${formatNumber(omax, 1)} ${overlayUnit}` : ""}.`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-4 w-full"
      role="img"
      aria-label={summary}
    >
      {series.map((v, h) => {
        const height = v != null ? (v / max) * (H - PAD * 2 - 14) : 0;
        return (
          <rect
            key={h}
            tabIndex={0}
            className={`chart-tooltip-trigger ${barClass}`}
            x={PAD + h * bw + 1}
            y={H - PAD - height}
            width={Math.max(1, bw - 2)}
            height={Math.max(0, height)}
            aria-label={`${hh(h)}, ${seriesLabel} ${v != null ? `${formatNumber(v, 0)} ${seriesUnit}` : "no data"}`}
          >
            <title>
              {hh(h)} — {seriesLabel}: {v != null ? `${formatNumber(v, 0)} ${seriesUnit}` : "no data"}
            </title>
          </rect>
        );
      })}
      {overlay && (
        <polyline
          fill="none"
          stroke="var(--brand-accent)"
          strokeWidth="2"
          points={overlay
            .map((v, h) => {
              if (v == null) return null;
              const x = PAD + h * bw + bw / 2;
              const y = H - PAD - (v / omax) * (H - PAD * 2 - 14);
              return `${x},${y}`;
            })
            .filter(Boolean)
            .join(" ")}
          aria-label={overlayLabel ?? ""}
        />
      )}
      {[0, 6, 12, 18, 23].map((h) => (
        <text
          key={h}
          x={PAD + h * bw + bw / 2}
          y={H - 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="9"
        >
          {hh(h)}
        </text>
      ))}
    </svg>
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
    <FamilySection title={title} description={description}>
      <p className="text-xl font-bold leading-snug tracking-tight sm:text-2xl">{headline}</p>
      {children}
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}

export function Chapters() {
  const gasPeak = argExtreme("fossil_gas", "max");
  const gasMin = argExtreme("fossil_gas", "min");
  const solarPeak = argExtreme("solar", "max");
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
        title="The morning gas ramp"
        description="What the average day does to gas-fired plants and prices between the night low and the morning ramp."
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
          barClass="fill-chart-2"
        />
      </Chapter>

      <Chapter
        id="solarValley"
        title="The solar valley"
        description="Midday solar floods the grid, prices sag, and the green window opens."
        headline={
          <>
            Solar peaks at <span className="tabular-nums">{formatNumber(solarPeak.value, 0)} MW</span> around{" "}
            {hh(solarPeak.hour)}, and the average day-ahead price bottoms at{" "}
            <span className="tabular-nums">{formatNumber(priceMin.value, 1)} EUR/MWh</span> at {hh(priceMin.hour)} —
            the heart of the green window.
          </>
        }
      >
        <DayProfile
          series={profiles.solar ?? []}
          seriesLabel="Solar production"
          seriesUnit="MW"
          overlay={profiles.price ?? []}
          overlayLabel="Day-ahead price"
          overlayUnit="EUR/MWh"
          barClass="fill-brand-accent"
        />
      </Chapter>

      <Chapter
        id="eveningPeak"
        title="The evening peak"
        description="Demand tops out in the evening; prices follow and imports fill the gap — the red-hours territory."
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
          barClass="fill-chart-1"
        />
      </Chapter>

      <Chapter
        id="windNight"
        title="The wind night"
        description="Windy nights run the grid cleanest: high renewable share, low computed intensity, low prices."
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
          barClass="fill-chart-3"
        />
      </Chapter>
    </>
  );
}
