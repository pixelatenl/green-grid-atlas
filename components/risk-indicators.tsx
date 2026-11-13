import { snapshot, formatNumber } from "@/data/snapshot";
import { FamilySection } from "@/components/family-section";
import type { RiskIndicator } from "@/grid/risk";

/*
  The five derived risk indicators, chip pattern, honest framing: these are
  indicators computed from open data — not a grid-security assessment. Each
  rule is rendered from the indicator's own rule text (stored in the
  snapshot, documented in the method drawer).
*/

const LEVEL_STYLE: Record<string, string> = {
  calm: "border-gg-risk-calm/60 text-gg-risk-calm",
  watch: "border-gg-risk-watch/60 text-gg-risk-watch",
  high: "border-gg-risk-high/70 text-gg-risk-high",
  unknown: "border-border text-muted-foreground",
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
        <p className="text-sm font-bold tracking-tight">{indicator.label}</p>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${LEVEL_STYLE[indicator.level] ?? LEVEL_STYLE.unknown}`}
        >
          {indicator.level}
        </span>
      </div>
      <p className="text-2xl font-extrabold tabular-nums tracking-tight">{valueText}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{indicator.rule}</p>
    </div>
  );
}

export function RiskIndicators() {
  const indicators = snapshot.risk.indicators;
  return (
    <FamilySection
      title="Risk indicators"
      description="Five derived indicators with their rules printed on each chip. Honest framing: these are indicators computed from open data, not a grid-security assessment."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {indicators.map((i) => (
          <Chip key={i.key} indicator={i} />
        ))}
      </div>
    </FamilySection>
  );
}
