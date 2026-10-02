/**
 * R-048 passed-over cooldown — the pure decision, so it can be tested without a DB.
 *
 * A story Pass A already refused should stop re-occupying a top-20 candidate slot.
 * Measured against live candidates 2026-08-07 before this was built: 13 of 20 slots
 * were held by prior refusals, six of them byte-identical headlines. Refused
 * candidates are never published, so nothing consumed them and GDELT re-served them
 * into the same slots the next day.
 *
 * This answers only "have we refused this story recently?" — it does NOT drop
 * anything. The caller deprioritizes, so on a thin day a cooled story can still
 * reach the selector rather than the feed going empty.
 *
 * ⚠ THAT LAST SENTENCE WAS FALSE AT THE SEND BOUNDARY UNTIL 2026-08-11 (B-029).
 * "Deprioritized, never dropped" held for the candidate LIST and failed at the
 * 20-slot send cap: cooled sorted above score, so on a day when the on-axis
 * material was mostly cooled, the window filled with fresh score-0 candidates and
 * the on-axis ones never reached the selector at all. Measured: the shortlist ran
 * 90-100% on-axis for nine days, then 5/19, 3/20, 1/19 once the cooled set
 * accumulated. See sendTier() below, which is the fix the owner approved.
 */
import { eventSignature, sameEvent, CROSS_RUN_EVENT_THRESHOLD } from "./feed-event-dedup";

/**
 * Matches at the INGEST threshold, not the looser display one, because the cost shape
 * here is ingest's: a false positive sidelines a real story for the whole cooldown.
 */
export const COOLDOWN_MATCH_THRESHOLD = CROSS_RUN_EVENT_THRESHOLD;

/**
 * One recorded refusal. `personId` is NULL when the refusal was person-BLIND (Pass A
 * declined the event itself, or Pass C dropped a card written from it) and set when it was
 * person-SCOPED (Pass B judged whether THIS billionaire was the subject).
 */
export type CooledRefusal = { title: string; personId: string | null };

/**
 * B-052 — the person leg, and it is what makes a VERIFIER refusal safe to record at all.
 *
 * A Pass A row still cools the event for everyone, because the same article arrives under
 * a different person across runs and that is the re-serve this exists to catch. A Pass B
 * row cools it for ONE person only: Pass B asks "is this billionaire the subject?" and
 * "is this about this billionaire's money?", and a candidate inherits its person from a
 * news fact, so the same article legitimately returns under a different person (this
 * repo's own attribution notes cite a MacKenzie-Scott story attached to Jeff Bezos).
 * A title-only cooldown would sink the CORRECTLY attributed version for the whole window
 * — that is the defect three separate adversarial rounds rejected on 2026-09-19.
 *
 * Deliberately no reason-string parsing: the SOURCE column decides the scope, so a
 * malformed verdict cannot change which persons a row cools (round 2 shipped
 * startsWith("TOPIC"), which accepts "TOPIC is relevant; ENTITY: wrong person").
 *
 * @param title      the candidate headline being considered
 * @param personId   the person this candidate is attached to
 * @param cooled     refusals recorded inside the cooldown window
 * @returns true if this candidate is a repeat of something already refused FOR IT
 */
export function isOnCooldown(title: string, personId: string, cooled: CooledRefusal[]): boolean {
  return cooldownKind(title, personId, cooled) !== "none";
}

/**
 * WHICH KIND of refusal this candidate repeats — the distinction the owner's 2026-09-22 ruling
 * turns on, because the two now sort differently (see sendTier).
 *
 *   "none"    nothing in the window matches
 *   "blind"   a Pass A row (person_id NULL) matches: the event was refused for everyone
 *   "person"  a row recorded against THIS person matches: a verifier refused this story for
 *             this billionaire
 *
 * `person` WINS when both match, because it is the stronger statement and the stronger sink —
 * reading "blind" there would quietly restore the old tier for exactly the story the ruling
 * is about.
 */
export type CooldownKind = "none" | "blind" | "person";

export function cooldownKind(title: string, personId: string, cooled: CooledRefusal[]): CooldownKind {
  if (cooled.length === 0) return "none"; // fail-open: no history, nothing cooled
  const sig = eventSignature(title);
  let blind = false;
  for (const r of cooled) {
    if (r.personId !== null && r.personId !== personId) continue;
    if (!sameEvent(sig, eventSignature(r.title), COOLDOWN_MATCH_THRESHOLD)) continue;
    if (r.personId === personId) return "person";
    blind = true;
  }
  return blind ? "blind" : "none";
}

/**
 * Pass A declined the event; person-blind.
 *
 * ⚠ NOT "spelled once" — this literal has FOUR homes that must agree, and three of them
 * cannot import this const: the column default in `packages/db/src/schema.ts`, the same
 * default in `packages/db/drizzle/0007_steep_thundra.sql`, and the `AND source = 'pass-a'`
 * filter in `scripts/read-passed-over-composition.mjs` that keeps R-048 branch (a)'s
 * denominator intact. Changing the value here changes nothing on its own. The one that
 * fails LOUDLY if it drifts is the composition script (it exits 2 UNREADABLE on an empty
 * population); the cooldown lookup would not notice at all, because it reads every source
 * by design.
 */
export const SOURCE_PASS_A = "pass-a";
/** A relevance verifier refused it FOR ONE PERSON. */
export const SOURCE_PASS_B = "pass-b";
/** The faithfulness verifier (Pass C) dropped a card written from it; person-blind, like Pass A. */
export const SOURCE_PASS_C = "pass-c";

/**
 * B-052 — which refusals become cooldown rows, kept pure so the index mapping is testable
 * without a database.
 *
 * ONLY Pass B relevance refusals. Pass C drops go through faithfulnessCooldownRows() below,
 * person-blind; the attribution guard is still not cooled at all.
 *
 * ⚠ THE INDEX MAPPING IS THE BUG TO WATCH. `rejected` holds indices into `curated`, and a
 * curated item names its candidate by `candidate_index` — reading `filtered[idx]` cools a
 * DIFFERENT, innocent story. Six tests passed a mutant doing exactly that on 2026-09-19,
 * because every fixture used an identity mapping. Any test here must reorder.
 *
 * WHAT THIS DOES NOT COVER, stated because the person-scoping claim above is easy to
 * over-read: Pass B's own reject list includes TOPIC classes that are properties of the
 * ARTICLE rather than of the person — a stock pick, an earnings/IPO item, a product launch,
 * a substance-free commencement speech. Recording those against ONE person leaves them
 * uncooled under the next person they arrive attached to. That direction is the safe one
 * (under-cooling never suppresses a correctly-attributed story) and the pre-rank's
 * NOISE_TERMS penalty already sinks most of that class, so it is a coverage limit to know
 * rather than a defect to fix: this closes same-article/same-person recurrences — the Earl
 * Woods class, refused on five consecutive runs — not article-scoped off-axis re-serves.
 */
export function refusedCooldownRows<C extends { article: { title: string }; personId: string }>(
  curated: readonly { candidate_index: number }[],
  filtered: readonly C[],
  rejected: Iterable<number>
): { title: string; source: string; personId: string }[] {
  const rows = [];
  for (const idx of rejected) {
    const candidate = filtered[curated[idx]?.candidate_index ?? -1];
    if (!candidate) continue; // an unresolvable index records nothing rather than guessing
    rows.push({
      title: candidate.article.title.slice(0, 300),
      source: SOURCE_PASS_B,
      personId: candidate.personId,
    });
  }
  return rows;
}

/**
 * R-048 — Pass C (faithfulness) drops become PERSON-BLIND cooldown rows.
 *
 * WHY THIS WAS LEFT OUT, and why that reason no longer holds at this scope. Pass C judges the
 * REWRITE, not the article, so the same story can be written faithfully tomorrow; and on
 * 2026-08-08 all five of that day's faithfulness drops were FALSE. Under the pre-B-029 sort,
 * where cooled outranked score, cooling them would have sidelined five true stories for two
 * weeks. It no longer can: a person-blind row moves an on-axis story from tier 0 to tier 1
 * only (sendTier), where it still beats EVERY off-axis candidate, and on a pool as thin as
 * this one (11 on-axis of 154 on 2026-09-29, against a 20-slot send cap) it is still sent.
 * The worst a false Pass C drop now costs is one step of order among on-axis stories.
 *
 * What it buys: the same refused article stops re-entering the selector at full rank. The
 * One Bead "Cummings Grant" story was rewritten by Pass A and dropped by Pass C on five
 * consecutive runs (2026-09-25..29), each one a spent pick and a spent judge call. This does
 * NOT drop it — on a thin day it is still sent, just behind every fresh on-axis story.
 *
 * Deliberately NOT person-scoped: the owner's 2026-09-22 ruling sinks a person-scoped refusal
 * below every off-axis candidate (tier 4), which would turn a false Pass C drop into a
 * two-week burial of that person's story. 3 of 19 Pass C drops in the 09-23..29 window read
 * as plausibly false from the source title alone.
 *
 * Same index mapping as refusedCooldownRows, and the same trap: `dropped` holds indices into
 * `curated`, never into `filtered`.
 */
export function faithfulnessCooldownRows<C extends { article: { title: string } }>(
  curated: readonly { candidate_index: number }[],
  filtered: readonly C[],
  dropped: Iterable<number>
): { title: string; source: string; personId: null }[] {
  const rows = [];
  for (const idx of dropped) {
    const candidate = filtered[curated[idx]?.candidate_index ?? -1];
    if (!candidate) continue;
    rows.push({ title: candidate.article.title.slice(0, 300), source: SOURCE_PASS_C, personId: null });
  }
  return rows;
}

/**
 * B-029 — the cooldown applied WITHIN the send window instead of ACROSS it.
 * The owner's ruling, 2026-08-11, verbatim: "a cooled candidate still sorts below every
 * fresh on-axis one but no longer loses its slot to a fresh score-0 candidate."
 *
 * That is exactly two comparisons, so it was exactly four tiers:
 *   0  fresh + on-axis         — untouched, still wins everything
 *   1  blind-cooled + on-axis  — the 08-11 change: now BEATS fresh off-axis material
 *   2  fresh + off-axis        — demoted below a cooled on-axis story
 *   3  blind-cooled + off-axis — unchanged
 *   4  person-scoped refusal   — AMENDMENT, the owner 2026-09-22
 *
 * THE AMENDMENT, and why it is a fifth tier rather than a tweak to tier 1. B-052 measured what
 * the 08-11 ruling does on a thin pool: on-axis supply ran 14-18 against a 20-slot send cap, so
 * every on-axis candidate was sent whatever its tier and the cooldown changed nothing. A story
 * Pass B refused on 09-20 and 09-21 was re-sent on 09-22, passed on its second roll, and
 * PUBLISHED — re-offering a refused story is a second draw against a stochastic judge, not just
 * a wasted call. The owner's answer: "a story a checker refused for the same person sinks below
 * off-topic stories for 14 days." So ONLY the person-scoped kind sinks; Pass A's person-blind
 * rows keep the tiers the 08-11 ruling gave them, and nothing is dropped — on a day with fewer
 * than 20 candidates in total, a tier-4 story is still sent.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, because each was ruled out explicitly:
 * it does not shorten the cooldown, does not loosen the pre-rank penalty, does not
 * widen the ingest cap, and does not shrink the sent set (R-048's own prescribed fix,
 * which was written for the regime where on-axis material sat at the TOP of the
 * shortlist and makes this one strictly worse). A refused story still loses to every
 * fresh on-axis story — it just stops losing to a story whose only merit is being new.
 *
 * Ordering note: the caller keeps credibilityTier as the PRIMARY sort key above this
 * (R-028), so a low-credibility domain still cannot jump a reputable one by being
 * on-axis. This tier slots in where the bare cooled flag used to sit.
 *
 * Takes the KIND, not a boolean: a boolean cannot express the amendment, and a caller passing
 * `true` for a person-scoped refusal would silently restore the old tier. Typecheck is what
 * makes that impossible rather than merely discouraged.
 *
 * @param kind   cooldownKind() for this candidate
 * @param score  accountabilityScore() for this candidate; on-axis is > 0
 */
export function sendTier(kind: CooldownKind, score: number): 0 | 1 | 2 | 3 | 4 {
  if (kind === "person") return 4;
  const onAxis = score > 0;
  if (onAxis) return kind === "blind" ? 1 : 0;
  return kind === "blind" ? 3 : 2;
}
