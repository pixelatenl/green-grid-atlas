import { formatDate } from "@/format-date";

/**
 * The family hero pattern: a kicker line, the question-shaped display
 * title, an optional deck, and the data-received line rendered from the
 * retrievedAt value with the family en-GB formatter. The kicker, title
 * and deck are nodes so the product owns every word and every accent
 * span inside them; accent spans use the family brand token
 * (text-brand-accent). Every figure in the copy is computed from the
 * product's data at render time — never a hardcoded literal.
 */
export function FamilyHero({
  kicker,
  title,
  deck,
  retrievedAt,
}: {
  /** Kicker line above the title, uppercase in the primary token. */
  kicker: React.ReactNode;
  /**
   * The question, as the display heading: fluid clamp sizing, the
   * heaviest weight, capitals, squeezed leading and tight tracking.
   * An em-based max-width keeps the shape at every width; the line
   * breaks by natural wrapping, never a hard <br>.
   */
  title: React.ReactNode;
  /** Optional deck paragraph under the title. */
  deck?: React.ReactNode;
  /** ISO date of the data snapshot the page renders. */
  retrievedAt: string;
}) {
  return (
    <div>
      <p className="mb-3 text-sm font-medium tracking-wide text-primary uppercase">
        {kicker}
      </p>
      <h1 className="max-w-[11em] text-[clamp(2.7rem,1.58rem+4.61vw,6rem)] font-black uppercase leading-[0.95] tracking-[-0.055em]">
        {title}
      </h1>
      {deck && (
        <p className="mt-6 max-w-[62ch] text-xl text-muted-foreground">{deck}</p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Data received on {formatDate(retrievedAt)}.
      </p>
    </div>
  );
}
