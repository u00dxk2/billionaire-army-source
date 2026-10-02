/**
 * Does a headline announce itself as UNVERIFIED REPORTING?
 *
 * This is the detector behind the visible "REPORTED" marker (R-062). It is deliberately NOT
 * `hedgePenalty()`, and the distinction is a cost asymmetry rather than a taste:
 *
 *   - `hedgePenalty` is a RANKING input. Ranking can afford to be loose, because a false hedge
 *     costs a card some position.
 *   - A visible label INVERTS that. It publishes an assertion about a named living person's card,
 *     on a platform whose whole thesis is that no claim outruns its citation.
 *
 * The same asymmetry already governs the two dedup thresholds (0.40 at ingest vs 0.25 at display).
 *
 * WHY A NARROW EXPLICIT LIST AND NOT ATTRIBUTION PARSING. The first attempt reused `hedgePenalty`
 * and fired on 23 of 152 live cards, ~7 of them wrongly — every wrong one a hedge word sitting
 * inside an ATTRIBUTION ("Ray Dalio warns … could") or a NEGATION ("not expected to"), i.e. a
 * verified statement ABOUT someone's position. Telling those apart needs real parsing. This list
 * sidesteps the entire class instead: `reportedly` / `rumored` / `a report says` are not hedges
 * that might be attributed — they are the reporter stating their own sourcing is second-hand. An
 * attributed "could" is a fact about a position; an attributed "reportedly" is still unverified.
 *
 * ponytail: a literal term list, not a parser. The upgrade path — if a real false positive ever
 * appears — is to REMOVE a term, never to add sentence analysis; the cost asymmetry above means
 * this list should only ever shrink under pressure.
 *
 * DO NOT ADD "alleges". A filed lawsuit is a documented event and the filing IS the receipt;
 * labelling it would mark the most defensible card class on the site. Pinned as a test.
 */

/**
 * Second-hand-sourcing markers. Each must be a phrase whose presence makes the claim unverified
 * REGARDLESS of who it is attributed to — that property is what makes the explicit-list approach
 * immune to the attribution/negation false-positive class.
 */
const REPORTED_PATTERNS: RegExp[] = [
  /\breportedly\b/i,
  /\brumou?red\b/i,
  /\brumou?rs?\b/i,
  /\ba report says\b/i,
  /\breports? say(s)?\b/i,
  /\baccording to reports\b/i,
  // ADJECTIVAL + LEADING forms, added 2026-08-24 after a Flow-1 cold read found the marker silent
  // on 8 headlines that announce second-hand sourcing in a shape the adverb misses — "Peter Thiel
  // takes REPORTED $76 million stake", "Elon Musk pursues REPORTED $4 billion funding round",
  // "REPORT revisits Bill Gates's… clearance". Measured on the live feed: 8 newly marked, all 8
  // true positives, zero false positives.
  // `\breported\b` does NOT match "reportedly" (no word boundary before the "ly"), so the two are
  // independent rather than overlapping.
  /\breported\b/i,
  /^report\b/i,
  // A `/\breports?\s+(?:that|revisits|says)/` pattern was drafted here and REMOVED before shipping:
  // it matched "Fortune reports that Sergey Brin has spent…", which is NAMED ATTRIBUTION — the
  // exact class rule 2 below says must stay silent. It also earned nothing: all 8 live headlines it
  // was meant to catch are already covered by `\breported\b` or `^report\b`. Worth recording because
  // the live headline sample did not contain that shape, so the MEASUREMENT missed it and the test
  // caught it — a clean case of this list's own rule that under pressure it shrinks, never grows.
];

/**
 * TWO SHAPES THAT MUST STAY SILENT, both verified against the live feed and pinned as tests —
 * they are why this list stops where it does rather than matching "report" generally:
 *
 *   1. A report as a DOCUMENT, not as sourcing: "Samueli Foundation releases a report aimed at
 *      helping donors make giving decisions." The foundation published a thing; nothing is
 *      unverified. Matching a bare "report" would label it.
 *   2. NAMED attribution: "Diane Hendricks gave $25 million to MAGA Inc., Urban Milwaukee reports."
 *      A named publication standing behind a claim IS this site's normal sourcing — it is the
 *      opposite of a hedge, and labelling it "Reported" would tell the reader to trust our best
 *      citations LESS. This is why `reports` is matched only when followed by that/revisits/says
 *      (an unnamed "reports say"), never as a trailing attribution.
 *
 * The same reasoning rules out extending the marker to the card's SUMMARY. Measured 2026-08-24: 7
 * of 171 cards hedge in the summary while the headline asserts flat — a real defect — but one of
 * them ("Fortune reports that Sergey Brin has spent more than $100 million…") is named attribution
 * on the headline's own claim, so a blanket summary check scores a false positive and misses the
 * zero bar. That gap is tracked as its own row, not patched in here.
 */

/** True when the headline announces its own claim as unverified second-hand reporting. */
export function isReportedClaim(headline: string | null | undefined): boolean {
  if (!headline) return false;
  return REPORTED_PATTERNS.some((re) => re.test(headline));
}

/** The terms themselves, for instruments that want to show WHICH marker fired. */
export function reportedMarkerHit(headline: string | null | undefined): string | null {
  if (!headline) return null;
  for (const re of REPORTED_PATTERNS) {
    const m = re.exec(headline);
    if (m) return m[0].toLowerCase();
  }
  return null;
}
