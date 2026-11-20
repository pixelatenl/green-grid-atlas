import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { formatBand, WINDOW_PARAMS } from "@/grid/green-window";
import {
  HOUR_LABELS,
  SEASONAL_HOLDS_UP_PCT,
  bandWords,
  daypartFor,
  seasonPhraseForMonth,
} from "@/grid/editorial";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { ChartTooltip } from "@/components/chart-tooltip";

/*
  The red hours: the exact mirror of the settled green window
  treatment, computed by the same rule code path with inverted
  thresholds (price at or above the 70th percentile AND renewable share
  at or below the 30th). Every figure derives from the snapshot's
  greenWindow.red (computed by the one rule code path in
  src/grid/green-window.ts); no count, threshold or percentage is
  hardcoded. The editorial mappings (daypart, season, band words, the
  50 percent seasonal tier) come from the shared module
  src/grid/editorial.ts, so this card can never drift from the green
  card.

  The strip is the structural mirror of the green strip: 24 bars in the
  sanctioned 240 px plot (h-60), one per wall-clock hour, a bar's height
  the share of the trailing days whose qualifyingHours include that
  hour, with the left gutter percent axis, gridlines at 25/50/75
  percent, the "red on half the days" label on the half-height line,
  and the plot borders as the 0 and 100 percent marks. Three honest
  bar states, all in the red band token family so the red hours read
  unmistakably red in both themes (contrast per theme, bars are
  graphical objects not text):
  - inside the modal recurring band: solid var(--gg-red-band), light
    #b91c1c on the plot background at 5.87:1, dark #f87171 on the plot
    background at 4.75:1;
  - qualifying hours outside the band: the same token at 45 percent
    over the plot background, still distinct from the solid bars
    (2.91:1 light, 2.35:1 dark between the two reds);
  - zero-count hours: a fixed 2 px stub in the track token
    var(--chart-track), never a hidden or zero-height lie.
  Under the bars a bracket spans exactly the modal band hours, placed
  with percentage math from startHour/endHour, with up-ticks at both
  ends and a centered micro label. The 24 cells sit on the shared
  ChartTooltip island (series mode, data-units 24): each cell is
  focusable with an honest aria-label, carries a wide hit target (the
  full-height cell itself) and shows the server-computed per-hour count
  sentence as the tooltip note; the qualifier stays the full red rule
  sentence. The native title attributes are gone.

  Type stays on the named scale from c1fb692 and nothing ad-hoc is
  introduced: the statement stays .gg-statement, the chip label words
  and the bracket/gridline/tick micro labels are .gg-label, the chip
  p-lines and the strip caption are .gg-caption.
*/

/* Sanctioned strip geometry, mirrored from the green card: the plot
   row is the sanctioned 240 px height (h-60); the zero-count stub
   stays a fixed 2 px. Bar heights are percentages of the plot row, so
   they scale with it unchanged. */
const PLOT_CLASS = "h-60";
const ZERO_STUB_H = "2px";
/* Sanctioned scale geometry, not statistics: the percent marks on the
   left gutter axis. The plot's own bottom and top borders are the 0
   and 100 percent marks; the inner marks carry the plot gridlines. */
const SCALE_MARKS = [0, 25, 50, 75, 100] as const;
/* The bracket label is centered on the bracket, clamped so it never
   leaves the strip on narrow screens (half its approx width is 92px). */
const LABEL_CLAMP = 92;

export function RedHoursCard() {
  const gw = snapshot.greenWindow;
  const band = gw.red.modalBand;
  const days = gw.red.days;
  const sharePct = gw.red.frequencyShare * 100;
  const narration = narrationFor("redHours");

  /* The statement's words form: the daypart from the band's start hour
     and the band words (end hour plus one) from the shared module, the
     same render path the green statement uses. The dashed formatBand
     range stays the sanctioned label form for the tooltips and aria
     labels; the headline uses words, per the product owner's
     decision. */
  const daypart = band ? daypartFor(band.startHour) : "";

  /* Seasonal honesty line: the full band's day count derives from
     frequencyShare * days at build time; never a hardcoded count. */
  const bandDays = Math.round(gw.red.frequencyShare * days);
  const seasonalLine =
    gw.red.frequencyShare * 100 < SEASONAL_HOLDS_UP_PCT
      ? `The red hours are thin this season: the full band opened on ${bandDays} of the last ${days} days.`
      : `The red hours hold up well: the full band opened on ${bandDays} of the last ${days} days.`;

  /* The season phrase in the section title derives from the snapshot's
     own freshness date (retrievedAt slice 5-7, the same source the
     snapshot-fresh sentence uses); never hardcoded to a season. */
  const seasonPhrase = seasonPhraseForMonth(Number(snapshot.retrievedAt.slice(5, 7)));
  const priceP70 = gw.percentiles.priceP70;
  const renP30 = gw.percentiles.renP30;
  const threshold = `red rule: price at or above ${formatNumber(priceP70, 1)} EUR/MWh and renewable share at or below ${formatNumber(renP30, 1)}%`;

  /* Per-hour frequency over the trailing days, derived from the
     snapshot's qualifyingHours at build time. Never a hardcoded count. */
  const counts = Array.from({ length: 24 }, () => 0);
  for (const date of Object.keys(gw.red.qualifyingHours)) {
    for (const h of gw.red.qualifyingHours[date]) {
      if (h >= 0 && h < 24) counts[h] += 1;
    }
  }
  const inBand = (h: number) => band != null && h >= band.startHour && h <= band.endHour;
  const pctOf = (h: number) => (days > 0 ? formatNumber((counts[h] / days) * 100, 0) : "0");

  /* Tooltip notes and aria-labels: honest per-hour count sentences,
     including the zero-count case. */
  const notes = HOUR_LABELS.map(
    (_, h) =>
      `Met the red rule on ${counts[h]} of ${days} days (${pctOf(h)}%). ${
        inBand(h) ? "In the red hours" : "Outside the red hours"
      }`,
  );
  const ariaFor = (h: number) =>
    `${HOUR_LABELS[h]}: met the red rule on ${counts[h]} of ${days} days; ${
      inBand(h) ? "inside" : "outside"
    } the red hours.`;
  const stripAria = `Per-hour frequency strip over the trailing ${days} days: how many days each hour met the red rule. The red hours ${
    band ? formatBand(band) : "are empty"
  }, on ${formatNumber(sharePct, 0)}% of the trailing ${days} days. Vertical scale: the percentage of the trailing ${days} days on which each hour met the red rule.`;

  /* Bracket math: the range line spans exactly the modal band hours as
     a percentage of the 24 hour columns. */
  const bracketLeft = band ? (band.startHour / 24) * 100 : 0;
  const bracketWidth = band ? ((band.endHour - band.startHour + 1) / 24) * 100 : 0;
  const bracketCenter = bracketLeft + bracketWidth / 2;
  const labelLeft = `clamp(${LABEL_CLAMP}px, ${bracketCenter}%, calc(100% - ${LABEL_CLAMP}px))`;

  /* The three honest bar states; heights are a share of the plot row,
     widths a fixed 80 percent of the hour cell. */
  const barStyle = (h: number): React.CSSProperties => {
    if (counts[h] === 0 || days === 0) {
      return { height: ZERO_STUB_H, background: "var(--chart-track)" };
    }
    const height = `${(counts[h] / days) * 100}%`;
    if (inBand(h)) return { height, background: "var(--gg-red-band)" };
    return { height, background: "color-mix(in oklab, var(--gg-red-band) 45%, transparent)" };
  };

  return (
    /* The season phrase makes this title longer than the .gg-heading
       18ch scale cap, so this one heading uses the documented
       gg-heading-wide override: it spans the full card content width,
       like the green window title. */
    <FamilySection
      headingClassName="gg-heading-wide"
      title={
        <>
          The <span className="text-brand-accent">red hours</span> {seasonPhrase}
        </>
      }
      description={`The recurring hours when Dutch power is both expensive and dirty, computed from the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days.`}
    >
      <p className="gg-statement">
        {band ? (
          <>
            The priciest, dirtiest hours come in {daypart}: most often between{" "}
            <span className="text-brand-accent">{bandWords(band.startHour, band.endHour)}</span>.
          </>
        ) : (
          <>No recurring red band in the last {days} days.</>
        )}
      </p>

      {/* the two criteria chips, both required; the AND badge is
          decorative (aria-hidden), the list label carries the
          conjunction for screen readers */}
      <ul
        role="list"
        aria-label={`Red rule, both criteria required: day-ahead price at or above ${formatNumber(priceP70, 1)} EUR/MWh AND renewable share of generation at or below ${formatNumber(renP30, 1)}%`}
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch"
      >
        <li className="flex-1 rounded-lg border border-border bg-background p-3">
          <p className="gg-label text-muted-foreground">Expensive</p>
          <p className="mt-1">
            day-ahead price at or above{" "}
            <span className="font-medium tabular-nums">{formatNumber(priceP70, 1)} EUR/MWh</span>
          </p>
          <p className="mt-1 gg-caption">
            pricier than about {100 - WINDOW_PARAMS.RED_PRICE_PERCENTILE}% of hours in the trailing{" "}
            {WINDOW_PARAMS.TRAILING_DAYS} days
          </p>
        </li>
        <li aria-hidden="true" className="flex items-center justify-center">
          <span className="gg-label rounded-full border border-border px-2 py-0.5 text-muted-foreground">AND</span>
        </li>
        <li className="flex-1 rounded-lg border border-border bg-background p-3">
          <p className="gg-label text-muted-foreground">Dirty</p>
          <p className="mt-1">
            renewable share of generation at or below{" "}
            <span className="font-medium tabular-nums">{formatNumber(renP30, 1)}%</span>
          </p>
          <p className="mt-1 gg-caption">
            less renewable than about {100 - WINDOW_PARAMS.RED_RENEWABLE_PERCENTILE}% of hours in the trailing{" "}
            {WINDOW_PARAMS.TRAILING_DAYS} days
          </p>
        </li>
      </ul>

      {/* per-hour frequency strip on the shared ChartTooltip island */}
      <ChartTooltip labels={HOUR_LABELS} notes={notes}>
        <div className="mt-6">
          <div className="flex">
            {/* left gutter: the percent scale axis, aria-hidden; the same
                scale is stated in the plot group's aria-label below */}
            <div aria-hidden="true" className={`relative ${PLOT_CLASS} w-12 shrink-0 pr-2`}>
              {SCALE_MARKS.map((mark) => (
                <span
                  key={mark}
                  className="gg-label absolute right-0 text-muted-foreground"
                  style={{ top: `${100 - mark}%`, transform: "translateY(-50%)" }}
                >
                  {mark}%
                </span>
              ))}
            </div>
            {/* plot column: the plot and the bracket and tick rows below
                stay aligned to the plot area, not the full card width */}
            <div className="min-w-0 flex-1">
              <div
                className={`relative ${PLOT_CLASS} overflow-hidden rounded-lg border border-border bg-background`}
                role="group"
                aria-label={stripAria}
                data-tip-root
                data-units="24"
                data-x0="0"
                data-x1="24"
                data-tip-qualifier={threshold}
              >
                {/* quarter and three-quarter scale gridlines, styled
                    exactly like the half-height line below */}
                <div aria-hidden="true" className="absolute inset-x-0 top-[25%] border-t border-border" />
                <div aria-hidden="true" className="absolute inset-x-0 top-[75%] border-t border-border" />
                {/* half-height scale gridline with its micro label */}
                <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
                <span
                  aria-hidden="true"
                  className="gg-label absolute right-0 top-1/2 text-muted-foreground"
                  style={{ transform: "translateY(-150%)", background: "var(--background)", padding: "0 2px" }}
                >
                  red on half the days
                </span>
                {/* 24 bars; each full-height cell is the wide hit target */}
                <div className="flex h-full">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      tabIndex={0}
                      className="chart-tooltip-trigger relative h-full flex-1 border-r border-border/40 last:border-r-0"
                      data-tip={h}
                      data-tip-visual
                      data-cx={h + 0.5}
                      aria-label={ariaFor(h)}
                    >
                      <div
                        className="absolute bottom-0 left-1/2 w-[80%] -translate-x-1/2 rounded-t-[2px]"
                        style={barStyle(h)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* bracket marking the recurring window: a thin range line
                  over exactly the modal band hours, up-ticks at both ends,
                  centered micro label; only drawn when a band exists */}
              {band && (
                <div aria-hidden="true" className="relative mt-1 h-7">
                  <div
                    className="absolute top-[6px] h-[2px]"
                    style={{ left: `${bracketLeft}%`, width: `${bracketWidth}%`, background: "var(--gg-red-band)" }}
                  >
                    <span
                      className="absolute left-0 top-[-6px] h-[8px] w-[2px]"
                      style={{ background: "var(--gg-red-band)" }}
                    />
                    <span
                      className="absolute right-0 top-[-6px] h-[8px] w-[2px]"
                      style={{ background: "var(--gg-red-band)" }}
                    />
                  </div>
                  <span
                    className="gg-label absolute top-[10px] whitespace-nowrap text-muted-foreground"
                    style={{ left: labelLeft, transform: "translateX(-50%)" }}
                  >
                    the recurring window
                  </span>
                </div>
              )}

              {/* hour ticks below the strip, as before */}
              <div className="mt-1 flex justify-between gg-label text-muted-foreground">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
            </div>
          </div>
        </div>
      </ChartTooltip>

      <p className="mt-2 gg-caption">
        Why these hours: on a dynamic tariff, shifting flexible use such as charging or dishwashing out of this
        window costs less and avoids the grid's most fossil-heavy hours. {seasonalLine} Each bar counts how many
        of the trailing {days} days that hour met the red rule, counting any qualifying day, lone hours included.{" "}
        {band
          ? `The bracket marks the recurring window: the contiguous band shape most frequent in the trailing days, recurring on ${formatNumber(sharePct, 0)}% of days. `
          : ""}
        Snapshot-fresh as of {snapshot.retrievedAt.slice(0, 10)}. All times Europe/Amsterdam.
      </p>
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}
