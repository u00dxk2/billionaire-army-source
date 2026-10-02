/**
 * Person identity matching — the shared, conservative duplicate detector used by
 * BOTH the de-dup tool (dedupe-persons.ts) and the seeder guards
 * (wikidata-seed.ts, rtb-seed.ts).
 *
 * One source of truth so the seeders' "is this a dup of an existing row?" guard
 * uses the EXACT same first+last-core-token match + father/son-safe MERGE/EXCLUDE
 * classification that the merge tool used. If the two ever drifted, the seeders
 * could re-create rows the merger would just collapse again (B-009).
 *
 * Matching is intentionally narrow: two names are a candidate pair only when
 * their first AND last "core" tokens match (suffixes + single-letter initials
 * dropped), and classify() then protects distinct fathers/sons (generational
 * suffix difference, or a birth-year gap) by returning EXCLUDE.
 */

// Suffix / connective tokens that are NOT part of a person's core identity.
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v", "and", "family", "&"]);

export function coreTokens(name: string): string[] {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    // drop suffix tokens AND single-letter initials ("H. Ross Perot Jr" -> [ross, perot])
    .filter((t) => t && !SUFFIX.has(t) && t.length > 1);
}

/**
 * Substitution nicknames — short forms that are NOT prefixes of the long name.
 *
 * ⚠ THIS TABLE EXISTS BECAUSE THE COMMENT THAT ARGUED AGAINST IT WAS MEASURABLY WRONG.
 * It read: "a table would be the wrong shape anyway, since it would invite bill/william and
 * bob/robert, NEITHER OF WHICH APPEARS IN THE INDEX." Scanned the live index 2026-08-23:
 * **Bill Ackman and William Ackman are both in it, same birth year 1966**, plus James/Jim
 * Kennedy (1947), James/Jim Coulter (1959), Richard B./Rick Cohen (1952) and Ted/Theodore
 * Leonsis. Five pairs the prefix rule cannot reach; four agree on birth year exactly. The
 * claim was true of the ten pairs measured on 2026-08-19 and was then generalised to the
 * index — a settled-sounding sentence in a guard nobody re-greps (the 2026-08-19 lesson,
 * reproduced here by the fix for that same bug).
 *
 * Kept deliberately small and conventional. It buys nothing to be clever: candidacy is not
 * a verdict, and every pair that arrives through this route still faces the EXACT
 * birth-year gate in `classify()`.
 */
const SUBSTITUTION_NICKNAMES: Record<string, readonly string[]> = {
  bill: ["william"],
  billy: ["william"],
  bob: ["robert"],
  bobby: ["robert"],
  chuck: ["charles"],
  dick: ["richard"],
  gene: ["eugene"],
  hank: ["henry"],
  harry: ["harold", "henry"],
  jack: ["john"],
  jim: ["james"],
  jimmy: ["james"],
  kate: ["katherine", "catherine"],
  larry: ["lawrence", "laurence"],
  liz: ["elizabeth"],
  meg: ["margaret"],
  peggy: ["margaret"],
  rick: ["richard"],
  ted: ["theodore", "edward"],
  tony: ["anthony"],
};

/**
 * Is one first name the SHORT FORM of the other? (B-033)
 *
 * TWO routes, and they are the same kind of evidence — a name that is weak on its own:
 *  1. Strict prefix, both >= 3 chars: josh/joshua, stan/stanley, ken/kenneth, rob/robert.
 *  2. Substitution nickname (see the table above): bill/william, jim/james, ted/theodore.
 *
 * DELIBERATELY NOT SUFFICIENT ON ITS OWN, and route 2 does not change that. `classify()`
 * additionally demands an EXACT birth-year match for any pair that matched only this way,
 * via `isShortFormPair`, which reads this same function — so widening here widens candidacy
 * and the birth-year gate together, by construction, rather than in two places that can
 * drift apart. Josh Harris (1964, Q6288962) and Joshua Harris (1960, Q6289885) are two
 * different men, this returns true for them, and the birth year is the whole of what keeps
 * them apart. Loosening the pairing without that gate merges two real people and destroys a
 * correct row.
 *
 * Known ceiling, stated because it cannot be enumerated: the table covers conventional
 * anglophone substitutions only. A nickname outside it (or a spelling variant like
 * Katharine/Catherine as SURNAMES) is still invisible here, and the honest detector for
 * those is not a longer table.
 */
export function isShortFormOf(a: string, b: string): boolean {
  if (a === b) return false;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  return (
    (SUBSTITUTION_NICKNAMES[a] ?? []).includes(b) ||
    (SUBSTITUTION_NICKNAMES[b] ?? []).includes(a)
  );
}

/**
 * A candidate pair shares its last core token, and its first core token either exactly or
 * as a short form. Needs >= 2 core tokens on each side (a lone surname is too weak).
 *
 * Being a candidate is NOT a merge verdict — `classify()` decides, and it is strictly
 * stricter for the short-form route.
 */
export function isCandidatePair(nameA: string, nameB: string): boolean {
  const a = coreTokens(nameA);
  const b = coreTokens(nameB);
  if (a.length < 2 || b.length < 2) return false;
  if (a[a.length - 1] !== b[b.length - 1]) return false;
  return a[0] === b[0] || isShortFormOf(a[0], b[0]);
}

/** Did this pair match ONLY via the short-form route? Those carry the extra birth-year gate. */
export function isShortFormPair(nameA: string, nameB: string): boolean {
  const a = coreTokens(nameA);
  const b = coreTokens(nameB);
  if (a.length < 2 || b.length < 2) return false;
  return a[0] !== b[0] && isShortFormOf(a[0], b[0]);
}

// ── Classification (MERGE = same person, EXCLUDE = distinct, e.g. father/son) ──
const SUF_LVL: Record<string, number> = { "": 0, sr: 1, jr: 2, ii: 2, iii: 3, iv: 4, v: 5 };
function genLevel(name: string): number {
  const m = name.toLowerCase().match(/\b(sr|jr|ii|iii|iv|v)\b/);
  return m ? SUF_LVL[m[1]] : 0;
}
// Pair signature for explicit overrides — sorted lowercased names joined by |.
export function sig(a: string, b: string): string {
  return [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join("|");
}
// Verified by web search (birth years / identity):
export const FORCE_MERGE = new Set([sig("Victoria Mars", "Victoria B. Mars")]); // one person; 1965 is a bad birth year
export const FORCE_EXCLUDE = new Set([sig("John MacMillan", "John H. MacMillan IV IV")]); // unconfirmed; protect distinct Cargill heirs

export interface Matchable {
  name: string;
  birthYear: number | null;
}

export function classify(a: Matchable, b: Matchable): "MERGE" | "EXCLUDE" {
  const s = sig(a.name, b.name);
  if (FORCE_MERGE.has(s)) return "MERGE";
  if (FORCE_EXCLUDE.has(s)) return "EXCLUDE";
  const la = genLevel(a.name), lb = genLevel(b.name);
  const gap = a.birthYear != null && b.birthYear != null ? Math.abs(a.birthYear - b.birthYear) : null;
  const genDiff = la !== lb && (la >= 2 || lb >= 2) && Math.abs(la - lb) >= 1 && !((la === 0 && lb < 2) || (lb === 0 && la < 2));
  if (genDiff && (gap === null || gap >= 5)) return "EXCLUDE";
  if (gap !== null && gap >= 8) return "EXCLUDE";
  // B-033: a pair that matched only by SHORT FORM must agree on birth year EXACTLY. The names
  // alone carry no evidence these are one person — "Josh"/"Joshua" is equally consistent with
  // two men — so the birth year is the whole of the evidence and a missing one is not a weak
  // yes, it is no evidence at all. Ambiguous or conflicting => EXCLUDE, which routes the pair
  // to human review in the analyzer rather than into the merge path.
  if (isShortFormPair(a.name, b.name) && (gap === null || gap !== 0)) return "EXCLUDE";
  return "MERGE";
}

/**
 * Seeder guard: does `candidate` already exist in `existing` as the SAME person?
 * Returns the first existing row that is a candidate pair AND classifies as a
 * MERGE (so distinct fathers/sons are NOT matched — they classify EXCLUDE and a
 * legitimately-new person is still inserted). Returns null when no dup is found.
 *
 * Skipping the insert is non-destructive (we just decline to add a row), which
 * is why this is preferred over re-running the destructive merge post-seed.
 */
export function findMergeDuplicate<T extends Matchable>(
  candidate: Matchable,
  existing: T[],
): T | null {
  for (const e of existing) {
    if (!isCandidatePair(candidate.name, e.name)) continue;
    if (classify(candidate, e) === "MERGE") return e;
  }
  return null;
}
