/**
 * Near-duplicate-EVENT de-duplication for the feed curator (G2).
 *
 * The curator's per-person cap (max 2 articles per billionaire) does NOT collapse
 * a single news event that is covered across MANY people/outlets — e.g. one
 * commencement walkout surfaced 6 live feed cards (different attributed
 * billionaires, same underlying event), drowning the accountability signal.
 *
 * We build a content-word signature per headline and treat two articles as the
 * same event when their signatures overlap heavily (Jaccard >= THRESHOLD). The
 * curator keeps only the first (highest-recency) article per event cluster in the
 * candidate pool, so the selecting model never even sees the dogpile.
 *
 * Deterministic + dependency-free so it can be unit-tested without the API. The
 * person name is intentionally NOT stripped — keeping it boosts overlap across
 * cards about the same event attributed to different people, while a single
 * shared name word is far below the 0.5 threshold (two unrelated Musk stories
 * share only "musk" → not clustered).
 */

export const EVENT_JACCARD_THRESHOLD = 0.5;

/**
 * Threshold for the CROSS-RUN check (candidate article title vs. an ALREADY-PUBLISHED
 * card's headline). Lower than the intra-run threshold on purpose: intra-run compares
 * title-vs-title, but a published headline is a GPT *rewrite* of its source title, and
 * the rewrite's added words ("reportedly", "multibillion-dollar") dilute Jaccard overlap
 * against the raw title of the next day's article about the same event.
 *
 * Calibrated against the real thing (2026-07-14): all 1,493 live GDELT candidate titles
 * scored against every headline published in the prior 14 days. EVERY match from 0.364
 * up was a genuine same-event duplicate — the false-positive band is empty, so the
 * binding consideration is the true positives, not the noise. 0.40 catches every dupe
 * that actually shipped a visible repeat card (Buffett/Gates 0.727, Dell 0.700, Yass
 * 0.545, Coxe 0.438 — the tightest one, and the reason this is not 0.45). Negative
 * control: two DIFFERENT Gabe Newell events (Steam antitrust vs. an OpenAI donation)
 * stay separate even at 0.35.
 *
 * ponytail: word-overlap dedup, so a genuine FOLLOW-UP in a running story is
 * indistinguishable from a re-run — "Buffett RESUMES Gates donation" scores ~0.70
 * against the "pauses" card and would be suppressed for 14 days. Inherent to bag-of-
 * words at any threshold (it's true of the intra-run check today too). Upgrade path if
 * that bites: an LLM same-event-vs-new-development judge on the ~40 candidates that trip
 * this filter, which is cheap because it only runs on the collapsed set.
 */
export const CROSS_RUN_EVENT_THRESHOLD = 0.4;

/**
 * eventSignature + jaccardScore MOVED to @ba/shared (B-023, 2026-08-06) so the
 * display-time collapse in pickTopSlice() reads the same overlap function this
 * ingest guard does. Re-exported here so every existing import site is unchanged
 * — this file stays the curator's import surface, and the thresholds below stay
 * with it, because ingest and display have different false-positive costs.
 */
export { eventSignature, jaccardScore } from "@ba/shared";
import { eventSignature, jaccardScore } from "@ba/shared";

/** Two signatures are the same event when Jaccard overlap >= threshold. */
export function sameEvent(
  a: Set<string>,
  b: Set<string>,
  threshold = EVENT_JACCARD_THRESHOLD
): boolean {
  if (a.size === 0 || b.size === 0) return false;
  return jaccardScore(a, b) >= threshold;
}

export type FeedCard = {
  id: string;
  headline: string;
  sourceUrl: string | null;
  createdAt: Date;
  votes: number;
  comments: number;
};

export type EventCluster = { keep: FeedCard; drop: FeedCard[] };

/**
 * Group feed cards into same-event clusters, keeping the EARLIEST card per cluster
 * (cards must be passed oldest-first). Two signals collapse cards, checked in order:
 *   1. exact same sourceUrl — the same article, no matter how far the two GPT headline
 *      rewrites diverged. This catches the bag-of-words miss that sameEvent() cannot:
 *      "criticizes" vs "criticism" scores below CROSS_RUN_EVENT_THRESHOLD (R-036), yet
 *      it is literally one URL. Mirrors the live curator guard, which already drops any
 *      candidate whose URL was carded in the last 45 days (feed-curator.ts) — so the
 *      cleanup and the guard agree on same-URL just as they already agree on same-event.
 *   2. event signature — a DIFFERENT article about an already-clustered event.
 *
 * ponytail: same-URL is treated as same-event unconditionally (person-agnostic), which
 * matches the live guard's own person-agnostic URL check. If a single article ever needs
 * to keep two distinct per-person cards, gate this on (sourceUrl + attached personId) —
 * but the guard would suppress that second card at ingest today anyway.
 */
/**
 * Collapse clusters that something ELSE decided are the same event — today the B-022 LLM
 * judge, which reads the gray band `clusterFeedCards` deliberately cannot reach.
 *
 * Union-find rather than a pairwise merge, because a 3-card event surfaces as two
 * OVERLAPPING pairs (A~B, B~C): merging pairwise leaves two clusters that each believe
 * they own a card, and the delete count comes out wrong. The live Jan Koum case — one
 * $200M gift carded three times — is exactly that shape.
 *
 * The lowest index wins every merge, so with the oldest-first card order this module
 * already requires, the survivor is the earliest card of the combined event. Pure and
 * dependency-free: kept here rather than in the dedupe script so it is testable without
 * importing a module that opens a database connection at load.
 */
export function mergeClusters(
  clusters: EventCluster[],
  samePairs: Array<[number, number]>
): EventCluster[] {
  const parent = clusters.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const [i, j] of samePairs) {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }

  const merged = new Map<number, EventCluster>();
  clusters.forEach((c, i) => {
    const root = find(i);
    const into = merged.get(root);
    if (!into) {
      merged.set(root, { keep: c.keep, drop: [...c.drop] });
      return;
    }
    into.drop.push(c.keep, ...c.drop);
  });
  return [...merged.values()];
}

export function clusterFeedCards(cards: FeedCard[]): EventCluster[] {
  const clusters: EventCluster[] = [];
  const sigs: Set<string>[] = [];
  const urlToCluster = new Map<string, number>();
  for (const card of cards) {
    let idx = card.sourceUrl ? urlToCluster.get(card.sourceUrl) ?? -1 : -1;
    if (idx === -1) {
      const sig = eventSignature(card.headline);
      idx = sigs.findIndex((s) => sameEvent(sig, s, CROSS_RUN_EVENT_THRESHOLD));
      if (idx === -1) {
        sigs.push(sig);
        clusters.push({ keep: card, drop: [] });
        idx = clusters.length - 1;
      } else {
        clusters[idx].drop.push(card);
      }
    } else {
      clusters[idx].drop.push(card);
    }
    if (card.sourceUrl) urlToCluster.set(card.sourceUrl, idx);
  }
  return clusters;
}
