import type { CandidateKind } from "./feed-relevance-rank";

/**
 * Keep the curator's shortlist from arriving as a monoculture.
 *
 * THE DEFECT (R-048, measured 2026-09-07). Over the five curator runs 09-03..09-07 the
 * feed published 7 cards and every one was `philanthropy`. Every gate read green
 * throughout — on-axis supply 87 against a tripwire of 20, top-20 send 11/11 on-axis
 * against a 50% floor, Pass B rejecting 1 of 16 — because every one of those gates asks
 * whether a card is ON-AXIS and none asks what KIND it is. A week earlier the same read
 * showed 3 of 5 runs carrying controversy or politics.
 *
 * A feed of seven giving announcements has failed its reader whether or not each card is
 * individually correct. The display-side rule that money only counts as punch when it is
 * gated on tension cannot rescue it either: ranking can only order what selection hands
 * it, and selection handed it one kind.
 *
 * WHY A SOFT REORDER AND NOT A CAP. A hard per-run kind cap starves the shortlist on a
 * day when the news genuinely is all giving — it would send fewer candidates to Pass A
 * and could publish nothing, turning a variety problem into a supply problem. This
 * demotes instead: the (softCap+1)-th candidate of an already-represented kind moves
 * BEHIND the others and is never removed, so the window always fills. Same shape as the
 * two deprioritisations already in this pipeline (the passed-over cooldown and the
 * source-credibility downweight), both of which are deliberately "deprioritized, never
 * dropped" for exactly this reason.
 *
 * WHAT IT IS NOT. It does not touch the cooldown, does not change any threshold, and
 * cannot admit an OFF-AXIS story: it only reorders the list it is given, so a candidate
 * that was never going to reach the selector still does not. R-048's standing note that
 * retuning the pre-rank to fix a Pass A selection question is the wrong lever still
 * holds — the pre-rank's SCORE is untouched here, and its 11/11 and 12/12 on-axis sends
 * are what exonerate it.
 */

/** Default: allow this many of one kind before demoting the rest of that kind. */
export const DEFAULT_KIND_SOFT_CAP = 3;

/**
 * Stable soft-cap reorder that permutes ONLY the classified candidates, in place,
 * within the positions they already occupy.
 *
 * ⚠ THE SHAPE OF THIS IS LOAD-BEARING, and the obvious implementation is wrong.
 *
 * The first version appended surplus same-kind items to the END OF THE WHOLE LIST and
 * left unclassified items untouched where they sat — on the reasoning that an
 * unclassified candidate is one the vocabulary could not read, so penalising it would
 * turn a blind spot into a ranking decision. That reasoning is still right; the
 * implementation of it was not.
 *
 * A CURATOR_DRY_RUN against live candidates on 2026-09-07 measured what it actually
 * did: of 171 candidates, 77 classified (giving 17 · wealth 32 · power 28) and 94
 * unclassified. At a soft cap of 3 it kept 9 classified and demoted 68 of them BEHIND
 * all 94 unclassified — so the shortlist arrived **2/14 on-axis**, against 11/11 and
 * 12/12 on the scheduled runs. A change meant to improve WHICH on-axis stories reach
 * the selector had instead flushed on-axis stories out of its reach entirely. Every
 * unit test passed, because none of them had a realistic unclassified majority.
 *
 * So the reorder is now positional: it collects the indices currently held by
 * classified items, reorders that subsequence, and writes it back into those same
 * indices. Unclassified items never move, and — the property that matters — the
 * classified/unclassified composition of EVERY prefix is identical before and after,
 * so the on-axis fraction of the send window cannot change. Only WHICH on-axis
 * candidates fill the on-axis slots changes, which is the whole and only intent.
 *
 * Returns a NEW array; the input is not mutated.
 */
export function diversifyByKind<T>(
  items: T[],
  kindOf: (item: T) => CandidateKind | null,
  softCap: number = DEFAULT_KIND_SOFT_CAP
): T[] {
  if (softCap < 1 || items.length <= 1) return [...items];

  // The slots classified items currently occupy. These are the only positions this
  // function is allowed to touch.
  const slots: number[] = [];
  const classified: T[] = [];
  items.forEach((item, i) => {
    if (kindOf(item) !== null) {
      slots.push(i);
      classified.push(item);
    }
  });
  if (classified.length <= 1) return [...items];

  const seen = new Map<CandidateKind, number>();
  const kept: T[] = [];
  const demoted: T[] = [];
  for (const item of classified) {
    const k = kindOf(item) as CandidateKind;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    if (n < softCap) kept.push(item);
    else demoted.push(item);
  }

  const reordered = [...kept, ...demoted];
  const out = [...items];
  slots.forEach((slot, i) => {
    out[slot] = reordered[i];
  });
  return out;
}

/**
 * How many DISTINCT kinds appear in the first `window` items — the number the
 * reordering is trying to move, reported before and after so the effect is readable
 * rather than assumed.
 *
 * Counts kinds, not items, and ignores unclassified: "how many different sorts of story
 * does the selector get to choose between" is the question.
 */
export function distinctKindsInWindow<T>(
  items: T[],
  kindOf: (item: T) => CandidateKind | null,
  window: number
): number {
  const kinds = new Set<CandidateKind>();
  for (const item of items.slice(0, window)) {
    const k = kindOf(item);
    if (k !== null) kinds.add(k);
  }
  return kinds.size;
}
