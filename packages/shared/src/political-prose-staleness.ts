/**
 * Was this profile's political prose written BEFORE the FEC record it describes was last refreshed?
 *
 * R-077, 2026-09-13. The 2026-09-12 `fetch:fec` refresh rewrote stored facts (a newer 100-record
 * window plus the FEC's own contribution count) without touching the summaries written from the old
 * ones. Live on Phil Ruffin's profile the prose said the sample "totaled $1,014,052.42" directly
 * above a records card totalling $613,616.06, with nothing telling a reader why they differ.
 *
 * THIS ASKS TWO DATES AND NOTHING ELSE — no prose, no figures, no party words. That is deliberate.
 * The first version compared the prose's dollar figures against the stored total, and an
 * adversarial review reproduced three ways it removed CORRECT paragraphs: prose stating recipient
 * amounts but no total; `proseAmounts` reading "1,234 contributions" as money and "$1 million" as 1;
 * and judging raw prose that `stripPipelineCommentary` would have cut. That is the same wall B-038's
 * withhold hit on 2026-09-11 (thirteen false withholds — see party-prose.ts, which rules itself out
 * as a render gate): a figure in prose carries no context. So this predicate withholds NOTHING. The
 * page keeps the paragraph and dates it, which is the honest-and-imprecise order B-037 settled on
 * for the page-size cap.
 *
 * It clears itself: regenerate the summary and the caveat stops rendering, because the summary is
 * then the newer of the two. Regeneration remains the fix; this only stops the page reading as a
 * contradiction in the meantime.
 */
export function isPoliticalProseOutdated(
  summaryWrittenAt: string | null | undefined,
  fecRetrievedAt: string | null | undefined,
): boolean {
  const written = Date.parse(summaryWrittenAt ?? "");
  const refreshed = Date.parse(fecRetrievedAt ?? "");
  if (!Number.isFinite(written) || !Number.isFinite(refreshed)) return false;
  return refreshed > written;
}
