import { Sparkles } from "lucide-react";

/**
 * The "AI insight (Experimental)" block beneath a narrated visual. A
 * deterministic template: the narration was generated at snapshot time
 * from the visual's own aggregates, signature-gated, and validated against
 * its figures, so it is inserted verbatim and never modified here. No
 * narration, no block (fail-soft hide).
 */
export function AiInsight({ text }: { text: string }) {
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-xl bg-background p-4">
      <p className="flex flex-wrap items-center gap-1.5 text-xl font-extrabold leading-tight tracking-tight text-primary sm:text-2xl">
        <Sparkles aria-hidden="true" className="size-5 shrink-0" />
        AI insight
        <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-sm font-semibold tracking-wide text-brand-accent uppercase">
          Experimental
        </span>
      </p>
      <p className="text-base text-muted-foreground sm:text-lg">{text}</p>
    </div>
  );
}
