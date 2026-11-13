/**
 * Family date formatter: the en-GB long-month convention used by the
 * data-received line of the hero pattern and any other timeline copy.
 * Accepts the ISO date string the product's data snapshot carries as
 * its retrievedAt value.
 */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(isoDate));
}
