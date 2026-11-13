import { FamilyHero } from "@/components/family-hero";
import { GreenWindowCard } from "@/components/green-window-card";
import { AtlasHeatmap } from "@/components/atlas-heatmap";
import { Chapters } from "@/components/chapters";
import { RedHoursCard } from "@/components/red-hours-card";
import { Flows } from "@/components/flows";
import { RiskIndicators } from "@/components/risk-indicators";
import { EuropeScore } from "@/components/europe-score";
import { Coda } from "@/components/coda";
import { FamilySection } from "@/components/family-section";
import { FAMILY } from "@/family";
import { snapshot, formatNumber } from "@/data/snapshot";
import { formatBand } from "@/grid/green-window";

/*
  The single page: story leads, atlas inside. Card order per the brief.
  Every figure is computed from the snapshot at render time; the only
  literals here are copy. Anti-dashboard rule: no section is titled after
  its chart type; every visual is introduced by what it means.
*/
export default function Home() {
  const gw = snapshot.greenWindow;
  const band = gw.green.modalBand;
  const days = snapshot.trailing.days.length;

  return (
    <div className="mx-auto max-w-[1536px] px-4 py-10 sm:px-6 sm:py-16">
      <section className="mb-12">
        <FamilyHero
          kicker="Dutch open data"
          title={
            <>
              When is the <span className="text-brand-accent">greenest hour</span> on the Dutch grid?
            </>
          }
          deck={
            <>
              {days} days of hourly grid data, from day-ahead prices to per-neighbor power flows.{" "}
              {band ? (
                <>
                  Right now the answer is usually <strong>{formatBand(band)}</strong> — on{" "}
                  {formatNumber(gw.green.frequencyShare * 100, 0)}% of the trailing {gw.green.days} days.
                </>
              ) : (
                <>The atlas below has the full pattern since {snapshot.composites.years[0]?.year}.</>
              )}{" "}
              Every figure is open data, embedded in this page at build time.
            </>
          }
          retrievedAt={snapshot.retrievedAt}
        />
      </section>

      <GreenWindowCard />

      <FamilySection
        title={`The atlas: every hour since ${snapshot.composites.years[0]?.year}`}
        description="Hour by day, what the Dutch grid cost, how renewable it was, and how carbon-heavy — switch layers, periods and the weather overlay. Green outlines mark the green window band, red outlines the red hours."
      >
        <AtlasHeatmap />
      </FamilySection>

      <Chapters />
      <RedHoursCard />
      <Flows />
      <RiskIndicators />
      <EuropeScore />
      <Coda />

      <FamilySection
        title="Embed the green window"
        description="A minimal widget page renders the NL green window and tomorrow's price shape from the same snapshot JSON."
      >
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          The widget lives at <code className="rounded bg-muted px-1">/widget</code> (noindex; its canonical URL is
          this page) and reads the same-origin snapshot at{" "}
          <code className="rounded bg-muted px-1">/data/snapshot.json</code>. Embed it with an iframe, e.g.{" "}
          <code className="rounded bg-muted px-1">
            &lt;iframe src="{FAMILY.siteUrl}/widget" width="420" height="260"&gt;&lt;/iframe&gt;
          </code>
          . Copy on the widget says snapshot-fresh daily — it is never live.
        </p>
      </FamilySection>
    </div>
  );
}
