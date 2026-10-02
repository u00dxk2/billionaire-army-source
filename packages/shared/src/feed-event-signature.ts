/**
 * Same-event signature primitives — the bag-of-words overlap that answers
 * "are these two headlines about one event?".
 *
 * These live in @ba/shared for the same reason accountabilityScore() does: the
 * curator uses them at INGEST (does this candidate repeat something we already
 * carded?) and the API uses them at DISPLAY (are two of the six cards I am about
 * to promote the same story?). One calibration, two call sites — a second copy
 * would drift, and the drift would be invisible because both copies would look
 * correct in isolation.
 *
 * The THRESHOLDS deliberately did NOT move with them. Each call site carries its
 * own, because the cost of a false positive differs by an order of magnitude
 * between them: at ingest it suppresses a card permanently, at display it only
 * costs a promotion. `feed-event-dedup.ts` (jobs) keeps CROSS_RUN_EVENT_THRESHOLD
 * and re-exports these so its own import surface is unchanged.
 */

// Non-distinctive words that would inflate overlap between unrelated stories.
const EVENT_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "over", "after", "before",
  "that", "this", "these", "those", "says", "said", "amid", "about", "their",
  "they", "them", "will", "would", "could", "should", "have", "has", "had",
  "been", "being", "than", "then", "what", "when", "where", "which", "while",
  "who", "whom", "your", "you", "its", "his", "her", "new", "report", "reports",
  "according", "more", "most", "less", "may", "might", "amid",
]);

/**
 * Content-word signature: lowercased words >= 4 chars, punctuation stripped,
 * stopwords removed. Returns a Set for cheap intersection.
 *
 * The person name is intentionally NOT stripped — keeping it boosts overlap
 * across cards about the same event attributed to different people, while a
 * single shared name word stays far below any threshold here (two unrelated
 * Musk stories share only "musk").
 */
export function eventSignature(title: string): Set<string> {
  return new Set(
    (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !EVENT_STOPWORDS.has(w))
  );
}

/**
 * Raw Jaccard overlap of two signatures, 0..1. Exported so a probe can print the
 * SCORE rather than re-deriving the arithmetic — every yes/no answer in the
 * codebase is a comparison against this one function, so there is one
 * calibration here, not two that can drift.
 */
export function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}
