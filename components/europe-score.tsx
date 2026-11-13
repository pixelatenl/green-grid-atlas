import { snapshot, formatNumber } from "@/data/snapshot";
import { formatDate } from "@/format-date";
import { FamilySection } from "@/components/family-section";

const COUNTRY_LABELS: Record<string, string> = {
  at: "Austria", ba: "Bosnia & Herz.", be: "Belgium", bg: "Bulgaria", ch: "Switzerland",
  cy: "Cyprus", cz: "Czechia", de: "Germany", dk: "Denmark", ee: "Estonia", es: "Spain",
  fi: "Finland", fr: "France", ge: "Georgia", gr: "Greece", hr: "Croatia", hu: "Hungary",
  ie: "Ireland", it: "Italy", lt: "Lithuania", lu: "Luxembourg", lv: "Latvia", md: "Moldova",
  me: "Montenegro", mk: "North Macedonia", nl: "Netherlands", no: "Norway", pl: "Poland",
  pt: "Portugal", ro: "Romania", rs: "Serbia", se: "Sweden", si: "Slovenia", sk: "Slovakia",
  ua: "Ukraine", uk: "United Kingdom", xk: "Kosovo",
};

/*
  European cleanliness score: ranked bar visual from the per-country score
  summaries in the snapshot. Score composition and basis are named on the
  card, NL highlighted, snapshot-fresh date shown.
*/
export function EuropeScore() {
  const countries = [...snapshot.scores.countries].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const max = countries.reduce((m, c) => Math.max(m, c.score ?? 0), 1);
  return (
    <FamilySection
      title="European cleanliness score"
      description={
        <>
          Ranked zones from energy-charts.{" "}
          <strong>Score composition:</strong> {snapshot.scores.composition}.{" "}
          <strong>Basis:</strong> {snapshot.scores.basis}. Snapshot-fresh as of{" "}
          {formatDate(snapshot.scores.retrievedAt)}.
        </>
      }
    >
      <ol className="mt-2 flex flex-col gap-1">
        {countries.map((c, rank) => {
          const isNL = c.country === snapshot.zone;
          return (
            <li key={c.country} className="flex items-center gap-2 text-sm">
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{rank + 1}</span>
              <span className={`w-36 shrink-0 truncate ${isNL ? "font-extrabold text-brand-accent" : ""}`}>
                {COUNTRY_LABELS[c.country] ?? c.country}
                {isNL ? " (NL)" : ""}
              </span>
              <span className="relative h-5 flex-1 rounded bg-chart-track/40">
                <span
                  className={`absolute inset-y-0 left-0 rounded ${isNL ? "bg-brand-accent" : "chart-gradient-1"}`}
                  style={{ width: `${((c.score ?? 0) / max) * 100}%` }}
                />
                <span className="absolute inset-y-0 left-2 flex items-center text-[10px] font-semibold tabular-nums text-foreground">
                  {c.score != null ? formatNumber(c.score, 1) : "—"}
                </span>
              </span>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {c.meanSharePct != null ? `${formatNumber(c.meanSharePct, 1)}% ren.` : "—"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Score 0–100 per the composition above; “ren.” is the trailing-365-day mean daily renewable share of
        load. The Netherlands refreshes daily; the other zones refresh weekly.
      </p>
    </FamilySection>
  );
}
