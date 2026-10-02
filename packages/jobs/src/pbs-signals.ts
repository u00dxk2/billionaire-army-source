/**
 * Extract PBS v2 signals from a person row + their facts. Shared by the batch
 * scorer (score-all.ts) and the per-person recalc worker (worker.ts) so the two
 * paths can never diverge (they did in v1 — different philanthropy/transparency
 * formulas in each). Pure given its inputs; the actual scoring math lives in
 * @ba/shared (computePbs).
 */
import type { PbsSignals } from "@ba/shared";
// parseNetWorth + directGivingAnnualFromFact moved to @ba/shared (R-052) so the
// API's display path and the PBS scorer divide the same numbers off ONE copy —
// the accountabilityScore rule. Re-exported here so the three scoring call
// sites (score-all, score-preview, worker) import unchanged.
import { parseNetWorth, directGivingAnnualFromFact, foundationTotals, SUMMARY_QUARANTINE_FACT_KEY } from "@ba/shared";

export { parseNetWorth, directGivingAnnualFromFact };

interface PersonRow {
  badges: unknown;
  images: unknown;
}
interface FactRow {
  factType: string;
  factKey: string;
  factValue: unknown;
}

/**
 * Foundation totals for the score, with endowment vehicles collapsed (B-030).
 *
 * Both delegate to `foundationTotals` in @ba/shared, which is the SAME copy the API's profile
 * surface reads — the no-fork rule that `accountabilityScore` and `eventSignature` already follow.
 * Before 2026-08-12 these two functions and `routes/persons.ts` each aggregated independently, and
 * `foundationGivingTotal` returned the stored `totalGrantsPaid` verbatim, which IS the fetcher's
 * un-collapsed sum — so a foundation counted with its own trust reached the published score at
 * roughly 2x. Measured impact when the collapse landed: 3 persons of 1,102, 0 published grades move.
 */
export function foundationAssetsTotal(fv: unknown): number {
  return foundationTotals(fv).totalAssets;
}

export function foundationGivingTotal(fv: unknown): number {
  return foundationTotals(fv).totalGrants;
}


export function extractPbsSignals(person: PersonRow, allFacts: FactRow[]): PbsSignals {
  // B-045 C2: a quarantine row is not a public-accountability source. Counted as one, its new factType
  // would raise transparency (sourceCount) for exactly the people whose summary was caught WRONG.
  const facts = allFacts.filter((f) => f.factKey !== SUMMARY_QUARANTINE_FACT_KEY);
  const badges = (person.badges as Record<string, boolean>) ?? {};
  const types = new Set(facts.map((f) => f.factType));
  const keys = new Set(facts.map((f) => f.factKey));
  const hasImage = Array.isArray(person.images) && person.images.length > 0;

  const givingPledge =
    badges.givingPledge === true || types.has("giving_pledge") || keys.has("giving_pledge");

  const nwFact = facts.find((f) => f.factType === "net_worth" || f.factKey === "net_worth");
  const netWorth = nwFact ? parseNetWorth(nwFact.factValue) : null;

  // foundation_990s is the philanthropy fact carrying assets + giving; the
  // giving_pledge + total_giving facts are also factType "philanthropy" but
  // carry no foundations[], so match foundation_990s by key first.
  const philFact = facts.find((f) => f.factKey === "foundation_990s")
    ?? facts.find((f) => f.factType === "philanthropy");
  const foundationAssets = philFact ? foundationAssetsTotal(philFact.factValue) : 0;
  const foundationGiving = philFact ? foundationGivingTotal(philFact.factValue) : 0;

  // R-007: documented direct giving (LLC/DAF/direct gifts, no 990), annualized.
  const directFact = facts.find((f) => f.factKey === "total_giving");
  const directGivingAnnual = directFact ? directGivingAnnualFromFact(directFact.factValue) : 0;

  // distinct public-accountability sources = distinct fact types (+ a profile image)
  const sourceCount = types.size + (hasImage ? 1 : 0);

  return { netWorth, foundationAssets, foundationGiving, directGivingAnnual, givingPledge, sourceCount };
}
