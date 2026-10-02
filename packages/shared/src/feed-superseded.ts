/**
 * B-031 — cards withheld from the served feed because a JUDGE adjudicated them as the
 * same event as a card the reader already meets higher up.
 *
 * WHY A LIST AND NOT A RULE. Every rule-shaped route to these three pairs is closed, and
 * each one was checked rather than assumed on 2026-09-05:
 *
 *   - EXTENDING THE DISPLAY COLLAPSE ON THE SCORE is forbidden and was measured wrong on
 *     2026-08-13: it would suppress two genuinely different Mark Cuban bootcamp cards at
 *     0.385 that the judge correctly calls DIFFERENT. Today's data says the same thing
 *     from the other side — the three confirmed SAME pairs score 0.313 / 0.308 / 0.286
 *     while measured DIFFERENT pairs in the same run score 0.250. The bands INTERLEAVE.
 *     No threshold separates them in either direction, so no threshold is the fix.
 *
 *   - THE sourceUrl SIGNAL cannot reach them: 0 exact URL collisions in the served 60,
 *     and the Ackman pair is two different outlets (Economic Times vs Hedgeweek).
 *
 *   - THE WRITE-TIME JUDGE ALREADY SAW ALL THREE AND CLEARED THEM. Read from the run
 *     logs, not inferred: `· rewrite-dup KEPT [0.313]`, `[0.286]` (run 33873629685,
 *     09-04) and `[0.308]` (run 33966272871, 09-05), each against exactly the right
 *     published card. Pass D was ENFORCING and its reach was correct. This is the
 *     KNOWN false-negative class feed-same-event-judge.ts documents at length — a
 *     MULTI-STAGE RUNNING STORY, where the prompt's "a later DEVELOPMENT is NOT the same
 *     event" rule fires. That rule is also what correctly separates the Haslam gifts, so
 *     the miss is the deliberate cost of the catch, and that file says in as many words:
 *     DO NOT prompt-tune at this example. This list is how a specific verdict gets
 *     applied WITHOUT touching that calibration.
 *
 * SO THIS IS ADJUDICATION, NOT A HEURISTIC — the unit is a decided pair, not a rule that
 * might catch more. B-031's own closeWhen asks for a sweep that "OUTPUTS A LIST FOR
 * APPROVAL, never an auto-delete"; this is that list, applied at render.
 *
 * IT HIDES, IT DOES NOT DELETE. The rows stay in the database untouched — no prod data
 * write, and `/feed/<id>` still serves a suppressed card to anyone holding its link, so a
 * share already sent keeps working. Reversal is deleting a line from this file.
 *
 * ponytail: a literal map, no lookup table in the DB, no migration. The known ceiling is
 * that it does not grow itself — each entry costs a commit, and it is only affordable
 * because the population is small and adjudicated. The upgrade path, if this ever needs
 * to scale, is a stored verdict written by a scheduled sweep, which is a prod data write
 * and therefore the owner's call, not a quiet refactor.
 *
 * WHICH CARD OF A PAIR SURVIVES. The one the punch ranking already put HIGHER — the card
 * the reader meets first. Note this is the OPPOSITE of `dedupe:feed`, which keeps the
 * EARLIEST card per cluster; feed-same-event-judge.ts's own docblock warns that the
 * earliest-rule is wrong for a running story, because the early card is provisional and
 * the late one is resolved, and says to pick the survivor by hand and say so. Said here.
 */

export type SupersededCard = {
  /** The card a reader meets higher up, which this one repeats. */
  duplicateOf: string;
  /** Jaccard at adjudication — recorded as evidence, never as the reason. */
  score: number;
  /** MT date the judge returned SAME for this pair. */
  adjudicated: string;
  /** What the two cards are, in a reader's terms. */
  note: string;
};

/**
 * Keyed by the id of the card that is WITHHELD. Three adjudicated pairs, two cards —
 * a97f9303 is the duplicate of two different MacKenzie Scott cards, so suppressing it
 * once resolves two of the three pairs.
 *
 * All three verdicts come from one `PROBE_JUDGE=1 npm run check:frontdoor` run on
 * 2026-09-05, which returned NOT CLEAR with 3 of 11 gray-band pairs called SAME.
 */
export const SUPERSEDED_CARDS: ReadonlyMap<string, SupersededCard> = new Map([
  [
    "1061c305-7566-45ab-87b1-c55563e20dc3",
    {
      duplicateOf: "d6e6b527-4fb2-4873-8522-7c35c2a07488",
      score: 0.313,
      adjudicated: "2026-09-05",
      note:
        "Ackman's $400M brain-research gift, carded twice 11 days apart — 'gives $400 million in " +
        "Pershing Square stock to fund brain research institute' (08-24, Hedgeweek) repeats as " +
        "'Bill Ackman and Neri Oxman donate $400 million to brain research…' (09-04). The survivor " +
        "is the later card: same gift.",
    },
  ],
  [
    "a97f9303-b99a-48db-b57e-397a3aa5367e",
    {
      duplicateOf: "5f5ad59f-1fda-42dc-a07a-583ca737cd9d",
      score: 0.308,
      adjudicated: "2026-09-05",
      note:
        "MacKenzie Scott's $26B lifetime giving total, carded three times. This card ('reported " +
        "giving reaches $26.2 billion over five years', 09-01) was judged SAME against BOTH " +
        "'$26 billion in giving draws renewed debate over progressive grants' (09-05, 0.308) and " +
        "'giving exceeds the reported combined donations of Musk, Page and Bezos' (09-04, 0.286). " +
        "One suppression closes both pairs; the two survivors are genuinely different framings of " +
        "the total and the judge called THEM apart.",
    },
  ],
]);

/** True when this card is withheld from the served feed as an adjudicated duplicate. */
export function isSupersededCard(id: string): boolean {
  return SUPERSEDED_CARDS.has(id);
}

/** The withheld ids, for a query that has to exclude them. */
export function supersededCardIds(): string[] {
  return [...SUPERSEDED_CARDS.keys()];
}
