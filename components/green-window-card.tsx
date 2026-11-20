import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { formatBand, WINDOW_PARAMS } from "@/grid/green-window";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { ChartTooltip } from "@/components/chart-tooltip";

/*
  The signature statement: the green window, in big type on the shared
  .gg-statement level, with the per-hour frequency strip that shows the
  evidence behind the answer, and the two criteria chips that state the
  rule. Every figure derives from the snapshot's greenWindow (computed
  by the one rule code path in src/grid/green-window.ts); no count,
  threshold or percentage is hardcoded.

  The strip: 24 bars in a fixed-height plot, one per wall-clock hour.
  A bar's height is the number of trailing days whose qualifyingHours
  include that hour, divided by the trailing day count. Three honest
  bar states, all in the green band token family so the window reads
  unmistakably green in both themes (contrast per theme, bars are
  graphical objects not text):
  - inside the modal recurring band: solid var(--gg-green-band),
    light #1f8a4e on the plot background at 3.97:1, dark #5fd3a0 on the
    plot background at 7.08:1;
  - qualifying hours outside the band: the same token at 45 percent
    over the plot background, still distinct from the solid bars
    (2.24:1 light, 2.67:1 dark between the two greens);
  - zero-count hours: a fixed 2 px stub in the track token
    var(--chart-track), never a hidden or zero-height lie (distinct by
    its fixed 2 px height and its tone, 1.52:1 light, 2.01:1 dark
    against the plot background, and 2.61:1 light, 3.53:1 dark next to
    the solid band green).
  Under the bars a bracket spans exactly the modal band hours, placed
  with percentage math from startHour/endHour, with up-ticks at both
  ends and a centered micro label; one muted gridline at half the plot
  height carries the "green on half the days" scale label. The exact
  counts live in the tooltips, not on an axis.

  The 24 cells migrated onto the shared ChartTooltip island (series
  mode, data-units 24): each cell is focusable with an honest
  aria-label, carries a wide hit target (the full-height cell itself)
  and shows the server-computed per-hour count sentence as the tooltip
  note; the qualifier stays the full green rule sentence. The native
  title attributes are gone.

  Type stays on the named scale from c1fb692 and nothing ad-hoc is
  introduced: the statement stays .gg-statement, the chip label words
  and the bracket/gridline/tick micro labels are .gg-label, the chip
  p-lines and the strip captions are .gg-caption.
*/

/* Zero-padded hour labels; the band's exclusive end (endHour + 1) can
   be 24, rendered "24:00", the same label math formatBand uses. */
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => hourLabel(h));

/* Sanctioned strip geometry: the 112 px plot row sits inside the allowed
   96 to 120 px band; the zero-count stub is a fixed 2 px. */
const PLOT_CLASS = "h-28";
const ZERO_STUB_H = "2px";
/* The bracket label is centered on the bracket, clamped so it never
   leaves the strip on narrow screens (half its approx width is 92px). */
const LABEL_CLAMP = 92;

/*
  Sanctioned editorial mapping from the band's start hour to the
  statement's daypart words: a presentation constant, documented here,
  never tuned per snapshot. Ranges are inclusive start to inclusive
  end: 0 to 4 "the early night", 5 to 8 "the early morning", 9 to 11
  "the morning", 12 to 16 "the afternoon", 17 to 19 "the evening",
  20 to 23 "the night".
*/
const DAYPART_BY_START_HOUR: ReadonlyArray<readonly [maxHour: number, label: string]> = [
  [4, "the early night"],
  [8, "the early morning"],
  [11, "the morning"],
  [16, "the afternoon"],
  [19, "the evening"],
  [23, "the night"],
];
function daypartFor(startHour: number): string {
  for (const [maxHour, label] of DAYPART_BY_START_HOUR) {
    if (startHour <= maxHour) return label;
  }
  return "the night";
}

/*
  The one seasonal-line threshold: a sanctioned editorial constant,
  never tuned per snapshot. Below 50 percent frequency share the
  caption calls the window thin this season; at or above 50 percent it
  says the window holds up well.
*/
const SEASONAL_HOLDS_UP_PCT = 50;

/*
  Sanctioned editorial mapping from the snapshot month to the season
  phrase in the section title: a presentation constant, documented
  here, never tuned per snapshot. Meteorological seasons, with the
  phase by month position within the season (month 1 = January):
  12 "in early winter", 1 "in mid winter", 2 "in late winter",
  3 "in early spring", 4 "in mid spring", 5 "in late spring",
  6 "in early summer", 7 "in mid summer", 8 "in late summer",
  9 "in early fall", 10 "in mid fall", 11 "in late fall".
*/
const SEASON_PHRASE_BY_MONTH: Record<number, string> = {
  12: "in early winter",
  1: "in mid winter",
  2: "in late winter",
  3: "in early spring",
  4: "in mid spring",
  5: "in late spring",
  6: "in early summer",
  7: "in mid summer",
  8: "in late summer",
  9: "in early fall",
  10: "in mid fall",
  11: "in late fall",
};

export function GreenWindowCard() {
  const gw = snapshot.greenWindow;
  const band = gw.green.modalBand;
  const days = gw.green.days;
  const sharePct = gw.green.frequencyShare * 100;
  const narration = narrationFor("greenWindow");

  /* The statement's words form: zero-padded labels for the band's
     inclusive start and exclusive end (endHour + 1). The dashed
     formatBand range stays the sanctioned label form for the tooltips,
     aria labels and the red card; the headline uses words, per the
     product owner's decision. */
  const bandStartLabel = band ? hourLabel(band.startHour) : "";
  const bandEndLabel = band ? hourLabel(band.endHour + 1) : "";
  const daypart = band ? daypartFor(band.startHour) : "";

  /* Seasonal honesty line: the full band's day count derives from
     frequencyShare * days at build time; never a hardcoded count. */
  const bandDays = Math.round(gw.green.frequencyShare * days);
  const seasonalLine =
    gw.green.frequencyShare * 100 < SEASONAL_HOLDS_UP_PCT
      ? `The window is thin this season: the full band opened on ${bandDays} of the last ${days} days.`
      : `The window holds up well: the full band opened on ${bandDays} of the last ${days} days.`;

  /* The season phrase in the section title derives from the snapshot's
     own freshness date (retrievedAt slice 0-10, the same source the
     snapshot-fresh sentence uses); never hardcoded to a season. */
  const seasonPhrase = SEASON_PHRASE_BY_MONTH[Number(snapshot.retrievedAt.slice(5, 7))];
  const priceP30 = gw.percentiles.priceP30;
  const renP70 = gw.percentiles.renP70;
  const threshold = `green rule: price at or below ${formatNumber(priceP30, 1)} EUR/MWh and renewable share at or above ${formatNumber(renP70, 1)}%`;

  /* Per-hour frequency over the trailing days, derived from the
     snapshot's qualifyingHours at build time. Never a hardcoded count. */
  const counts = Array.from({ length: 24 }, () => 0);
  for (const date of Object.keys(gw.green.qualifyingHours)) {
    for (const h of gw.green.qualifyingHours[date]) {
      if (h >= 0 && h < 24) counts[h] += 1;
    }
  }
  const inBand = (h: number) => band != null && h >= band.startHour && h <= band.endHour;
  const pctOf = (h: number) => (days > 0 ? formatNumber((counts[h] / days) * 100, 0) : "0");

  /* Tooltip notes and aria-labels: honest per-hour count sentences,
     including the zero-count case. */
  const notes = HOUR_LABELS.map(
    (_, h) =>
      `Met the green rule on ${counts[h]} of ${days} days (${pctOf(h)}%). ${
        inBand(h) ? "In the recurring window" : "Outside the recurring window"
      }`,
  );
  const ariaFor = (h: number) =>
    `${HOUR_LABELS[h]}: met the green rule on ${counts[h]} of ${days} days; ${
      inBand(h) ? "inside" : "outside"
    } the recurring window.`;
  const stripAria = `Per-hour frequency strip over the trailing ${days} days: how many days each hour met the green rule. The recurring window ${
    band ? formatBand(band) : "is empty"
  }, on ${formatNumber(sharePct, 0)}% of the trailing ${days} days.`;

  /* Bracket math: the range line spans exactly the modal band hours as
     a percentage of the 24 hour columns. */
  const bracketLeft = band ? (band.startHour / 24) * 100 : 0;
  const bracketWidth = band ? ((band.endHour - band.startHour + 1) / 24) * 100 : 0;
  const bracketCenter = bracketLeft + bracketWidth / 2;
  const labelLeft = `clamp(${LABEL_CLAMP}px, ${bracketCenter}%, calc(100% - ${LABEL_CLAMP}px))`;

  /* The three honest bar states; heights are a share of the plot row. */
  const barStyle = (h: number): React.CSSProperties => {
    if (counts[h] === 0 || days === 0) {
      return { height: ZERO_STUB_H, background: "var(--chart-track)" };
    }
    const height = `${(counts[h] / days) * 100}%`;
    if (inBand(h)) return { height, background: "var(--gg-green-band)" };
    return { height, background: "color-mix(in oklab, var(--gg-green-band) 45%, transparent)" };
  };

  return (
    /* The season phrase makes this title longer than the .gg-heading
       18ch scale cap, so this one heading uses the documented
       gg-heading-wide override: it spans the full card content width
       and stays on one line whenever that width is enough, wrapping
       naturally when it is not. */
    <FamilySection
      headingClassName="gg-heading-wide"
      title={
        <>
          The <span className="text-brand-accent">green window</span> {seasonPhrase}
        </>
      }
      description={`The recurring hours when Dutch power is both cheap and clean, computed from the trailing ${WINDOW_PARAMS.TRAILING_DAYS} days.`}
    >
      <p className="gg-statement">
        {band ? (
          <>
            Power goes green in {daypart}: most often between{" "}
            <span className="text-brand-accent">
              {bandStartLabel} and {bandEndLabel}
            </span>
            .
          </>
        ) : (
          <>No recurring green band in the last {days} days.</>
        )}
      </p>

      {/* the two criteria chips, both required; the AND badge is
          decorative (aria-hidden), the list label carries the
          conjunction for screen readers */}
      <ul
        role="list"
        aria-label={`Green rule, both criteria required: day-ahead price at or below ${formatNumber(priceP30, 1)} EUR/MWh AND renewable share of generation at or above ${formatNumber(renP70, 1)}%`}
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch"
      >
        <li className="flex-1 rounded-lg border border-border bg-background p-3">
          <p className="gg-label text-muted-foreground">Cheap</p>
          <p className="mt-1">
            day-ahead price at or below{" "}
            <span className="font-medium tabular-nums">{formatNumber(priceP30, 1)} EUR/MWh</span>
          </p>
          <p className="mt-1 gg-caption">
            cheaper than about {100 - WINDOW_PARAMS.GREEN_PRICE_PERCENTILE}% of hours in the trailing{" "}
            {WINDOW_PARAMS.TRAILING_DAYS} days
          </p>
        </li>
        <li aria-hidden="true" className="flex items-center justify-center">
          <span className="gg-label rounded-full border border-border px-2 py-0.5 text-muted-foreground">AND</span>
        </li>
        <li className="flex-1 rounded-lg border border-border bg-background p-3">
          <p className="gg-label text-muted-foreground">Clean</p>
          <p className="mt-1">
            renewable share of generation at or above{" "}
            <span className="font-medium tabular-nums">{formatNumber(renP70, 1)}%</span>
          </p>
          <p className="mt-1 gg-caption">
            more renewable than about {WINDOW_PARAMS.GREEN_RENEWABLE_PERCENTILE}% of hours in the trailing{" "}
            {WINDOW_PARAMS.TRAILING_DAYS} days
          </p>
        </li>
      </ul>

      {/* per-hour frequency strip on the shared ChartTooltip island */}
      <ChartTooltip labels={HOUR_LABELS} notes={notes}>
        <div className="mt-6">
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
            {/* half-height scale gridline with its micro label */}
            <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
            <span
              aria-hidden="true"
              className="gg-label absolute right-0 top-1/2 text-muted-foreground"
              style={{ transform: "translateY(-150%)", background: "var(--background)", padding: "0 2px" }}
            >
              green on half the days
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
                    className="absolute bottom-0 left-1/2 w-[70%] -translate-x-1/2 rounded-t-[2px]"
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
                style={{ left: `${bracketLeft}%`, width: `${bracketWidth}%`, background: "var(--gg-green-band)" }}
              >
                <span
                  className="absolute left-0 top-[-6px] h-[8px] w-[2px]"
                  style={{ background: "var(--gg-green-band)" }}
                />
                <span
                  className="absolute right-0 top-[-6px] h-[8px] w-[2px]"
                  style={{ background: "var(--gg-green-band)" }}
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
      </ChartTooltip>

      <p className="mt-2 gg-caption">
        Why these hours: on a dynamic tariff, shifting flexible use such as charging or dishwashing into the
        window costs less and runs on the grid's most renewable-heavy hours. {seasonalLine} Each bar counts how
        many of the trailing {days} days that hour met the green rule, counting any qualifying day, lone hours
        included.{" "}
        {band
          ? `The bracket marks the recurring window: the contiguous band shape most frequent in the trailing days, recurring on ${formatNumber(sharePct, 0)}% of days. `
          : ""}
        Snapshot-fresh as of {snapshot.retrievedAt.slice(0, 10)}. All times Europe/Amsterdam.
      </p>
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}
