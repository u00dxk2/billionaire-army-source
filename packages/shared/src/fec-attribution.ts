/**
 * Is a stored FEC record PROVABLY not this person's?
 *
 * B-037: `fec.ts` queries OpenFEC with `contributor_name` and nothing else — no state, employer or
 * occupation — so every contribution by anyone sharing the name is attributed to the billionaire.
 * The stored fact keeps only aggregates (`summarizeContributions`), so there is no corroborating
 * field to check and "hide anything unverified" would hide all 877 profiles.
 *
 * `dateRange` is the one surviving field that can FALSIFY. Against `birth_year` it yields a
 * positive claim of mis-attribution rather than an absence of corroboration: a contribution dated
 * before a person could legally make one is not weak evidence, it is impossible.
 *
 * CEILING, and it must travel with every number this produces: a same-name donor of a similar age
 * is invisible here. Hits are a FLOOR on B-037's blast radius, never its size. The real fix is the
 * disambiguation rule on B-037's clock; this is the interim that keeps a provably-false claim off
 * the page today.
 */

/** Federal contributions below this age are not a thing a real donor record shows. */
export const MIN_CONTRIBUTOR_AGE = 18;

/**
 * True when the record's earliest contribution predates the person's 18th year.
 *
 * Returns FALSE whenever it cannot tell — no birth year, unparsable range, or a birth year that is
 * itself junk. That direction is deliberate and it is the opposite of the usual drop-on-doubt rule:
 * this function's output HIDES a section, so a false positive erases a real person's real record.
 * Doubt therefore means "show it" here, and the residual risk is carried by B-037's real fix.
 *
 * The junk-birth-year guard is not hypothetical: 5 of the 16 hits on the FIRST prod run had birth
 * years of 2027, 2028, 2028 and 2000 against contributions in the 1980s-90s — future or impossible
 * years in `persons.birth_year` itself. Those are a DATA defect in the person row, not evidence
 * about the FEC match, and treating them as attribution hits would hide the wrong pages for the
 * wrong reason.
 *
 * NUMBER NOTE (2026-09-02): 16 was that first run, measured through a checker that had FORKED
 * this predicate and dropped the junk-year guard; `fd83f65` de-forked it on 08-31 and the live
 * count is 12. Kept as 16 here because the sentence is about that run. Do not quote it as current:
 * `npm run check:fec-dates` prints the live buckets, and 12 is a FLOOR on the blast radius, never
 * its size — a same-name donor of a SIMILAR AGE is invisible to this test.
 */
/**
 * Is this `persons.birth_year` a broken row rather than a usable year?
 *
 * TRUE for absent, non-finite, absurdly early (< 1850), or a year that makes the person a MINOR
 * TODAY — the last of which covers the future years AND the transposed ones (a stored 2021 for
 * George Joseph, really 1921, makes him 5; a 5-year-old is not an indexed billionaire whose
 * contributions we are adjudicating).
 *
 * EXPORTED BECAUSE B-039 NEEDS THE SAME RULE AND MUST NOT RE-DERIVE IT. This predicate lived
 * inline inside `isFecRecordImpossible` and a checker that re-implemented the surrounding rule
 * dropped it — reporting 16 withheld where the page withheld 13, and that 16 reached a commit
 * message, two reports and a primer (`fd83f65`). One function, every caller.
 */
export function isImplausibleBirthYear(
  birthYear: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (typeof birthYear !== "number" || !Number.isFinite(birthYear)) return true;
  const thisYear = now.getFullYear();
  return birthYear > thisYear - MIN_CONTRIBUTOR_AGE || birthYear < 1850;
}

export function isFecRecordImpossible(
  dateRange: string | null | undefined,
  birthYear: number | null | undefined,
  now: Date = new Date(),
): boolean {
  // A birth year that is absurdly early, or that makes this person a MINOR TODAY, is a broken row —
  // not an FEC verdict. Same constant, no new number: if they could not legally contribute today,
  // their birth year cannot prove anyone else could not.
  if (isImplausibleBirthYear(birthYear, now)) return false;
  // Narrowed by the guard above; the cast is the only thing a boolean predicate cannot express.
  const usableBirthYear = birthYear as number;
  const thisYear = now.getFullYear();
  if (typeof dateRange !== "string" || !dateRange.includes(" to ")) return false;
  const earliest = Number(dateRange.split(" to ")[0]?.slice(0, 4));
  if (!Number.isFinite(earliest) || earliest < 1850 || earliest > thisYear) return false;
  return earliest < usableBirthYear + MIN_CONTRIBUTOR_AGE;
}

/**
 * Turn a TWO-DIGIT year from a scraped source into a real one.
 *
 * Lives beside `isImplausibleBirthYear` because it is the same subject and it DELEGATES to it —
 * there is no second rule about what counts as a broken year, only one predicate asked twice.
 *
 * The naive window (`<= 30` means the 2000s) is backwards for an index of billionaires: RTB gives
 * "06/28/28" for a man born in 1928, and the window stored 2028. Measured 2026-09-04, every
 * implausible `persons.birth_year` in the index was exactly this — five people, five century
 * shifts, all from the RTB seeder (B-039). So after windowing, a year that makes the person a
 * MINOR TODAY is corrected back a century, which is the only reading available: a person too young
 * to contribute to a federal campaign is not an indexed billionaire.
 *
 * Callers pass ONLY a genuinely 2-digit value. A source that states its century is not guessing and
 * must not be second-guessed — that check belongs at the call site, where the raw string is.
 */
export function windowTwoDigitYear(twoDigit: number, now: Date = new Date()): number {
  const windowed = twoDigit + (twoDigit > 30 ? 1900 : 2000);
  return isImplausibleBirthYear(windowed, now) ? windowed - 100 : windowed;
}

/**
 * Strip a political-donation FIGURE out of a card's published PROSE.
 *
 * B-037, SEVENTH surface — and the one the six before it left standing. The 2026-09-02 pass fixed
 * the CHIP in both directions (curator write path + serve-time rebuild) and never touched the
 * SENTENCE beside it. B-030 did both legs for the foundation figure; B-037 did one. So a card
 * published before the curator fix keeps asserting, in GPT-authored prose, the exact number the
 * chip beside it and the profile behind it both refuse to show.
 *
 * MEASURED ON PROD 2026-09-10, the served 40: of 26 cards whose prose states a political figure,
 * exactly ONE has a withheld chip — `ac844ce9` (Herbert Wertheim, published 2026-08-24, nine days
 * before the curator fix): `contextData.political` is `null` while the summary reads "available
 * records list $1.8 million in political donations". His stored `birth_year` is 2000 against a
 * 1992 contribution, which is what withholds the record.
 *
 * WHY IT IS THE WORST SHAPE THIS FEED HAS. R-070 exists because a receipt has to survive the
 * click. Here the card makes a claim about a named living person's politics and the profile it
 * links to has deliberately withheld that same claim — so following the receipt does not merely
 * fail to confirm it, it silently contradicts it. On a defamation-adjacent surface that is the
 * opposite of the moment the feed exists to deliver.
 *
 * WHAT THIS IS AND IS NOT. It removes OUR OWN reproduction of OUR OWN chip string: the curator
 * hands Pass A `"${formatCurrency(total)} in political donations"` as context and the model writes
 * it back out in words, so the figure was never quoted from the source article. Nothing is
 * rewritten and no stored row changes — same serve-time posture as the chip strip and the B-030
 * prose repair, reversible by reverting one call.
 *
 * DELIBERATELY NARROW, and gated at the call site by the SAME `isFecRecordImpossible` decision the
 * profile uses — this function never re-derives who is withheld, it only edits text once told.
 * It matches the generated family (`$1.8 million` / `$1.8M` `in political donations`) and nothing
 * else: a net worth, a purchase price, a grant, or charitable-giving prose is untouched.
 *
 * CEILING, stated because it is a real cost: when the clause is welded into a sentence carrying
 * unrelated content (a long lead-in, or a second dollar figure), the WHOLE sentence goes. That
 * loses true prose. It is the deliberate direction — leaving an unsupported political figure
 * standing on a named living person is the worse error — and it is pinned as a test.
 */
const MONEY = String.raw`\$[\d,]+(?:\.\d+)?\s*(?:billion|million|thousand|[BMK])?`;

/**
 * Political spending, in both noun orders.
 *
 * MODIFIER-FIRST covers "political donations", "political campaign contributions", "federal
 * political giving". RECIPIENT-LAST covers "donations to political campaigns" — round 6 walked
 * through a modifier-first-only pattern with exactly that wording.
 */
const POLITICAL_SPEND = String.raw`(?:` +
  String.raw`\b(?:political|campaign|super\s?PAC|federal)\b(?:\s+[A-Za-z-]+){0,2}\s+\b(?:donations?|contributions?|giving|spending)\b` +
  String.raw`|\b(?:donations?|contributions?|giving|spending)\b(?:\s+[A-Za-z-]+){0,2}\s+to\s+(?:[A-Za-z-]+\s+){0,2}(?:political|campaigns?|candidates?|super\s?PACs?)\b` +
  String.raw`)`;

/**
 * Up to 120 characters that do NOT cross a sentence end.
 *
 * A plain `[^.]` cannot be used: the "." in "$1.8 million" would end the gap. Tempering keeps
 * decimals inside the window while stopping at a real sentence boundary, so a sentence about
 * politics followed by a SEPARATE sentence about charity is never one match.
 *
 * Sentence ends are MARKED FIRST (see `markSentenceEnds`) and the gap simply refuses to cross the
 * marker. Testing for the boundary inside this pattern does not work: the whole regex carries the
 * `i` flag, so a `[A-Z]` written here matches lowercase too and the gap stopped at "U.S. political"
 * anyway. That is not a defect the adversarial review found — it found the miss; the first fix for
 * it was WRONG and the regression test written alongside is what said so.
 */
const GAP = String.raw`[^\u0000]{0,120}`;

/**
 * Replace a real sentence end with a marker, case-SENSITIVELY.
 *
 * "period, whitespace, CAPITAL" is the boundary. "U.S. political" keeps its periods (no capital
 * follows) so a claim spanning an abbreviation is still one match; "well known. He gave" gets a
 * marker so a sentence about politics and a separate one about charity never join up.
 */
function markSentenceEnds(text: string): string {
  return text.replace(/([.!?])\s+(?=[A-Z])/g, "$1\u0000");
}

/**
 * A political-spending figure, in EITHER word order.
 *
 * DELIBERATELY LOOSE, and the cost asymmetry is what licenses it — this repo's own rule for how
 * loose a rule may be. A MISS publishes an unsupported political dollar figure about a named
 * living person on a defamation-adjacent surface. A FALSE POSITIVE costs one already-withheld
 * person's card its summary paragraph; the headline and chips remain. Those are not comparable,
 * so this errs toward withholding.
 *
 * Five adversarial rounds walked through four narrower versions: "$1.8 million in TOTAL political
 * donations" (an intervening modifier), "His political donations TOTAL $1.8 million" (reversed),
 * "political CAMPAIGN contributions" (the noun phrase is not adjacent), and "His political
 * donations, according to available federal records, total $1.8 million" (a 48-character
 * attribution phrase, past the old 40-character cap).
 *
 * TWO FALSE POSITIVES ARE ACCEPTED ON PURPOSE and pinned as tests: a sentence that MENTIONS
 * political donations without asserting a figure, while carrying an unrelated amount ("His
 * political donations are unknown, but he gave $50 million to charity"). Withholding that summary
 * costs a paragraph on a card that is already withheld; distinguishing it needs to parse which
 * amount the sentence attributes to what, which is exactly the analysis whose failures filled the
 * five rounds above. Note the gate only ever sees the ~12 withheld people, so the blast radius of
 * a false positive is bounded by that set, not by the feed.
 */
const POLITICAL_FIGURE_CLAUSE = new RegExp(
  `(?:${MONEY}${GAP}${POLITICAL_SPEND}|${POLITICAL_SPEND}${GAP}${MONEY})`,
  "i",
);

/**
 * THE WHOLE SUMMARY GOES, and arriving there took three adversarial rounds.
 *
 * Two designs were tried and both were rejected by review, for NINE distinct reproduced defects.
 * Splicing the clause out of its sentence: a thousands separator read as a clause boundary
 * (`$50,000` published as `$50`), only the first of several claims removed, a decimal read as a
 * sentence end, an abbreviation read as a clause boundary, a dangling verb before the period, an
 * empty fragment, and a retained qualifier re-attaching to the wrong figure — turning "gave $1.8
 * million in political donations, mostly to Republicans" into a CHARITABLE donation "mostly to
 * Republicans". Removing the whole SENTENCE instead fixed those and kept two of the same class: a
 * dependent FOLLOWING sentence ("Most of that money went to Republicans.") re-attaching to the
 * charitable figure above it, and `Sen.` / `i.e.` splitting spans because the shared abbreviation
 * list does not carry them.
 *
 * Every one of those defects came from trying to KEEP part of the prose. So this keeps none of it.
 * Nothing is spliced, nothing is re-joined, no sentence segmentation is involved: there is no
 * surface left on which an amount can be corrupted, an attribution manufactured, or a claim
 * leaked. The text is returned byte-identical or not at all.
 *
 * THIS MATCHES WHAT THE PROFILE ALREADY DOES, which is the argument that settles the trade. For
 * these people the profile withholds the ENTIRE Political Activity section — not a surgical edit
 * of it (`npm run check:fec-withheld`, 2026-09-10: 12 withheld persons, 12 of 12 pages clean).
 * One policy on both surfaces; a card cannot be more forthcoming than the profile behind it.
 *
 * THE COST, stated plainly: the card loses its summary paragraph and keeps its headline and chips.
 * Measured on prod 2026-09-10, that is ONE of the 40 served cards — `ac844ce9` (Herbert Wertheim,
 * published 2026-08-24, nine days before the curator-side fix), whose `contextData.political` is
 * already `null` while its summary still read "available records list $1.8 million in political
 * donations". His stored `birth_year` is 2000 against a 1992 contribution, which is what withholds
 * the record in the first place.
 *
 * WHY IT IS THE WORST SHAPE THIS FEED HAS, and why blunt beats clever here. R-070 exists because a
 * receipt has to survive the click. A card asserting a named living person's political spending
 * while the profile it links to has withheld that same claim does not merely fail to confirm it —
 * it silently contradicts it. On a defamation-adjacent surface, losing a paragraph is the cheap
 * side of that trade.
 *
 * The caller gates this on the SAME `isFecRecordImpossible` decision the profile uses; this
 * function never decides WHO is withheld, only what happens to the text once told.
 */
export function withholdPoliticalProse(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  // Matched against the MARKED copy; the ORIGINAL is what gets returned, byte for byte.
  return POLITICAL_FIGURE_CLAUSE.test(markSentenceEnds(text)) ? "" : text;
}
