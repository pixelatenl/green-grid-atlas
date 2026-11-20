import { snapshot, formatNumber } from "@/data/snapshot";
import { narrationFor } from "@/data/narration";
import { AiInsight } from "@/components/ai-insight";
import { EMISSION_FACTORS, PRODUCTION_TYPES } from "@/grid/emission-factors";

/*
  Coda, "The extremes", in the family coda style: one composition. A
  rounded, full-width photo stage inside the page container (the fleet
  and justice coda pattern, not a full-bleed banner), with all editorial
  content bottom-anchored over a dark scrim: kicker chip, display h2
  headline carrying one brand-accent span, deck copy, the dirtiest and
  cleanest hour as two big-number figures with their mix bars, and the
  five-record stat row. Below the stage, on the normal background, the
  AI insight block.

  The photo is "white electic windmill" by Nicholas Doherty on Unsplash
  (Rampion Offshore Wind Farm, United Kingdom, Unsplash License),
  self-hosted at public/images/rampion-offshore-wind.jpg; no external URL
  is fetched at page load. Every figure renders from the snapshot at
  build time (snapshot.records); nothing is pasted. The stage stays
  fully server-rendered.
*/

const RECORD_NOTES: Record<string, string> = {
  highestPrice: "The market really said no.",
  mostNegativePrice: "They paid you to take it.",
  highestResidualLoad: "Everything left after renewables.",
  biggestImport: "The interconnectors did overtime.",
  dunkelflauteDay: "The day wind and sun both slept in.",
};

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
      <p className="mt-1 gg-caption">
        {entries.map((e) => `${EMISSION_FACTORS[e.t]?.label ?? e.t} ${formatNumber(e.v, 0)} MW`).join(" · ")}
      </p>
    </div>
  );
}

export function Coda() {
  const dirtiest = snapshot.records.find((r) => r.key === "dirtiestHour");
  const cleanest = snapshot.records.find((r) => r.key === "cleanestHour");
  const stats = ["highestPrice", "mostNegativePrice", "highestResidualLoad", "biggestImport", "dunkelflauteDay"]
    .map((k) => snapshot.records.find((r) => r.key === k))
    .filter((r): r is NonNullable<typeof r> => r != null);
  const narration = narrationFor("coda");

  return (
    <section className="mb-12">
      {/* photo stage: rounded, full container width, at least 68vh tall
          (440px minimum), growing if the stacked content needs more room */}
      <div
        className="coda-stage relative flex flex-col justify-end overflow-hidden rounded-xl"
        style={{ minHeight: "max(68vh, 440px)" }}
      >
        <img
          src="/images/rampion-offshore-wind.jpg"
          alt="Rows of offshore wind turbines standing in the sea under a clear blue sky at the Rampion Offshore Wind Farm, United Kingdom"
          width={2200}
          height={1426}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[55%_88%]"
        />
        {/* bottom-anchored dark scrim; text over it is white in both themes */}
        <div aria-hidden="true" className="coda-scrim absolute inset-0" />

        <div className="relative p-4 pb-9 sm:p-6 sm:pb-10">
          <p className="w-fit rounded-full border border-white/25 bg-black/40 px-2.5 py-1 gg-label text-white">
            The extremes
          </p>
          <h2 className="mt-3 max-w-[22ch] gg-statement">
            From <span className="tabular-nums text-brand-accent">{dirtiest ? formatNumber(dirtiest.value, 0) : "n/a"}</span>{" "}
            to <span className="tabular-nums">{cleanest ? formatNumber(cleanest.value, 0) : "n/a"}</span> g CO2-eq/kWh
          </h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-white">
            The dirtiest and cleanest hours ever recorded on the Dutch grid, then the full record set. Computed
            intensity, generation-mix basis (imports not attributed).
          </p>

          {/* the pair: dirtiest vs cleanest hour, big numbers over muted
              labels, band tones kept, mix bars retained */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-6">
            <div>
              <p className="gg-label text-gg-red-band">Dirtiest hour on record</p>
              <p className="mt-1 text-4xl font-black tabular-nums tracking-tight text-white sm:text-4xl">
                {dirtiest ? formatNumber(dirtiest.value, 0) : "n/a"}
                <span className="ml-1 text-sm font-semibold text-white/70">g CO2-eq/kWh</span>
              </p>
              <p className="mt-1 text-xs text-white/70">
                {dirtiest?.localLabel}: computed intensity, generation-mix basis (imports not attributed)
              </p>
              <MixBar mix={dirtiest?.mix} />
            </div>
            <div>
              <p className="gg-label text-gg-green-band">Cleanest hour on record</p>
              <p className="mt-1 text-4xl font-black tabular-nums tracking-tight text-white sm:text-4xl">
                {cleanest ? formatNumber(cleanest.value, 0) : "n/a"}
                <span className="ml-1 text-sm font-semibold text-white/70">g CO2-eq/kWh</span>
              </p>
              <p className="mt-1 text-xs text-white/70">
                {cleanest?.localLabel}: computed intensity, generation-mix basis (imports not attributed)
              </p>
              <MixBar mix={cleanest?.mix} />
            </div>
          </div>

          {/* the five-record stat row on the photo */}
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/15 pt-4 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((r) => (
              <div key={r.key}>
                <p className="gg-label text-white/70">{r.label}</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-white sm:text-3xl">
                  {formatNumber(r.value, r.unit.includes("EUR") ? 2 : 0)}
                  <span className="ml-1 text-xs font-semibold text-white/70">{r.unit}</span>
                </p>
                <p className="mt-1 gg-caption">{r.localLabel}</p>
                <p className="gg-caption italic">{RECORD_NOTES[r.key] ?? ""}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="coda-credit gg-caption absolute bottom-2 right-3">
          Photo by{" "}
          <a className="underline underline-offset-2 hover:text-white" href="https://unsplash.com/@nrdoherty">
            Nicholas Doherty
          </a>{" "}
          on{" "}
          <a
            className="underline underline-offset-2 hover:text-white"
            href="https://unsplash.com/photos/white-electic-windmill-pONBhDyOFoM"
          >
            Unsplash
          </a>
        </p>
      </div>

      {/* below the photo, on the normal background: the AI insight block */}
      {narration && <AiInsight text={narration} />}
    </section>
  );
}
