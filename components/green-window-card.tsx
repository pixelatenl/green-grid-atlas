import { snapshot, formatNumber, nf } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { formatBand, WINDOW_PARAMS } from "@/grid/green-window";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { ChartTooltip } from "@/components/chart-tooltip";

/*
  The signature statement: the green window, in big type, with a schedule
  band of the recurring clean-cheap hours. Every figure derives from the
  snapshot's greenWindow (computed by the one rule code path in
  src/grid/green-window.ts); the basis (renewable share of generation, NL
  generation mix) is named on the card.

  The 24 hour cells migrated onto the shared ChartTooltip: each cell is
  focusable with an honest aria-label, carries a wide hit target (the
  cell itself, full band height) and shows the hour, band membership and
  the computed percentage threshold in the tooltip. The native title
  attributes are gone.
*/

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

export function GreenWindowCard() {
  const gw = snapshot.greenWindow;
  const band = gw.green.modalBand;
  const sharePct = gw.green.frequencyShare * 100;
  const narration = narrationFor("greenWindow");
  const threshold = `green rule: price at or below ${formatNumber(gw.percentiles.priceP30, 1)} EUR/MWh and renewable share at or above ${formatNumber(gw.percentiles.renP70, 1)}%`;
  const notes = HOUR_LABELS.map((_, h) =>
    band != null && h >= band.startHour && h <= band.endHour ? "In the green window" : "Outside the green window",
  );
  const bandAria = `Schedule band of 24 hours: the green window ${band ? formatBand(band) : "is empty"}, on ${formatNumber(sharePct, 0)}% of the trailing ${gw.green.days} days.`;

  return (
    <FamilySection
      title={
        <>
          The <span className="text-brand-accent">green window</span>
        </>
      }
      description={`The recurring hours when Dutch power is both cheap and clean, computed from the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days, every figure below straight from the snapshot.`}
    >
      <p className="text-3xl font-black leading-[1.05] tracking-tight sm:text-5xl">
        {band ? (
          <>
            Most days, the greenest hours are{" "}
            <span className="text-brand-accent">{formatBand(band)}</span>,
            on{" "}
            <span className="tabular-nums">{formatNumber(sharePct, 0)}%</span>{" "}
            of the last {gw.green.days} days.
          </>
        ) : (
          <>No recurring green band in the last {gw.green.days} days.</>
        )}
      </p>
      <p className="mt-3 max-w-[62ch] text-sm text-muted-foreground">
        Green means day-ahead price at or below the{" "}
        {formatNumber(gw.percentiles.priceP30, 1)} EUR/MWh mark (p{WINDOW_PARAMS.GREEN_PRICE_PERCENTILE} of the trailing {WINDOW_PARAMS.TRAILING_DAYS} days){" "}
        <span aria-hidden="true">AND</span> renewable share of generation at or above{" "}
        {formatNumber(gw.percentiles.renP70, 1)}% (p{WINDOW_PARAMS.GREEN_RENEWABLE_PERCENTILE}). Basis: renewable share of{" "}
        <strong>generation</strong> (NL generation mix); price is the NL day-ahead price. Snapshot-fresh as of{" "}
        {snapshot.retrievedAt.slice(0, 10)}.
      </p>

      {/* schedule band: 24 wall hours, the modal band highlighted */}
      <ChartTooltip labels={HOUR_LABELS} notes={notes}>
        <div className="mt-6">
          <div
            className="flex h-14 overflow-hidden rounded-lg border border-border"
            role="group"
            aria-label={bandAria}
            data-tip-root
            data-units="24"
            data-x0="0"
            data-x1="24"
            data-tip-qualifier={threshold}
          >
            {Array.from({ length: 24 }, (_, h) => {
              const inBand = band != null && h >= band.startHour && h <= band.endHour;
              return (
                <div
                  key={h}
                  tabIndex={0}
                  className={`chart-tooltip-trigger flex-1 border-r border-border/40 last:border-r-0 ${inBand ? "bg-gg-green-band-soft" : ""}`}
                  style={inBand ? { boxShadow: "inset 0 3px 0 var(--gg-green-band)" } : undefined}
                  data-tip={h}
                  data-tip-visual
                  data-cx={h + 0.5}
                  aria-label={`${HOUR_LABELS[h]}, ${inBand ? "in the green window" : "outside the green window"}`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
        </div>
      </ChartTooltip>
      <p className="mt-2 text-xs text-muted-foreground">
        All times Europe/Amsterdam. The band shown is the modal recurring band of the trailing{" "}
        {gw.green.days} days ({nf.format(gw.green.days)} days, each hour an independent sample);
        single qualifying hours do not form the window.
      </p>
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}
