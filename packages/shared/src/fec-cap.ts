/**
 * Is a stored FEC fact TRUNCATED by the fetcher's page size?
 *
 * `fec.ts` requests `per_page=100` and does not paginate, so anyone with more than 100 federal
 * contributions comes back as their 100 MOST RECENT ones — and `count`, `totalAmount`,
 * `dateRange`, `partyBreakdown` and `topRecipients` are then every one of them computed over that
 * truncated set. 2026-08-29 fixed the PROSE (481 profiles had published the page size as a fact
 * about a named person); the profile page's stat tiles, party bars and date range were untouched
 * and still present the truncated figures as complete. This is the decision both halves read.
 *
 * Deliberately ONE function in `@ba/shared` rather than a `count === 100` test at each call site:
 * the same rule the repo applies to `accountabilityScore` and `eventSignature`. A second copy is
 * how the prose and the render came to disagree in the first place.
 */

/** The fetcher's `per_page`. A record landing exactly here is at the cap, not coincidentally 100. */
export const FEC_PAGE_SIZE = 100;

export interface FecFactShape {
  count?: number;
  /** The FEC's own `pagination.count` for the query — captured from 2026-08-29 (R-077) onward,
   *  so it is ABSENT on every fact stored before the next `fetch:fec` run. Absent means unknown,
   *  never zero. */
  reportedTotalContributions?: number | null;
}

/**
 * True when the stored figures cover only part of the person's record.
 *
 * Two signals, in order of strength:
 *  1. `reportedTotalContributions > count` — the FEC told us the real total and it is larger.
 *  2. `count >= FEC_PAGE_SIZE` — no reported total, but the page came back full, which for a
 *     non-paginating fetcher is what truncation looks like from the inside.
 *
 * Returns false on a missing/unusable `count`: an absent record must not render a cap notice, and
 * "we could not tell" is not "it is truncated".
 */
export function isFecRecordCapped(fact: FecFactShape | null | undefined): boolean {
  if (!fact || typeof fact.count !== "number" || !Number.isFinite(fact.count)) return false;
  const reported = fact.reportedTotalContributions;
  if (typeof reported === "number" && Number.isFinite(reported)) return reported > fact.count;
  return fact.count >= FEC_PAGE_SIZE;
}

/**
 * How many contributions the person actually has, when we can state it.
 * `null` when the record is capped and the FEC's own total was never captured — the honest reading
 * is "at least `count`", which the caller renders; it is never a number we invent.
 */
export function fecReportedTotal(fact: FecFactShape | null | undefined): number | null {
  const reported = fact?.reportedTotalContributions;
  return typeof reported === "number" && Number.isFinite(reported) ? reported : null;
}
