/**
 * Giving-ratio primitives — the fact parsers plus the one ratio the feed card
 * renders.
 *
 * These parsers used to live in `packages/jobs/src/pbs-signals.ts`, read only
 * by the PBS scorer. R-052 needs the same two numbers on the API's display
 * path, and CLAUDE.md's standing rule (set by `accountabilityScore`) is that
 * shared calculation lives HERE so selection and display run off ONE
 * calibration. So they moved rather than being copied — `pbs-signals.ts`
 * re-exports them and the three scoring call sites are unchanged.
 *
 * Why the API cannot just divide the numbers already on the card: a feed item's
 * `contextData` is entirely pre-formatted DISPLAY STRINGS frozen at curation
 * time (`netWorth` is the string `"~$1.14T"`, `philanthropy` is the sentence
 * `"$539M in foundation assets"`). There is no numeric field to divide, and the
 * snapshot is stale besides — the same reason B-005 had to live-join PBS.
 */

/** Parse a net-worth fact value (e.g. "~$1.2B", "$790 billion", {value:"$3B"}) to USD. */
export function parseNetWorth(v: unknown): number | null {
  const s =
    typeof v === "string"
      ? v
      : v && typeof v === "object" && "value" in v
        ? String((v as { value: unknown }).value)
        : null;
  if (!s) return null;
  const m = s.replace(/[~$,\s]/g, "").match(/([\d.]+)\s*([BMT])?/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return null;
  const suffix = m[2]?.toUpperCase();
  const mult = suffix === "T" ? 1e12 : suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : 1;
  return num * mult;
}

/** Read the annualized documented direct-giving figure from a total_giving fact (R-007). */
export function directGivingAnnualFromFact(fv: unknown): number {
  const v = fv as { annualGiving?: unknown };
  return Number(v?.annualGiving) || 0;
}

export interface GivingRatio {
  /**
   * Annual documented direct giving, USD.
   *
   * ANNUALIZED, not "last year". Most curated total_giving facts derive this by
   * spreading a lifetime figure over the giving period — Buffett's $3B/yr comes
   * from "over $60B since 2006", Zuckerberg's $636M/yr from "~$7B since 2015".
   * Only some (Bloomberg's $3.7B in 2024) are a real single year. So any copy
   * rendering this MUST hedge to a rate ("gives about X a year") and must never
   * say "last year" — that was caught in review before shipping, and it is the
   * same overstatement class as B-026.
   */
  annualGiving: number;
  /** Net worth, USD. */
  netWorth: number;
  /** annualGiving / netWorth, as a percentage (11.7 means 11.7%). */
  percent: number;
}

/**
 * The one ratio the card renders: documented annual giving as a share of net
 * worth. Returns `null` — never a zero, never a partial — whenever it cannot be
 * stated truthfully, because the ABSENT case is ~90% of cards and a rendered
 * "0%" would be a false claim that a named living person gives nothing. That is
 * B-026's defect class pointed at a person instead of at ourselves.
 *
 * Deliberately NOT sourced from foundation assets or `totalGrantsPaid`, despite
 * those having far higher coverage (90% vs 10% on the live feed). Foundation
 * attribution is this project's most-burned surface (B-020 credited $30.6B of
 * Kaiser Permanente to George Kaiser; B-021, still open, has generic
 * `<Surname> Family Foundation` entities attaching to unrelated people), and
 * `totalGrantsPaid` conflates real grants with total expenses. A rendered ratio
 * makes its numerator the loudest number on the card — so it gets the
 * best-sourced input, not the best-covered one.
 */
export function givingRatio(netWorthFactValue: unknown, totalGivingFactValue: unknown): GivingRatio | null {
  const netWorth = parseNetWorth(netWorthFactValue);
  if (netWorth == null || !(netWorth > 0)) return null;

  const annualGiving = directGivingAnnualFromFact(totalGivingFactValue);
  if (!(annualGiving > 0)) return null;

  const percent = (annualGiving / netWorth) * 100;
  if (!isFinite(percent)) return null;

  return { annualGiving, netWorth, percent };
}

/**
 * Render a ratio percentage: "11.7%", "6.7%", "0.9%", "<0.1%".
 *
 * One decimal everywhere. An earlier version rounded to whole numbers above
 * 10%, which turned Soros's 11.66% into "12%" — and the whole point of the line
 * is comparing people, where the difference between 11.7% and 6.7% is the
 * story. Below 0.1% it renders "<0.1%" rather than "0.0%", because "0.0%" reads
 * as zero and that is the false-claim branch `givingRatio` returns null for.
 */
export function formatGivingPercent(percent: number): string {
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/** "$3.7B", "$636M" — matches the shape net-worth facts are already written in. */
export function formatUsdCompact(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(usd);
}
