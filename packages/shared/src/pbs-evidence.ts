/**
 * Is a PBS component's zero a MEASURED zero, or an absence of evidence?
 *
 * The profile's Score Breakdown renders each component as a percentage, and the
 * philanthropy component is `0.15·pledge + 0.65·generosity + 0.2·scale` — every
 * term of which collapses to 0 when we simply have no giving data. So a person
 * we know nothing about and a person who genuinely gives nothing render the
 * IDENTICAL "Philanthropy — 0 %" beside the words "Evidenced charitable giving".
 *
 * Measured on prod 2026-08-22: 298 of 1,092 approved profiles (27.3%) publish
 * that 0%, and 271 of those carry no giving fact of any kind. The set includes
 * Steve Ballmer, Ralph Lauren, Steven Spielberg and Thomas F. Frist Jr. —
 * heavily-documented donors whose profiles told a reader they give nothing.
 * On a site whose thesis is that no claim outruns its citation, that is the
 * worst possible place to make an unsourced claim, and it is aimed at a named
 * living person.
 *
 * THIS IS THE SAME RULE `givingRatio()` ALREADY ENFORCES ON THE FEED CARD —
 * "returns null, never a zero, whenever it cannot be stated truthfully" — and
 * the same shape as R-041's grade-badge relabel: the SCORE was right, the
 * PRESENTATION was what misled. Nothing here changes a score, a grade, or a
 * rank; it changes what an unevidenced zero is allowed to SAY.
 *
 * Kept as a pure predicate in its own module for the reason `isAdminUserId` and
 * `isOnCooldown` are: a display decision that can make a false claim about a
 * real person is a decision worth testing, and it cannot be tested inside a
 * React component that needs a page's worth of props to render.
 */

/**
 * Fact keys that count as giving evidence.
 *
 * `total_giving` is the curated direct-giving fact (factKey, NOT factType — the
 * importer writes factType `philanthropy`, and querying the type returns a false
 * zero indistinguishable from "nobody has this data"). `foundation_990s` is the
 * ProPublica 990 fact. Both are what `computePbs` actually reads through
 * `directGivingAnnual` / `foundationGiving`, so this list is the evidence set
 * for the philanthropy component by construction, not by resemblance.
 */
export const GIVING_EVIDENCE_FACT_KEYS = ["total_giving", "foundation_990s"] as const;

/** Does this person carry any fact the philanthropy component could have scored from? */
export function hasGivingEvidence(factKeys: Iterable<string>): boolean {
  const keys = new Set(factKeys);
  return GIVING_EVIDENCE_FACT_KEYS.some((k) => keys.has(k));
}

/**
 * Should the philanthropy component render as "no data on file" rather than 0%?
 *
 * TRUE only when BOTH hold: the component scored exactly 0, AND no giving fact
 * exists to have scored it from. A person WITH a 990 that discloses no grants
 * keeps a numeric 0% — that is a real reading of real evidence (an asset-parking
 * foundation), and 27 of the 298 are in that case. Blanking those would hide a
 * finding rather than withhold a non-finding.
 *
 * A non-zero component is never relabelled, however small.
 */
/**
 * Which of the three things a philanthropy score is actually saying.
 *
 *   null            — the component is non-zero; it scored from evidence and speaks for itself.
 *   "unevidenced"   — it is 0 because we hold no giving fact. Says nothing about the person.
 *   "evidenced-zero"— it is 0 because the 990 we hold reports no grants. That IS a finding.
 *
 * The third case is why this returns a kind rather than a boolean. Read all 27 of them on prod
 * 2026-08-22, every one a real filing of a dormant or near-empty foundation — Ted Leonsis
 * (totalAssets $20,201, grantsPaid $0, tax year 2023), Joshua Kushner ($4,644 / $0 / 2019),
 * Robert Pera ($1 / $0 / 2023). None was the scorer misreading a 990-PF; the filings really do
 * disclose no grants. But a bare "0%" renders identically to the unevidenced zero this module was
 * written to stop, so the reader is told which one they are looking at.
 */
export type PhilanthropyZeroKind = "unevidenced" | "evidenced-zero" | null;

export function philanthropyZeroKind(
  philanthropyComponent: number | null | undefined,
  factKeys: Iterable<string>
): PhilanthropyZeroKind {
  if (Number(philanthropyComponent ?? 0) !== 0) return null;
  return hasGivingEvidence(factKeys) ? "evidenced-zero" : "unevidenced";
}

export function philanthropyIsUnevidenced(
  philanthropyComponent: number | null | undefined,
  factKeys: Iterable<string>
): boolean {
  const v = Number(philanthropyComponent ?? 0);
  if (!(v === 0)) return false;
  return !hasGivingEvidence(factKeys);
}

/**
 * Should the profile's HEADLINE grade carry a "no giving data" qualifier?
 *
 * This exists as a tested unit rather than an inline expression in the page because the
 * wire-up is the part that reads absent input as a clean zero (KP-93): it is where
 * `features.philanthropy` and `facts[].factKey` are looked up BY NAME, and neither lookup
 * can fail loudly — a rename on either side just yields 0 / an empty key set.
 *
 * MEASURED, not reasoned: renaming the `features.philanthropy` lookup and running the
 * suite makes the caveat fire too EAGERLY, not too rarely. Every miss collapses the
 * component to 0, and a 0 with no giving fact is precisely the caveat's own condition. The
 * concrete victim is a Giving Pledge signatory with no 990 and no curated `total_giving`:
 * the pledge term alone scores them 0.15, so they are NOT an unevidenced zero, but a broken
 * lookup reads them as one and hangs "no giving data" on someone who publicly pledged half
 * their wealth. `header caveat stays silent on a non-zero component` is the test that fails
 * on that sabotage, and it is the load-bearing one — the positive control below survives it,
 * because for a person who really has no giving fact the broken lookup lands on the right
 * answer for the wrong reason.
 *
 * The other asymmetry is what makes the line safe to render at all: the FACT SET is an
 * independent second condition, so a malformed `features` blob can never fire the caveat
 * over real giving evidence. Pinned in both directions below.
 */
export function unevidencedGradeCaveat(
  score: { features?: unknown } | null | undefined,
  facts: readonly { factKey: string }[] | null | undefined
): boolean {
  if (!score) return false;
  const features = (score.features ?? {}) as Record<string, unknown>;
  const philanthropy = Number(features.philanthropy ?? 0);
  const factKeys = (facts ?? []).map((f) => f.factKey);
  return philanthropyZeroKind(philanthropy, factKeys) === "unevidenced";
}
