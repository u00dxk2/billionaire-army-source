// Shared shape of an enriched feed item as served by GET /api/feed and
// /api/feed/:id. Was duplicated verbatim across FeedView, FeedCard,
// FeedCardSolo, and the two feed pages — consolidated here.
export interface FeedPerson {
  id: string;
  name: string;
  images: string[];
  state: string | null;
}

/**
 * R-052 — live-joined by the API from the person's net_worth + total_giving
 * facts. ABSENT (undefined) on the ~90% of cards with no curated giving fact;
 * never zero. Do not default it.
 */
export interface FeedGivingRatio {
  annualGiving: number;
  netWorth: number;
  percent: number;
}

export interface FeedItem {
  id: string;
  headline: string;
  summary: string;
  sourceUrl: string;
  sourceName: string;
  category: string;
  contextData: Record<string, unknown>;
  curationScore: string;
  upvotes: number;
  downvotes: number;
  publishedAt: string;
  createdAt: string;
  persons: FeedPerson[];
  commentCount: number;
  givingRatio?: FeedGivingRatio;
  /**
   * R-063 — true only for the punch-promoted best-of slice on page 1. Optional because
   * page 2+ and any older cached response simply omit it, and an absent flag must read
   * as "not promoted" rather than throwing off the zone split.
   */
  promoted?: boolean;
  /**
   * B-037 — this card's primary person has an FEC record we decline to attribute, so the API
   * stripped both the political chip and (via `withholdPoliticalProse`) any sentence that stated
   * a figure. Optional for the same reason as `promoted`: an absent flag must read as "nothing
   * withheld" rather than silently claiming a withhold on every cached response.
   */
  politicalWithheld?: boolean;
  /**
   * Not graded (2026-10-02) — a tagged person has no giving record on file, so the API withheld a
   * summary that stated a giving score. Optional for the same reason as `politicalWithheld`.
   */
  scoreWithheld?: boolean;
  /**
   * "not_graded" when ANY tagged person has no giving record on file — the card then carries no
   * score chip and says so. Absent on a card with no tagged person and on an older API build.
   */
  gradeStatus?: "graded" | "not_graded";
  /**
   * B-065 — "undated estimate" / "as of Jun 2025" beside the net-worth chip, or null/absent when the
   * figure is current. The API decides it (`cardNetWorthDisplay`); the card only prints it.
   */
  netWorthAsOf?: string | null;
  /** B-065 — the giving grade divides by that not-current net worth. */
  gradeUsesStaleNetWorth?: boolean;
  /** B-065 — the earlier, undated figure the card's text was written from, when the chip has since moved. */
  netWorthTextFigure?: string | null;
}
