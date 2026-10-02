/**
 * ONE reading of a stored FEC `partyBreakdown`, for every surface that renders one.
 *
 * WHY THIS EXISTS (B-038, 2026-09-08). `fec.ts` stores the FEC party code verbatim, so the live
 * corpus carries SIXTEEN keys for about six parties — DEM 685, REP 657, PAC/Other 543, Unknown 299,
 * UNK 94, IND 68, DFL 59, NNE 50, NAT 14, OTH 7, LIB 6, Rep 4, UN 3, R 2, DCG 1, Dem 1
 * (`npm run check:party-sum` prints that histogram). Two consequences reached users:
 *
 *   1. Every renderer printed the RAW CODE as a party name, so a reader saw bars labelled `NNE`,
 *      `DCG` and `UNK`, and `/compare` said "mostly NNE".
 *   2. `DEM` and `Dem` are the SAME PARTY under two keys, so they rendered as two bars and — worse
 *      — the "top party" pickers compared FRAGMENTS. A person whose Democratic giving is split
 *      across both keys can be reported as leaning the other way. That is a false claim about a
 *      named living person's politics, not a cosmetic defect.
 *
 * FOUR surfaces read this shape and `topParty` was FORKED into two byte-identical copies
 * (`api/src/routes/persons.ts`, `web/src/components/DailySwipe.tsx`), with `/compare` sorting inline
 * and the profile bars doing their own `Object.entries`. Same don't-fork rule as `accountabilityScore`
 * and `eventSignature`: selection and display read ONE function or they drift.
 *
 * MERGE POLICY — deliberately narrow, because merging two codes ASSERTS they are the same party:
 *   - Case-folding only (`DEM`+`Dem`, `REP`+`Rep`). Provable: the same string, different casing.
 *   - The no-party family `Unknown`/`UNK`/`UN` folds together. Safe in the one direction that
 *     matters — none of the three asserts a party, so merging them claims nothing about anyone.
 *   - NOTHING ELSE MERGES. `DFL` is Minnesota's Democratic–Farmer–Labor party and folding it into
 *     `DEM` would be a political claim this file has no evidence for; `NNE` ("no party listed") is
 *     not `Unknown` ("we could not tell"); a bare `R` is not folded into `REP` because a
 *     single-letter code is an inference, and inferring a party is the failure mode this module
 *     exists to prevent.
 *
 * KNOWN CEILING, stated rather than hidden: codes with no label below (`DCG`, `R`, `UN` when it
 * survives) render as their raw code. A raw code is ugly; a WRONG label is a false claim. This
 * file always chooses ugly.
 *
 * THE SUM IS THE INVARIANT. Normalising must never drop, invent or round money — the amounts out
 * always total the amounts in, and `party-breakdown.test.ts` pins exactly that.
 */

/** Display labels for FEC party codes we can name with confidence. */
const PARTY_LABELS: Record<string, string> = {
  DEM: "Democratic",
  REP: "Republican",
  IND: "Independent",
  LIB: "Libertarian",
  GRE: "Green",
  DFL: "Democratic–Farmer–Labor",
  NAT: "Natural Law",
  OTH: "Other",
  NNE: "No party listed",
  Unknown: "Unknown",
  "PAC/Other": "PACs & other committees",
};

/** Keys that assert no party, and so may be folded together without claiming anything. */
const NO_PARTY_ALIASES = new Set(["unknown", "unk", "un"]);

/** Buckets that name no party, so they can never be someone's "lean". */
const NOT_A_LEAN = new Set(["Unknown", "PAC/Other", "NNE"]);

export interface PartyBucket {
  /** Canonical key after folding — the raw code for anything unrecognised. */
  code: string;
  /** Human label, or the raw code when we cannot name it with confidence. */
  label: string;
  amount: number;
}

/**
 * Fold a stored `partyBreakdown` into display buckets, largest first.
 * Total is preserved exactly; no bucket is ever dropped.
 */
/**
 * The canonical bucket a raw stored key folds into — the merge policy above, as one function.
 * Exported so a consumer that needs the GROUPING (which raw keys became one bucket) reads the same
 * policy rather than re-deriving it: `party-prose.ts` accepts prose that states either a group's
 * merged amount or all of its members' amounts, and it can only do that if both files agree on
 * what a group IS.
 */
export function partyBucketCode(rawKey: string): string {
  const lower = rawKey.trim().toLowerCase();
  if (NO_PARTY_ALIASES.has(lower)) return "Unknown";
  if (lower === "pac/other") return "PAC/Other";
  // A three-letter FEC code, case-folded: this is where DEM/Dem and REP/Rep meet.
  if (/^[a-z]{3}$/.test(lower)) return lower.toUpperCase();
  return rawKey.trim();
}

export function normalizePartyBreakdown(
  breakdown: Record<string, number> | null | undefined,
): PartyBucket[] {
  if (!breakdown) return [];

  const merged = new Map<string, number>();
  for (const [rawKey, rawAmount] of Object.entries(breakdown)) {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount)) continue;

    merged.set(partyBucketCode(rawKey), (merged.get(partyBucketCode(rawKey)) ?? 0) + amount);
  }

  return [...merged.entries()]
    .map(([code, amount]) => ({ code, label: PARTY_LABELS[code] ?? code, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * The party a person's giving actually leans toward, as a HUMAN LABEL — or null when no bucket
 * names a party. Folds first, so a party split across two stored keys is compared whole.
 */
export function topPartyLabel(
  breakdown: Record<string, number> | null | undefined,
): string | null {
  const leaning = normalizePartyBreakdown(breakdown).filter(
    (b) => !NOT_A_LEAN.has(b.code) && b.amount > 0,
  );
  return leaning.length > 0 ? leaning[0].label : null;
}
