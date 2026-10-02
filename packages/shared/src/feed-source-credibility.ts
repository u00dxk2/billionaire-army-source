/**
 * Source-credibility downweight for the feed pre-rank (R-028, Option B —
 * owner-approved 2026-07-06).
 *
 * The source name prints on every feed card, so on a receipts platform the
 * source IS part of the receipt — "per zerohedge" lands very differently than
 * "per ProPublica." This module assigns each candidate's publisher a
 * credibility TIER used as the primary sort key in the curator's candidate
 * ordering: tier-1 (low-credibility) candidates sink to the BACK of the queue,
 * behind every default-tier candidate, but are NEVER banned — when they carry
 * the only coverage (thin candidate days), they can still reach the selector,
 * and the two-pass gate + faithfulness verifier remain the quality floor.
 *
 * SEED LIST RULES (editorial surface — changes are owner-reviewed, never
 * unilateral): the list is deliberately SMALL, SYMMETRIC across the political
 * spectrum, and limited to outlets with widely documented reliability problems
 * (fabrication, conspiracy promotion, or party-organ/advocacy publishing) per
 * mainstream media-reliability trackers — NOT merely partisan-leaning or
 * small/local outlets. Downweight ≠ judgment that every story is false; it
 * means "don't let this domain be the receipt when better sourcing exists."
 *
 * Matching is by domain suffix on the stored source string (GDELT stores the
 * publisher domain; NewsAPI stores a display name that simply won't match) —
 * "www.zerohedge.com" matches "zerohedge.com"; "veropatriot.iheart.com" is an
 * exact-subdomain entry that does NOT smear the rest of iheart.com.
 */

/** Domains that sort behind all default-tier candidates. Reason noted per entry. */
export const LOW_CREDIBILITY_DOMAINS: { domain: string; reason: string }[] = [
  // Right-leaning / conspiratorial
  { domain: "zerohedge.com", reason: "conspiratorial finance content, documented reliability problems" },
  { domain: "thegatewaypundit.com", reason: "documented misinformation record" },
  { domain: "infowars.com", reason: "conspiracy promotion" },
  { domain: "naturalnews.com", reason: "documented pseudoscience/misinformation" },
  { domain: "breitbart.com", reason: "strongly partisan, documented reliability problems" },
  { domain: "newsbusters.org", reason: "partisan media-criticism advocacy publishing (owner-approved 2026-07-25: its Soros/jihad-framing card reached /feed position 5 beside a PBS 'A'; added for symmetry with the advocacy entries below)" },
  { domain: "veropatriot.iheart.com", reason: "partisan local talk-radio blog (exact subdomain; not iheart.com broadly)" },
  { domain: "washingtonexaminer.com", reason: "strongly partisan national outlet (owner-approved 2026-08-17: its 'Soros-funded group reportedly offers payments to student protesters' card was the day's ONLY published card, served at /feed position 7, and rendered its source line as the literal word 'Unknown' until 0c2e6b0 — an unproven allegation about a named living person with no named source. Same shape as the newsbusters entry above, which the owner added for a Soros-framing card at position 5)" },
  // Left-leaning / advocacy organs
  { domain: "wsws.org", reason: "party organ (Socialist Equality Party)" },
  { domain: "occupydemocrats.com", reason: "documented misinformation record" },
  { domain: "palmerreport.com", reason: "documented reliability problems" },
  { domain: "alternet.org", reason: "strongly partisan advocacy publishing" },
  { domain: "dailykos.com", reason: "partisan advocacy blog network" },
];

const LOW_SET = LOW_CREDIBILITY_DOMAINS.map((d) => d.domain);

/**
 * 0 = default (no adjustment), 1 = low-credibility (sorts after all tier-0).
 * `source` is the candidate's stored publisher string (domain for GDELT).
 */
export function credibilityTier(source: string | null | undefined): 0 | 1 {
  if (!source) return 0;
  const s = source.trim().toLowerCase();
  if (!s) return 0;
  for (const domain of LOW_SET) {
    // Exact match or subdomain of the listed domain ("www.zerohedge.com").
    if (s === domain || s.endsWith("." + domain)) return 1;
  }
  return 0;
}
