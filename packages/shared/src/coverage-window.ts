/**
 * The profile's News section states a "Coverage window" for the articles beneath it.
 *
 * BOTH news fetchers used to build that string from POSITIONAL endpoints —
 * `articles[articles.length - 1].date to articles[0].date` — which is only correct if the array
 * happens to be sorted oldest-first. GDELT returns articles by RELEVANCE, so it usually is not.
 * Measured on the stored corpus 2026-09-09: **20 of 34 judged profiles (58.8%)** published a
 * window that misstated their own articles — 14 read BACKWARD (end before start, e.g. MacKenzie
 * Scott's "2026-08-20 to 2026-08-11"), 4 UNDERSTATED the span (Bill Gates' profile claimed
 * "2026-08-19 to 2026-08-20" over articles spanning 2020-09-02 to 2026-08-21 — six years reported
 * as two days), and 2 collapsed a real span to a single date.
 *
 * ONE function, read by both fetchers AND the profile render, so the write path and the display
 * cannot drift apart — the same rule this repo applies to `accountabilityScore` and
 * `eventSignature`. Do not fork a second copy into `jobs` or `web`.
 *
 * The render calls it over the articles it is ABOUT TO DISPLAY rather than trusting the stored
 * string, on the same reasoning that makes the feed card's giving ratio rendered-never-written: a
 * derived display string frozen at write time is stale the moment the underlying rows change, and
 * here it was not merely stale but wrong. Fixing only the writers would leave every already-stored
 * window wrong until its person came round again on GDELT's stalest-first rotation.
 */

/** ISO calendar date, the only shape either fetcher stores. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The true coverage window for a set of article dates: earliest to latest, ascending.
 *
 * Returns `""` when there is nothing honest to state — no parseable date at all. A SINGLE date
 * returns that date alone rather than "X to X", because a one-article fact does not describe a
 * range and saying so invents a span the evidence does not support. Unparseable entries are
 * dropped rather than guessed at.
 */
export function coverageWindow(dates: readonly (string | null | undefined)[]): string {
  const parsed = dates
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => ISO_DATE.test(d))
    .sort();
  if (parsed.length === 0) return "";
  const earliest = parsed[0];
  const latest = parsed[parsed.length - 1];
  return earliest === latest ? earliest : `${earliest} to ${latest}`;
}

const parseIso = (s: unknown): string | null =>
  typeof s === "string" && ISO_DATE.test(s.trim()) ? s.trim() : null;

/** Split a stored "A to B" window into its two endpoints; `null` when either is unparseable. */
export function coverageWindowEndpoints(range: unknown): { start: string; end: string } | null {
  const parts = typeof range === "string" ? range.split(/\s+to\s+/) : [];
  if (parts.length !== 2) return null;
  const [start, end] = parts.map(parseIso);
  return start && end ? { start, end } : null;
}

export type CoverageMisstatement = "BACKWARD" | "UNDERSTATED" | "DEGENERATE";

/**
 * How a STORED window misstates its own articles, or `null` when it does not — or when there is
 * nothing to disagree with (no parseable range, or fewer than two parseable article dates).
 *
 * This is the ONE predicate behind both `check:coverage-window` (which counts) and
 * `recompute:coverage-window` (which rewrites exactly the rows it counts). It lived inline in the
 * checker until B-043's recompute needed it; a second copy in the writer would be a fork of the
 * check that later proves the writer worked.
 */
export function coverageMisstatement(
  range: unknown,
  articleDates: readonly unknown[],
): CoverageMisstatement | null {
  const ends = coverageWindowEndpoints(range);
  const dates = articleDates.map(parseIso).filter((d): d is string => d !== null).sort();
  if (!ends || dates.length < 2) return null;
  if (ends.end < ends.start) return "BACKWARD";
  const min = dates[0];
  const max = dates[dates.length - 1];
  if (ends.start === ends.end && min !== max) return "DEGENERATE";
  if (ends.start > min || ends.end < max) return "UNDERSTATED";
  return null;
}

/**
 * The B-043 recompute for ONE stored news fact: `null` when the fact is not misstated (so it is
 * never touched), otherwise the stored window, the kind, and the corrected window derived by
 * `coverageWindow()` over the fact's OWN articles. Pure — the script does the write.
 */
export function planCoverageWindowFix(factValue: unknown):
  | { kind: CoverageMisstatement; before: string; after: string }
  | null {
  if (!factValue || typeof factValue !== "object" || Array.isArray(factValue)) return null;
  const v = factValue as { dateRange?: unknown; articles?: unknown };
  const articles = Array.isArray(v.articles) ? v.articles : [];
  const dates = articles.map((a) => (a && typeof a === "object" ? (a as { date?: unknown }).date : undefined));
  const kind = coverageMisstatement(v.dateRange, dates);
  if (!kind || typeof v.dateRange !== "string") return null;
  return { kind, before: v.dateRange, after: coverageWindow(dates.map((d) => (typeof d === "string" ? d : null))) };
}
