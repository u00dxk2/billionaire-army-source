/**
 * ONE reader-facing name and ONE rounding for the giving score, for every surface that renders
 * it as a BADGE — the feed card, the deep-linked card a share lands on, and the share text.
 *
 * WHY THIS FILE EXISTS. R-041 already ruled that the feed card's badge says GIVING, not PBS,
 * because beside a political or controversy card a bare letter reads as the platform's overall
 * verdict and exonerates the card meant to indict; PBS labelling was deliberately KEPT on
 * profile / leaderboard / compare, which are score-comparison contexts with the methodology on
 * the same screen. That ruling reached the badge and the share text and stopped there. The
 * GPT-written summary went on saying it: measured on the served 40 on 2026-09-03, FIVE cards read
 * "has a PBS score of 91.60" three inches from a badge reading "GIVING A (92)" — one unexplained
 * acronym that collides with a broadcaster, one number at two roundings, on the same card, about
 * the same person (R-081).
 *
 * So the front door now has one vocabulary in one place: the badge, the share text, the prose
 * repair and the curator's own prompt all read these constants. Changing the score's public name
 * is a one-line change here rather than a four-file sweep that drifts on the fifth surface.
 *
 * SCOPE WIDENED 2026-09-04 BY DAVID'S RULING (board card resolving needs-decision 2af4444a):
 * "PBS" is retired from everything a visitor reads — the score is the giving score on every
 * surface — and the formal name "Public Benefit Score" survives on the methodology page (/about)
 * alone. R-041's carve-out for profile / leaderboard / compare is SUPERSEDED. Those surfaces name
 * the score inside English sentences rather than in a badge, so they cannot read these constants
 * and are enforced by a source sweep instead:
 * `packages/web/src/app/score-name-vocabulary.test.ts`. Both homes or neither — if you change the
 * public name here, that sweep's allowlist is the other place it has to land.
 *
 * THE ROUNDING IS THE BADGE'S. `contextData.pbs` is overridden at serve time with the LIVE score
 * (`packages/api/src/routes/feed.ts`), and the badge renders `Math.round()` of it. A number frozen
 * into published prose at curation time is therefore not merely more precise than the badge — it
 * is a SNAPSHOT, and it goes stale the next time `score:all` runs. Both halves are one bug.
 */

import { pbsGrade } from "./pbs";

/** The chip label on the feed card — what the badge calls the score. */
export const READER_FACING_SCORE_BADGE_LABEL = "GIVING";

/**
 * The score in NUMBER contexts ("a giving score of 92"). Kept distinct from the grade noun below
 * on purpose: one names the figure, one names the letter, and both start with the badge's own
 * word so a reader meets one idea rather than three.
 */
export const READER_FACING_SCORE_NOUN = "giving score";

/** The score in LETTER contexts ("giving grade A (92)") — what the share text already said. */
export const READER_FACING_GRADE_NOUN = "giving grade";

/** The badge's figure. Every reader-facing surface states the score at THIS precision. */
export function readerFacingScoreValue(pbs: number): number {
  return Math.round(pbs);
}

/**
 * The phrase the CURATOR is handed for a candidate, so the model can only echo back the badge's
 * own label and the badge's own figure. It is deliberately the whole phrase rather than a bare
 * number: the generator prompt and Pass C's context receipts both build from this one function,
 * so the faithfulness judge can never be auditing a number the generator was never shown.
 */
export function readerFacingScorePhrase(pbs: number | string | null | undefined): string | null {
  // `Number("")` is 0, not NaN — an empty context field would otherwise describe a person with no
  // score snapshot to the model as an F, which is a false claim about a named living person.
  if (typeof pbs === "string" && pbs.trim() === "") return null;
  const n = typeof pbs === "string" ? Number(pbs) : pbs;
  if (n == null || !Number.isFinite(n)) return null;
  return `${READER_FACING_GRADE_NOUN} ${pbsGrade(n).letter} (${readerFacingScoreValue(n)} of 100)`;
}

// The score's INTERNAL name — the one R-041 ruled off the front door.
const INTERNAL_NAME = "(?:PBS|Public Benefit)\\s+score";
// The score's READER-FACING name, which the curator is now steered toward. It goes stale on a
// rescore exactly like the internal one did, so the repair has to be able to refresh it too —
// otherwise the fix simply re-creates the two-figure contradiction under an approved label.
const OWN_NAME = "giving\\s+(?:score|grade)";
const NUM = "\\d{1,3}(?:\\.\\d+)?";
// "of" / "is" / "was" / "at" / "to", or a colon. "was" and "to" are here because a rewrite that
// says "her PBS score WAS 91.60 before the rescore" is the same defect in a different tense, and a
// connector list that misses it leaves the acronym on the card.
const CONNECTOR = "(\\s+(?:of|is|was|at|to)\\s+|\\s*[:=]\\s*)";
// A figure that is a dollar amount or a percentage is somebody ELSE'S number. `(?<![$\d.])`
// refuses "$91.60 PBS score" and a digit-continuation.
const NOT_MONEY = "(?<![$\\d.])";
// The figure must END where the match ends. Without `(?!\d)(?!\.\d)` the engine BACKTRACKS to a
// shorter number to satisfy the `%` lookahead — "91.60%" matched as "91" and the repair emitted
// "40.60%", which is worse than not firing. A trailing sentence period still passes, because the
// rejection is on ".<digit>", not on ".".
const NUM_END = "(?!\\d)(?!\\.\\d)(?!\\s*%)";

/**
 * Every shape of "our score, written into prose". Built fresh on every call rather than shared at
 * module scope: a `/g` regex carries `lastIndex`, and a shared one silently zeroes another
 * caller's parse.
 */
function scoreProsePatterns() {
  return {
    /** Detection ONLY, and DELIBERATELY BROADER THAN THE REPAIR — see `namesInternalScore`. */
    internalBigram: new RegExp(`\\b${INTERNAL_NAME}\\b`, "i"),
    // "PBS score of 91.60" / "PBS score is 91.60" / "PBS score was 91.60" / "PBS score: 91.60"
    internalNameFirst: new RegExp(`\\b${INTERNAL_NAME}\\b${CONNECTOR}(${NUM})${NUM_END}`, "gi"),
    // "91.60 PBS score"
    internalNumberFirst: new RegExp(`${NOT_MONEY}\\b(${NUM})\\s+${INTERNAL_NAME}\\b`, "gi"),
    // "giving grade A (92 of 100)" — the exact phrase the curator is now handed — and the shapes a
    // model writes it back as ("her giving grade is A (92 of 100)").
    ownLettered: new RegExp(
      `\\b(giving\\s+grade)(\\s+(?:is|of|was|at)\\s+|\\s+)([A-F][+-]?)\\s*\\((${NUM})(\\s+of\\s+100)?\\)`,
      "gi",
    ),
    // "giving score of 92" / "giving grade is 92"
    ownNameFirst: new RegExp(`\\b(${OWN_NAME})${CONNECTOR}(${NUM})${NUM_END}`, "gi"),
    // "92 giving score"
    ownNumberFirst: new RegExp(`${NOT_MONEY}\\b(${NUM})\\s+(${OWN_NAME})\\b`, "gi"),
  };
}

/**
 * Does this reader-facing text name the platform's score by its INTERNAL name?
 *
 * ANCHORED ON THE BIGRAM `<PBS|Public Benefit> score`, WITH NO NUMBER REQUIRED — and that is
 * deliberately BROADER than what `repairScoreProse` will touch. The asymmetry is the point: a
 * detector that under-fires hides a live defect, while a repairer that over-fires rewrites a
 * number that was correct. So this surfaces every shape, the repair changes only the ones it can
 * prove, and anything in the gap shows up as a gate finding rather than as a silent edit.
 *
 * A card about a donation to PBS NewsHour still passes: the broadcaster never appears as
 * "PBS score". Import this — never re-derive the predicate in a checker (AGENTS.md, B-037: a
 * checker that re-derived one reported 16 where the page withheld 13, and that 16 reached a commit
 * message, two reports and a primer).
 */
export function namesInternalScore(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  return scoreProsePatterns().internalBigram.test(text);
}

/**
 * Every figure this text states as OUR OWN reader-facing score — so a checker can ask whether the
 * prose and the badge agree, rather than only whether the prose used the wrong word.
 *
 * Exported because the gate must IMPORT this rather than re-derive it. Naming the score correctly
 * and then stating a stale figure beside the badge is the same defect as naming it "PBS"; a gate
 * that only reads the vocabulary would certify the exact numerical contradiction it exists to stop.
 */
export function readerFacingScoreFigures(text: string): number[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const p = scoreProsePatterns();
  const out: number[] = [];
  for (const m of text.matchAll(p.ownLettered)) out.push(Number(m[4]));
  for (const m of text.matchAll(p.ownNameFirst)) out.push(Number(m[3]));
  for (const m of text.matchAll(p.ownNumberFirst)) out.push(Number(m[1]));
  return out.filter((n) => Number.isFinite(n));
}

/**
 * Repair a card's own score where it was frozen into published prose: rename it to the badge's
 * vocabulary and re-state it at the badge's LIVE figure. Render-time, no prod data write — the
 * same display-side posture as the `pbs` override, the B-030 foundation chip and the political
 * chip rebuild that already sit on both feed routes.
 *
 * WHAT THIS IS AND IS NOT. It restates OUR OWN score inside OUR OWN sentence. The figure was
 * never quoted from the source article — no newspaper prints a Billionaire Army score — so this
 * is not a rewrite of anyone's claim. It changes no stored row and is reversible by reverting one
 * import.
 *
 * DELIBERATELY NARROW, and every "leaves it alone" case below is load-bearing:
 * - Only our own score's name ADJACENT to a figure is touched, so a card about the broadcaster, a
 *   dollar amount or a net worth is never rewritten; a `$` before or a `%` after the figure means
 *   it is somebody else's number and it is left exactly as written.
 * - The substitution preserves the connector the author wrote ("of" / "is" / "was" / ":") and the
 *   word order, so only the name and the digits change — the sentence's grammar is the author's.
 * - With no live score in hand it is a NO-OP. The badge renders nothing in that case either, and
 *   inventing a figure to agree with an absent badge would be the worse defect.
 * - **`taggedPersonCount` MUST BE EXACTLY 1.** The live score belongs to the card's PRIMARY tagged
 *   person, and a summary can name a different one. On a two-person card ("MacKenzie Scott has a
 *   PBS score of 91.60" attached to [Musk, Scott]) an unguarded repair would print Musk's score
 *   under Scott's name — and where his is 0, that is the false zero this repo forbids on every
 *   surface, manufactured by the repair itself. A badge showing the primary person's figure is a
 *   pre-existing ambiguity; writing that figure into a sentence that NAMES someone is a claim.
 *   Drop on doubt, exactly as `isPlausiblyOwnFoundation` does — the gate still surfaces the card.
 */
export function repairScoreProse(
  text: string,
  livePbs: number | string | null | undefined,
  taggedPersonCount: number,
): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (taggedPersonCount !== 1) return text;

  // `Number("")` is 0, not NaN. An empty `contextData.pbs` must NEVER become "a giving score of
  // 0" in prose about a named living person — the false zero this repo forbids on every surface.
  if (typeof livePbs === "string" && livePbs.trim() === "") return text;
  const live = typeof livePbs === "string" ? Number(livePbs) : livePbs;
  if (live == null || !Number.isFinite(live)) return text;

  const value = String(readerFacingScoreValue(live));
  const letter = pbsGrade(live).letter;
  const p = scoreProsePatterns();

  return text
    .replace(p.internalNameFirst, (_w, connector: string) => `${READER_FACING_SCORE_NOUN}${connector}${value}`)
    .replace(p.internalNumberFirst, () => `${value} ${READER_FACING_SCORE_NOUN}`)
    // Our own vocabulary, refreshed to the live figure. Runs AFTER the internal patterns so a
    // sentence just renamed above is left idempotent rather than rewritten twice.
    .replace(
      p.ownLettered,
      (_w, noun: string, connector: string, _oldLetter: string, _oldNum: string, ofHundred: string) =>
        `${noun}${connector}${letter} (${value}${ofHundred ?? ""})`,
    )
    .replace(p.ownNameFirst, (_w, noun: string, connector: string) => `${noun}${connector}${value}`)
    .replace(p.ownNumberFirst, (_w, _oldNum: string, noun: string) => `${value} ${noun}`);
}
