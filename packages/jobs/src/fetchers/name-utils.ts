/**
 * Shared name-matching helpers for article-relevance validation.
 *
 * Used by the GDELT and NewsAPI fetchers to (a) extract a person's last name
 * (handling "& family" and suffixes) and (b) skip false-positive matches on
 * very common surnames. Kept identical across both fetchers — extracted here so
 * the list and the parsing rule only live in one place.
 */

/**
 * The "& family" display suffix the RTB seed writes onto person names ("Clark Hunt & family").
 * It is not part of anyone's name. ONE copy: foundation-attribution.ts strips it with this too —
 * its own parser did not, so "family" became the surname and unrelated charities literally named
 * "Family Foundation" were attached to 59 people (2026-09-30).
 */
export const FAMILY_SUFFIX = /\s*&\s*family\s*$/i;

/**
 * The surname the 990 fetcher searches ProPublica for. Deliberately the OLD rule (last
 * space-separated token) with ONE change — the "& family" suffix removed — so no other person's
 * search moves (Codex review 2026-09-30: switching to extractLastName would also change the query
 * for "Jr."/"III" and trailing-space names, and a changed search can reach the self-heal DELETE of a
 * correct stored fact). Only the 59 "& family" persons the preview measured change.
 */
export function foundationSearchSurname(name: string): string {
  return name.replace(FAMILY_SUFFIX, "").split(" ").pop() || "";
}

/**
 * Extract last name from a full name, handling "& family" and suffixes.
 */
export function extractLastName(name: string): string {
  const cleaned = name
    .replace(FAMILY_SUFFIX, "")
    .replace(/\s+(Jr\.|Sr\.|III|IV|II)$/i, "")
    .trim();
  const parts = cleaned.split(" ");
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Surnames common enough that a bare last-name match in an article title is
 * likely a false positive — these require a stricter (full-name) match.
 */
export const COMMON_LAST_NAMES = new Set([
  "lee", "wang", "chen", "li", "zhang", "kim", "park",
  "johnson", "smith", "brown", "jones", "davis", "wilson",
  "moore", "taylor", "white", "harris", "martin", "jackson",
  "thompson", "garcia", "martinez", "robinson", "clark",
  "lewis", "young", "allen", "king", "wright", "scott",
  "green", "baker", "hall", "adams", "nelson", "liu",
  "wu", "yang", "lin", "sun",
]);
