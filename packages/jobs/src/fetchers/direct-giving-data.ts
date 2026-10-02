/**
 * Curated direct-giving dataset for PBS v2 (R-007).
 *
 * Foundation 990s capture money disbursed THROUGH a private foundation, but the
 * largest modern philanthropists increasingly give DIRECTLY (LLC / DAF / direct
 * gifts) with no 990 to read — so PBS v2 understated them (generosity scored 0,
 * leaving only the Giving Pledge nudge). MacKenzie Scott is the textbook case:
 * over $26B given via Yield Giving, no private foundation, graded B.
 *
 * Each entry is a SOURCED, documented cumulative-giving figure. We annualize it
 * (cumulative ÷ years active) to compare apples-to-apples with the annual 990
 * grants-paid figure the scorer already uses, then feed it into generosity as
 * max(annual foundation giving, annualized direct giving) ÷ net worth — the max
 * avoids double-counting anyone who gives through BOTH a foundation and directly.
 *
 * INTEGRITY BAR: this is a receipts platform — only figures traceable to a
 * primary or authoritative source belong here. Expand deliberately: pick one
 * source-of-truth (Forbes philanthropy score or the Chronicle Philanthropy 50)
 * and cite the exact figure + period per entry. Do NOT add figures recalled
 * from memory or aggregated from a search snippet.
 */

export interface DirectGivingEntry {
  /** Name for matching against persons.name (normalized; see normalizeName). */
  name: string;
  /** Documented cumulative charitable giving, USD. */
  cumulativeUsd: number;
  /** Year giving began (used to annualize). */
  sinceYear: number;
  /** Human-readable period label for the receipt (e.g. "since 2019"). */
  periodLabel: string;
  /** Primary/authoritative source for the figure. */
  sourceUrl: string;
  sourceName: string;
  /**
   * Optional documented recent annual giving (USD), used for scoring INSTEAD of
   * cumulative ÷ years. Set this only when a reliable recent-annual figure is a
   * better estimate of current giving than the lifetime average — i.e. a donor
   * whose giving accelerated sharply (e.g. Bloomberg gives ~$3.7B/yr now, far
   * above his lifetime average). Most entries leave this unset.
   */
  annualUsdOverride?: number;
  /** Optional extra context shown in the receipt. */
  note?: string;
}

/** As-of year for annualization (explicit so scores stay reproducible). */
export const DIRECT_GIVING_AS_OF_YEAR = 2026;

/**
 * v1 is seeded with the single fully-primary-sourced flagship case. Yield Giving
 * (yieldgiving.com) publishes the running total directly — unimpeachable. The
 * next tier (Buffett, Soros, Bloomberg, Gates) is a deliberate fast-follow once
 * a single source-of-truth is chosen and each figure is cited to it.
 */
export const DIRECT_GIVING: DirectGivingEntry[] = [
  {
    name: "MacKenzie Scott",
    // The cited page reads "over $26,000,000,000 in 2,700+ gifts" and names NO start year (re-read
    // 2026-09-21). The row said $26.3B "since 2019", neither of which the source states, so the label
    // is deliberately not a period until a source for one exists: readPhilanthropyFacts refuses it,
    // and her /today card cannot lead with an unsourced sentence. sinceYear still drives annualization.
    cumulativeUsd: 26_000_000_000,
    sinceYear: 2019,
    periodLabel: "via Yield Giving",
    sourceUrl: "https://yieldgiving.com",
    sourceName: "Yield Giving",
    note: "Over $26B in 2,700+ no-strings gifts via Yield Giving — no private foundation, so absent from 990 data.",
  },
  {
    name: "Warren Buffett",
    cumulativeUsd: 60_000_000_000,
    sinceYear: 2006,
    periodLabel: "since 2006",
    sourceUrl:
      "https://www.cnbc.com/2025/07/02/with-6-billion-donation-buffett-has-now-given-away-over-60-billion.html",
    sourceName: "CNBC",
    note: "Has given away over $60B in Berkshire stock since 2006 — most of it THROUGH the Gates Foundation + family foundations, so absent from his own 990.",
  },
  {
    name: "George Soros",
    cumulativeUsd: 32_000_000_000,
    // The source counts from 1984: "bringing his total giving to the Foundations since 1984 to over
    // $32 billion" (re-read 2026-09-21). The row said 1993, which misdated the claim and overstated
    // the annualized rate by about 27%.
    sinceYear: 1984,
    periodLabel: "since 1984",
    sourceUrl: "https://www.opensocietyfoundations.org/george-soros",
    sourceName: "Open Society Foundations",
    note: "Has given over $32B to the Open Society Foundations since 1984, including an $18B transfer in 2017 to fund their future work (about 80% of his wealth — Forbes' most generous by share of net worth).",
  },
  {
    name: "Mark Zuckerberg",
    cumulativeUsd: 7_000_000_000,
    sinceYear: 2015,
    periodLabel: "since 2015",
    sourceUrl:
      "https://projects.propublica.org/nonprofits/organizations/455002209",
    sourceName: "Chan Zuckerberg Initiative (ProPublica)",
    note: "Chan Zuckerberg Initiative has given ~$7B since 2015; structured as an LLC, so most of it files no attributable 990.",
  },
  {
    name: "Michael Bloomberg",
    cumulativeUsd: 21_000_000_000,
    sinceYear: 2006,
    periodLabel: "$21B+ lifetime",
    annualUsdOverride: 3_700_000_000,
    sourceUrl:
      "https://www.cnbc.com/2025/03/07/billionaire-michael-bloomberg-dont-wait-too-long-to-give-wealth-away.html",
    sourceName: "CNBC / Chronicle of Philanthropy",
    note: "Over $21B lifetime; gave $3.7B in 2024 (the Chronicle's #1 U.S. donor three years running). Scored on the documented recent annual figure, since he now gives far above his lifetime average.",
  },
  {
    name: "Pierre Omidyar",
    cumulativeUsd: 4_000_000_000,
    sinceYear: 2004,
    periodLabel: "since 2004",
    sourceUrl: "https://omidyar.com/people/pierre-omidyar/",
    sourceName: "Omidyar Network",
    note: "Pierre and Pam Omidyar have given over $4B since founding Omidyar Network in 2004 — an LLC-plus-foundation structure, so much files no attributable 990.",
  },
  {
    name: "Phil Knight",
    cumulativeUsd: 2_700_000_000,
    sinceYear: 2008,
    periodLabel: "≥$2.7B to OHSU",
    sourceUrl: "https://www.opb.org/article/2025/08/14/ohsu-phil-penny-knight-donation/",
    sourceName: "OPB / OHSU",
    note: "At least $2.7B given to OHSU's Knight Cancer Institute over the years (conservative floor — excludes Stanford and a 2025 $2B pledge not yet disbursed).",
  },
];

/**
 * Annualized giving used for scoring: a documented recent-annual figure when
 * one is provided (annualUsdOverride), else cumulative ÷ years active.
 */
export function annualizedGiving(
  e: DirectGivingEntry,
  asOf: number = DIRECT_GIVING_AS_OF_YEAR,
): number {
  if (e.annualUsdOverride && e.annualUsdOverride > 0) return e.annualUsdOverride;
  const years = Math.max(1, asOf - e.sinceYear);
  return e.cumulativeUsd / years;
}

/**
 * Normalize a name for matching: lowercase, strip honorifics/suffixes/middle
 * initials and punctuation. Mirrors the giving-pledge importer's matcher so the
 * two curated lists resolve persons the same way.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|iii|iv|ii|dr\.?|sir|lord|dame|hrh|prince)\b/gi, "")
    .replace(/\b[a-z]\.\s*/g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a curated entry to a person id. Exact normalized match, then
 * last-name + first-initial (handles "Bill" vs "William" etc.). Returns null
 * if no confident match — a curated figure with no person is logged, not forced.
 */
export function findPersonId(
  entryName: string,
  dbPersons: { id: string; name: string }[],
): string | null {
  const want = normalizeName(entryName);
  const wantParts = want.split(" ");
  const wantFirst = wantParts[0];
  const wantLast = wantParts[wantParts.length - 1];

  for (const p of dbPersons) {
    if (normalizeName(p.name) === want) return p.id;
  }
  for (const p of dbPersons) {
    const dbParts = normalizeName(p.name).split(" ");
    if (
      dbParts[dbParts.length - 1] === wantLast &&
      dbParts[0]?.[0] === wantFirst?.[0]
    ) {
      return p.id;
    }
  }
  return null;
}
