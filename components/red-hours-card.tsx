import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { formatBand, WINDOW_PARAMS } from "@/grid/green-window";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { ChartTooltip } from "@/components/chart-tooltip";

/*
  The red hours: the exact mirror of the green window, computed by the same
  rule code path with inverted thresholds (price at or above the 70th
  percentile AND renewable share at or below the 30th). One visual pair
  with the green window card.

  The 24 hour cells migrated onto the shared ChartTooltip: focusable
  cells with honest aria-labels, the hour and band membership in the
  tooltip, native title attributes removed.
*/

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

export function RedHoursCard() {
  const gw = snapshot.greenWindow;
  const band = gw.red.modalBand;
  const sharePct = gw.red.frequencyShare * 100;
  const narration = narrationFor("redHours");
  const threshold = `red rule: price at or above ${formatNumber(gw.percentiles.priceP70, 1)} EUR/MWh and renewable share at or below ${formatNumber(gw.percentiles.renP30, 1)}%`;
  const notes = HOUR_LABELS.map((_, h) =>
    band != null && h >= band.startHour && h <= band.endHour ? "In the red hours" : "Outside the red hours",
  );
  const bandAria = `Schedule band of 24 hours: the red hours band ${band ? formatBand(band) : "is empty"}, on ${formatNumber(sharePct, 0)}% of the trailing ${gw.red.days} days.`;

  return (
    <FamilySection
      title={
        <>
          The <span className="text-brand-accent">red hours</span>
        </>
      }
      description={`The exact inverse of the green window rule, from the same code path: price at or above p${WINDOW_PARAMS.RED_PRICE_PERCENTILE} and renewable share at or below p${WINDOW_PARAMS.RED_RENEWABLE_PERCENTILE} (expensive and low-renewable at the same time).`}
    >
      <p className="text-3xl font-black leading-[1.05] tracking-tight sm:text-5xl">
        {band ? (
          <>
            The priciest, dirtiest hours usually land at{" "}
            <span className="text-brand-accent">{formatBand(band)}</span>, on{" "}
            <span className="tabular-nums">{formatNumber(sharePct, 0)}%</span> of the last{" "}
            {gw.red.days} days.
          </>
        ) : (
          <>No recurring red band in the last {gw.red.days} days.</>
        )}
      </p>
      <p className="mt-3 max-w-[62ch] text-sm text-muted-foreground">
        Red means day-ahead price at or above {formatNumber(gw.percentiles.priceP70, 1)} EUR/MWh (p{WINDOW_PARAMS.RED_PRICE_PERCENTILE}
        of the trailing {WINDOW_PARAMS.TRAILING_DAYS} days) <span aria-hidden="true">AND</span> renewable share of
        generation at or below {formatNumber(gw.percentiles.renP30, 1)}% (p{WINDOW_PARAMS.RED_RENEWABLE_PERCENTILE}), the exact
        inverse of the green rule, computed by the same code, so the two can never contradict. Basis:
        renewable share of <strong>generation</strong> (NL generation mix).
      </p>
      <ChartTooltip labels={HOUR_LABELS} notes={notes}>
        <div
          className="mt-6"
          role="group"
          aria-label={bandAria}
          data-tip-root
          data-units="24"
          data-x0="0"
          data-x1="24"
          data-tip-qualifier={threshold}
        >
          <div className="flex h-14 overflow-hidden rounded-lg border border-border">
            {Array.from({ length: 24 }, (_, h) => {
              const inBand = band != null && h >= band.startHour && h <= band.endHour;
              return (
                <div
                  key={h}
                  tabIndex={0}
                  className={`chart-tooltip-trigger flex-1 border-r border-border/40 last:border-r-0 ${inBand ? "bg-gg-red-band-soft" : ""}`}
                  style={inBand ? { boxShadow: "inset 0 3px 0 var(--gg-red-band)" } : undefined}
                  data-tip={h}
                  data-tip-visual
                  data-cx={h + 0.5}
                  aria-label={`${HOUR_LABELS[h]}, ${inBand ? "in the red hours" : "outside the red hours"}`}
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
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}
