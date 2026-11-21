import { snapshot, formatNumber } from "@/data/snapshot";
import { FamilySection } from "@/components/family-section";
import { RISK_PARAMS, type RiskIndicator } from "@/grid/risk";
import { formatDate } from "@/format-date";

/*
  The five derived risk indicators, chip pattern, honest framing: these are
  indicators computed from open data, not a grid-security assessment. Each
  chip carries a plain meaning sentence whose level thresholds derive from
  RISK_PARAMS in src/grid/risk.ts; the exact technical rules stay verbatim
  in the method drawer and stored in the snapshot. Two display labels are
  overridden per the product owner. The section states its snapshot
  freshness and its open-data, not-grid-security framing.
*/

const LEVEL_STYLE: Record<string, string> = {
  calm: "border-gg-risk-calm/60 text-gg-risk-calm",
  watch: "border-gg-risk-watch/60 text-gg-risk-watch",
  high: "border-gg-risk-high/70 text-gg-risk-high",
  unknown: "border-border text-muted-foreground",
};

/* Display labels: two of the five stored labels go plain, per the
   product owner; the stored snapshot labels stay raw in the snapshot
   (and keep feeding any other consumer), the chip renders these.
   Unknown keys fall back to the stored label. */
const DISPLAY_LABELS: Record<string, string> = {
  importCoverShare: "Import dependence",
  priceSpread: "Price spread",
};

/*
  Plain meaning sentences, one per indicator, per the product owner:
  what the number means for a reader, with the calm/watch/high level
  thresholds stated in words. Every threshold derives from RISK_PARAMS
  in src/grid/risk.ts (the same documented constants that define the
  levels and the method drawer rules); no number is hand-entered. The
  technical rules stay verbatim in the method drawer and stored in the
  snapshot; these sentences are the card-level plain language, the same
  precedent as the green and red chip support lines. Unknown keys fall
  back to the stored rule text, never a guessed sentence.
*/
const PLAIN_SENTENCES: Record<string, string> = {
  negativePriceShare: `How many hours in the last ${RISK_PARAMS.DAYS_30} days had a negative day-ahead price, so the market paid buyers to take the power. Watch from ${(RISK_PARAMS.NEGATIVE_PRICE_SHARE.watch * 100).toFixed(0)}%, high from ${(RISK_PARAMS.NEGATIVE_PRICE_SHARE.high * 100).toFixed(0)}%.`,
  redHoursShare: `How many hours in the last ${RISK_PARAMS.DAYS_30} days were red hours, the priciest and least renewable ones from the card above. Watch from ${(RISK_PARAMS.RED_HOURS_SHARE.watch * 100).toFixed(0)}%, high from ${(RISK_PARAMS.RED_HOURS_SHARE.high * 100).toFixed(0)}%.`,
  importCoverShare: `How much of the electricity the Netherlands used was imported over the borders, measured over the last ${RISK_PARAMS.DAYS_30} days. Watch from ${(RISK_PARAMS.IMPORT_COVER_SHARE.watch * 100).toFixed(0)}%, high from ${(RISK_PARAMS.IMPORT_COVER_SHARE.high * 100).toFixed(0)}%.`,
  priceSpread: `How wide the gap was between a typically expensive hour and a typically cheap one on the day-ahead market, over the last ${RISK_PARAMS.DAYS_30} days. Watch from ${RISK_PARAMS.PRICE_SPREAD_EUR.watch} EUR/MWh, high from ${RISK_PARAMS.PRICE_SPREAD_EUR.high} EUR/MWh.`,
  dunkelflauteRun: `The longest stretch of hours in the last ${RISK_PARAMS.DAYS_90} days when wind and distribution-connected renewables together covered less than ${RISK_PARAMS.DUNKELFAUTE_LOAD_SHARE}% of what the Netherlands used. Watch from ${RISK_PARAMS.DUNKELFAUTE_RUN_HOURS.watch} hours, high from ${RISK_PARAMS.DUNKELFAUTE_RUN_HOURS.high} hours.`,
};

function Chip({ indicator }: { indicator: RiskIndicator }) {
  const valueText =
    indicator.value == null
      ? "n/a"
      : indicator.unit.startsWith("share")
        ? `${formatNumber(indicator.value * 100, 1)}%`
        : `${formatNumber(indicator.value, indicator.unit === "EUR/MWh" ? 1 : 0)} ${indicator.unit}`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold tracking-tight">{DISPLAY_LABELS[indicator.key] ?? indicator.label}</p>
        <span
          className={`rounded-full border px-2 py-0.5 gg-label ${LEVEL_STYLE[indicator.level] ?? LEVEL_STYLE.unknown}`}
        >
          {indicator.level}
        </span>
      </div>
      <p className="text-2xl font-extrabold tabular-nums tracking-tight">{valueText}</p>
      <p className="gg-caption">{PLAIN_SENTENCES[indicator.key] ?? indicator.rule}</p>
    </div>
  );
}

export function RiskIndicators() {
  const indicators = snapshot.risk.indicators;
  return (
    <FamilySection
      headingClassName="gg-heading-wide"
      title="When the grid strains"
      description={`${indicators.length} market signals that say when the Dutch grid is under pressure. These are indicators from open data, not a grid-security assessment.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {indicators.map((i) => (
          <Chip key={i.key} indicator={i} />
        ))}
      </div>
      <p className="mt-3 gg-caption">
        The exact rules and threshold definitions are in the method drawer. Snapshot-fresh as of{" "}
        {formatDate(snapshot.retrievedAt)}. All times Europe/Amsterdam.
      </p>
    </FamilySection>
  );
}
