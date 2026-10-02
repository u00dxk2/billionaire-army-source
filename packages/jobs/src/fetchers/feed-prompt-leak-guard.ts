// Write-time prompt-leak guard for curated feed cards (B-056, 2026-09-22).
//
// On 2026-09-22 card 1a1b49a6 published "records in the provided data list $2.4 million in
// political donations…" — the model citing its own prompt, on the front door. Nothing checked
// at write time: the only defence was `purge:meta-commentary -- analyze`, an after-the-fact scan
// whose list is kept deliberately NARROW because the purge DELETES on its answer, and which read
// 0 while the card was live.
//
// This guard reads the WRITE-TIME set through the one shared predicate (`hasWriteTimeLeak` —
// every feed pattern plus the profile patterns flagged `writeTimeSafe`, never a copy).
//
// WHY NOT THE WHOLE UNION, which is what shipped first: an adversarial review on 2026-09-22
// measured the unflagged profile patterns against realistic accountability cards and they drop
// real stories — "Meta fined $5 billion over the data provided to Cambridge Analytica", "No
// articles were available after the Post pulled the op-ed". The cost model behind the union was
// "one candidate does not publish today", and that was too kind: nothing records a leak drop, so
// such a story is re-selected and re-dropped every run until the 21-day ingest cap ages it out,
// burning one of Pass A's ~5 daily picks each time and never reaching a reader.
//
// Zero-LLM and deterministic. A leak is a property of the REWRITE, not of the article, so a drop
// here is never recorded as a cooldown (the same reason Pass C refusals are not — B-052 notes,
// rejected scope 1).
import { hasWriteTimeLeak } from "@ba/shared";

export interface LeakCheckCard {
  headline: string;
  summary: string;
}

/** Does this card's reader-visible text quote the curator's own inputs? */
export function cardQuotesItsInputs(card: LeakCheckCard): boolean {
  return hasWriteTimeLeak(card.headline) || hasWriteTimeLeak(card.summary);
}

/**
 * Positions (into `curated`, the array the publish loop walks) of every card that quotes the
 * curator's own inputs. Positions, NOT candidate indices: the publish loop and every other
 * drop set in feed-curator.ts are keyed by position in `curated`.
 */
export function promptLeakDrops(curated: readonly LeakCheckCard[]): Set<number> {
  const drops = new Set<number>();
  curated.forEach((card, idx) => {
    if (cardQuotesItsInputs(card)) drops.add(idx);
  });
  return drops;
}
