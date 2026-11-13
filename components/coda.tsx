import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { FamilySection } from "@/components/family-section";
import { AiInsight } from "@/components/ai-insight";
import { EMISSION_FACTORS, PRODUCTION_TYPES } from "@/grid/emission-factors";
import { formatBand } from "@/grid/green-window";

/*
  Coda, "The extremes": the dirtiest versus cleanest hour on record side by
  side, then the stat row of records, each with timestamp and production
  mix. Humor lives in the framing only; every figure is a snapshot field.
*/

function MixBar({ mix }: { mix: Record<string, number | null> | undefined }) {
  if (!mix) return null;
  const entries = PRODUCTION_TYPES.map((t) => ({ t, v: mix[t] ?? 0 })).filter((e) => e.v > 0);
  const total = entries.reduce((a, e) => a + e.v, 0);
  if (total <= 0) return null;
  const colors = ["fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5", "fill-brand-accent", "fill-muted-foreground", "fill-primary", "fill-gg-flow-export"];
  return (
    <div className="mt-2">
      <div className="flex h-4 w-full overflow-hidden rounded" role="img" aria-label="Production mix at this hour">
        {entries.map((e, i) => (
          <div key={e.t} className={`h-full ${colors[i % colors.length]}`} style={{ width: `${(e.v / total) * 100}%` }} />
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {entries.map((e) => `${EMISSION_FACTORS[e.t]?.label ?? e.t} ${formatNumber(e.v, 0)} MW`).join(" · ")}
      </p>
    </div>
  );
}

function RecordStat({ recordKey, note }: { recordKey: string; note: string }) {
  const r = snapshot.records.find((x) => x.key === recordKey);
  if (!r) return null;
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{r.label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">
        {formatNumber(r.value, r.unit.includes("EUR") ? 2 : 0)}
        <span className="ml-1 text-sm font-semibold text-muted-foreground">{r.unit}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{r.localLabel}</p>
      <p className="mt-1 text-xs italic text-muted-foreground">{note}</p>
      <MixBar mix={r.mix} />
    </div>
  );
}

export function Coda() {
  const dirtiest = snapshot.records.find((r) => r.key === "dirtiestHour");
  const cleanest = snapshot.records.find((r) => r.key === "cleanestHour");
  const band = snapshot.greenWindow.green.modalBand;
  const narration = narrationFor("coda");

  return (
    <FamilySection
      title={
        <>
          The extremes — <span className="text-brand-accent">best and worst of the record</span>
        </>
      }
      description="The dirtiest and cleanest hours ever recorded on the Dutch grid, then the full record set."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gg-red-band/50 bg-gg-red-band-soft p-4">
          <p className="text-xs font-semibold tracking-widest text-gg-red-band uppercase">Dirtiest hour on record</p>
          <p className="mt-1 text-3xl font-black tabular-nums tracking-tight">
            {dirtiest ? formatNumber(dirtiest.value, 0) : "—"}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">g CO2-eq/kWh</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {dirtiest?.localLabel} — computed intensity, generation-mix basis (imports not attributed)
          </p>
          <MixBar mix={dirtiest?.mix} />
        </div>
        <div className="rounded-xl border border-gg-green-band/50 bg-gg-green-band-soft p-4">
          <p className="text-xs font-semibold tracking-widest text-gg-green-band uppercase">Cleanest hour on record</p>
          <p className="mt-1 text-3xl font-black tabular-nums tracking-tight">
            {cleanest ? formatNumber(cleanest.value, 0) : "—"}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">g CO2-eq/kWh</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {cleanest?.localLabel} — computed intensity, generation-mix basis (imports not attributed)
          </p>
          <MixBar mix={cleanest?.mix} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RecordStat recordKey="highestPrice" note="The market really said no." />
        <RecordStat recordKey="mostNegativePrice" note="They paid you to take it." />
        <RecordStat recordKey="highestResidualLoad" note="Everything left after renewables." />
        <RecordStat recordKey="biggestImport" note="The interconnectors did overtime." />
        <RecordStat recordKey="dunkelflauteDay" note="The day wind and sun both slept in." />
      </div>

      <p className="mt-6 max-w-[62ch] text-lg font-medium leading-snug">
        So, when is the greenest hour on the Dutch grid?{" "}
        {band ? (
          <>
            Usually <strong>{formatBand(band)}</strong> — cheap and renewable at once. The atlas above has every
            hour since {snapshot.composites.years[0]?.year} to back that up.
          </>
        ) : (
          <>The atlas above has every hour since {snapshot.composites.years[0]?.year}; the pattern is yours to read.</>
        )}
      </p>
      {narration && <AiInsight text={narration} />}
    </FamilySection>
  );
}
