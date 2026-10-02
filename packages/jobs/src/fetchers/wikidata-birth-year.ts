/**
 * A Wikidata date of birth as a YEAR, or null when Wikidata does not state one.
 *
 * WHY THIS EXISTS (B-037 preview, 2026-09-26): Wikidata stores an imprecise date as a full
 * timestamp plus a PRECISION — Herbert Wertheim's P569 is `+2000-00-00T00:00:00Z` at precision 7,
 * which means "born in the 20th century". The seeder read it with SPARQL's `YEAR()`, which drops the
 * precision, and stored 2000. Three approved persons carry exactly that row. For Wertheim it is
 * not cosmetic: a born-2000 billionaire makes his 1992 FEC contribution "impossible", so the page
 * withholds records his own filings name his own company on (MIAMI FL · BRAIN POWER INC · C.E.O.).
 *
 * rtb-seed's two-digit window (B-039) was the other writer of century-shaped years; it cannot
 * cover this one, because 2000 is not implausible (age 26), so the FEC guard accepts it.
 *
 * Precision codes (Wikibase): 9 = year, 10 = month, 11 = day. Anything below 9 (decade 8,
 * century 7, millennium 6, …) states no year, so the answer is null — unknown, never a guess.
 * A missing precision is also null: this function is only as trusting as its input is explicit.
 */
export const WIKIDATA_YEAR_PRECISION = 9;

export function birthYearFromWikidata(
  timeValue: string | null | undefined,
  precision: string | number | null | undefined,
): number | null {
  if (typeof timeValue !== "string" || timeValue.length === 0) return null;
  const p = typeof precision === "number" ? precision : Number(precision);
  if (!Number.isInteger(p) || p < WIKIDATA_YEAR_PRECISION) return null;
  // SPARQL JSON returns xsd:dateTime as "1939-01-01T00:00:00Z"; the raw Wikibase form carries a
  // leading sign ("+1939-…"). Accept both, and refuse a BCE or unparseable year.
  const m = timeValue.match(/^\+?(\d{4})-/);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

/**
 * One person's birth year from EVERY best-rank P569 statement the query returned, in any order.
 * A person can carry several (a superseded date left at normal rank, two sources that disagree),
 * and the seeder's per-person dedupe used to keep whichever SPARQL row arrived first — so the
 * answer depended on row order. Now: usable years that AGREE give that year; years that DISAGREE
 * give null (unknown beats a coin flip for a field that decides whether a record is withheld);
 * a century-precision statement beside a precise one is simply not a usable year and drops out.
 */
export function resolveBirthYear(
  statements: Array<{ timeValue?: string | null; precision?: string | number | null }>,
): number | null {
  const years = new Set<number>();
  for (const s of statements) {
    const y = birthYearFromWikidata(s.timeValue, s.precision);
    if (y !== null) years.add(y);
  }
  return years.size === 1 ? [...years][0] : null;
}
