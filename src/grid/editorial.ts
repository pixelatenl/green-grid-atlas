/**
 * The shared editorial mappings of the green-window / red-hours card
 * pair, extracted verbatim from the green window card so the red mirror
 * can never drift from its model: the daypart table, the
 * month-to-season table, the seasonal-tier threshold and the helpers
 * deriving the daypart phrase from a band start hour, the season phrase
 * from a snapshot month, and the band words from a band's start and end
 * hours. Presentation constants only, documented here, never tuned
 * per snapshot.
 */

/* Zero-padded hour labels; the band's exclusive end (endHour + 1) can
   be 24, rendered "24:00", the same label math formatBand uses. */
export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
export const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => hourLabel(h));

/* The band words ("00:00 and 07:00" form) from a band's start and end
   hours: inclusive start, exclusive end (endHour + 1). Card statements
   render their band in words, never through formatBand; the dashed
   formatBand range stays the sanctioned label form for tooltips and
   aria labels only. */
export function bandWords(startHour: number, endHour: number): string {
  return `${hourLabel(startHour)} and ${hourLabel(endHour + 1)}`;
}

/*
  Sanctioned editorial mapping from the band's start hour to the
  statement's daypart words: a presentation constant, documented here,
  never tuned per snapshot. Ranges are inclusive start to inclusive
  end: 0 to 4 "the early night", 5 to 8 "the early morning", 9 to 11
  "the morning", 12 to 16 "the afternoon", 17 to 19 "the evening",
  20 to 23 "the night".
*/
export const DAYPART_BY_START_HOUR: ReadonlyArray<readonly [maxHour: number, label: string]> = [
  [4, "the early night"],
  [8, "the early morning"],
  [11, "the morning"],
  [16, "the afternoon"],
  [19, "the evening"],
  [23, "the night"],
];
export function daypartFor(startHour: number): string {
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
export const SEASONAL_HOLDS_UP_PCT = 50;

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
export const SEASON_PHRASE_BY_MONTH: Record<number, string> = {
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
export function seasonPhraseForMonth(month: number): string {
  return SEASON_PHRASE_BY_MONTH[month];
}
