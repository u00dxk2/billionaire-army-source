/**
 * B-030 — collapse a foundation counted together with its own ENDOWMENT VEHICLE.
 *
 * THE DEFECT. `propublica-990.ts` sums `foundations[]` with a bare reduce, so when the index holds
 * both a grantmaker and the trust that funds it, the same pile of money is counted twice. Measured
 * 2026-08-12 across all 1,102 indexed persons: **3** carry the pattern.
 *
 *   Melinda French Gates / Bill Gates
 *     Gates Foundation        $76.95B assets / $7.79B grants
 *     Gates Foundation Trust  $75.53B assets / $6.71B grants   <- the endowment that funds the above
 *     published total        $152.48B assets / $14.50B grants  <- roughly 2x
 *   Gary Michelson
 *     Michelson Foundation Charitable Trust, against Michelson Foundation ($15.7M -> $15.3M)
 *
 * That doubled figure was live as a bare `$152.5B / Foundation Assets` stat tile on
 * billionaire.army. The written summary was hedged ("across the listed entities"); the tile was not,
 * so it read as the size of her foundation. **The owner ruled 2026-08-12: exclude endowment trusts from
 * the total, keep the trust in the detailed breakdown.** This module is the total-side half; the
 * breakdown keeps every entity, which is why nothing here mutates or drops the stored array.
 *
 * WHY THIS LIVES IN @ba/shared. Three consumers aggregate these rows independently — `pbs-signals.ts`
 * (the score), `routes/persons.ts` (the profile surface), and the B-030 probe. Same rule as
 * `accountabilityScore` and `eventSignature`: ONE copy, or the score and the display drift and only
 * one of them gets fixed next time.
 *
 * DELIBERATELY NARROW, AND THE ASYMMETRY IS THE POINT. The suffix list is a short closed set of the
 * shape actually observed. An over-broad rule would collapse genuinely separate foundations and
 * UNDERSTATE giving — and on a platform whose thesis is that no claim outruns its citation, inventing
 * a reason to deny someone's real philanthropy is the worse error. B-021 is the precedent: five
 * candidate attribution rules each looked obviously right and were wrong on live data, and one would
 * have deleted $5.29B of correct giving to remove ~$1M of wrong.
 *
 * NOT AN ATTRIBUTION RULE. Both entities in every pair here are CORRECTLY attributed to the person.
 * This is arithmetic over correct attributions, which is why it is kept out of
 * `isPlausiblyOwnFoundation()` (B-020/B-021) — folding it in would contaminate a rule tuned against
 * prod data five times over.
 */

export interface FoundationLike {
  name?: unknown;
  totalAssets?: unknown;
  grantsPaid?: unknown;
  /** legacy field name kept for older stored facts */
  totalGrants?: unknown;
}

/**
 * Suffixes that mark an endowment vehicle OF another entity, rather than an independent grantmaker.
 * Extending this list is a calibration decision, not a typo fix: re-run
 * `npm run check:plausibility` against the full population first.
 */
const ENDOWMENT_SUFFIXES = ["trust", "endowment", "endowment trust", "charitable trust", "trust fund"];

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Indexes of foundations that are an endowment vehicle of ANOTHER entity in the same list.
 *
 * The test is PREFIX + KNOWN SUFFIX, never substring: "Gates Foundation Trust" is a vehicle of
 * "Gates Foundation", while "Kaiser Foundation Health Plan Trust" is not a vehicle of "Kaiser
 * Foundation" (its remainder is not an endowment suffix) and "Ford Motor Company Fund" is not a
 * vehicle of "Ford Foundation" at all.
 */
export function findEndowmentDoubleCounts(founds: FoundationLike[]): number[] {
  const names = founds.map((f) => norm(f.name));
  const dupes: number[] = [];
  for (let i = 0; i < founds.length; i++) {
    for (let j = 0; j < founds.length; j++) {
      if (i === j) continue;
      const child = names[i];
      const parent = names[j];
      if (!child || !parent || child.length <= parent.length) continue;
      if (!child.startsWith(parent + " ")) continue;
      const remainder = child.slice(parent.length).trim();
      if (ENDOWMENT_SUFFIXES.includes(remainder)) {
        dupes.push(i);
        break;
      }
    }
  }
  return dupes;
}

/** The same list with endowment vehicles removed. Non-mutating — the breakdown keeps every entity. */
export function collapseEndowmentVehicles<T extends FoundationLike>(founds: T[]): T[] {
  const dupes = new Set(findEndowmentDoubleCounts(founds));
  return founds.filter((_, i) => !dupes.has(i));
}

/**
 * Collapsed totals for a stored `philanthropy/foundation_990s` fact value.
 *
 * IT IGNORES THE STORED `totalFoundationAssets` / `totalGrantsPaid` WHENEVER `foundations[]` EXISTS,
 * and that is the whole fix rather than an optimisation. Those two top-level fields ARE the
 * un-collapsed sums written by the fetcher, so any code path that "prefers the authoritative
 * top-level sum" re-publishes the doubled number. Both consumers used to do exactly that. The stored
 * sums remain the only fallback for older facts that carry no array.
 */
/**
 * The "$152.5B in foundation assets" chip string, built from the COLLAPSED total.
 *
 * It lives here, beside the collapse, because the curator and `GET /api/feed` both need the exact
 * same string and a second copy of the formatting is how the numbers drift apart. The curator writes
 * it into `contextData` at publish time; the API rebuilds it live so the ~150 cards published before
 * this fix stop showing the doubled figure without a prod data write.
 *
 * Returns null below $1M — a "$0M in foundation assets" chip asserts something about a named living
 * person that we have not established.
 */
export function foundationAssetsChip(fv: unknown): string | null {
  const { totalAssets } = foundationTotals(fv);
  if (totalAssets >= 1e9) return `$${(totalAssets / 1e9).toFixed(1)}B in foundation assets`;
  if (totalAssets >= 1e6) return `$${(totalAssets / 1e6).toFixed(0)}M in foundation assets`;
  return null;
}

export function foundationTotals(fv: unknown): { totalAssets: number; totalGrants: number } {
  const v = fv as {
    foundations?: FoundationLike[];
    totalFoundationAssets?: unknown;
    totalGrantsPaid?: unknown;
  };
  const founds = Array.isArray(v?.foundations) ? v.foundations : null;

  if (!founds || founds.length === 0) {
    return {
      totalAssets: Number(v?.totalFoundationAssets) || 0,
      totalGrants: Number(v?.totalGrantsPaid) || 0,
    };
  }

  let totalAssets = 0;
  let totalGrants = 0;
  for (const f of collapseEndowmentVehicles(founds)) {
    totalAssets += Number(f.totalAssets) || 0;
    totalGrants += Number(f.grantsPaid ?? f.totalGrants) || 0;
  }
  return { totalAssets, totalGrants };
}

/**
 * The UN-COLLAPSED sums as the 990 fetcher stored them — i.e. the doubled figure B-030 fixed.
 *
 * Read straight off the stored top-level fields; deliberately NOT a sum over `foundations[]`.
 * Re-summing here would be a fourth hand-rolled aggregation of exactly the shape the B-030 fork
 * guard exists to catch (KP-7), and it is unnecessary — the fetcher already wrote the number.
 */
export function storedFoundationTotals(fv: unknown): { totalAssets: number; totalGrants: number } {
  const v = fv as { totalFoundationAssets?: unknown; totalGrantsPaid?: unknown };
  return {
    totalAssets: Number(v?.totalFoundationAssets) || 0,
    totalGrants: Number(v?.totalGrantsPaid) || 0,
  };
}

/** `$152.5 billion` / `$152.5B` / `$540 million` / `$540M` — a money figure written in prose. */
const PROSE_MONEY_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(billion|million|B|M)\b/gi;

const UNIT_SCALE: Record<string, number> = { billion: 1e9, b: 1e9, million: 1e6, m: 1e6 };

/** Re-render `value` in the same unit and shape the author wrote, so only the digits change. */
function inSameUnit(value: number, unit: string): string {
  const u = unit.toLowerCase();
  if (u === "billion") return `$${(value / 1e9).toFixed(1)} billion`;
  if (u === "b") return `$${(value / 1e9).toFixed(1)}B`;
  if (u === "million") return `$${(value / 1e6).toFixed(0)} million`;
  return `$${(value / 1e6).toFixed(0)}M`;
}

/**
 * B-030 residual — repair a DOUBLED foundation figure frozen into published PROSE.
 *
 * `foundationAssetsChip()` fixed the context chip at render time, but ~150 cards were published
 * with the doubled number also written into the GPT-authored `summary` sentence, which no live
 * rebuild touches. Measured on prod 2026-08-21: FIVE cards in the served 40 read
 * "the foundation's reported assets total about $152.5 billion" while the repaired chip beside
 * them on the SAME card read "$77.0B in foundation assets". A card that contradicts itself about a
 * named living person is the opposite of the receipt this feed exists to deliver.
 *
 * WHAT THIS IS AND IS NOT. It corrects OUR OWN arithmetic inside OUR OWN sentence — the figure was
 * never quoted from the source, it was this system summing a foundation together with its own
 * endowment trust. It is not a rewrite of the source's claim, and it changes no stored row: same
 * render-time posture as the chip, so it is reversible by reverting one import.
 *
 * DELIBERATELY NARROW. A figure is replaced ONLY when it matches THAT person's own stored
 * un-collapsed total to within 0.5% — so a net worth ("$29 billion"), a grant size ("$540 million")
 * or any unrelated number is left untouched, and a person whose fact carries no `foundations[]`
 * array (nothing to collapse) is a no-op. Pinned in both directions in the test file.
 */
export function repairFoundationProse(text: string, fv: unknown): string {
  if (typeof text !== "string" || text.length === 0) return text;

  const v = fv as { foundations?: unknown };
  // No array means `foundationTotals()` falls back to the stored sums — they ARE the collapsed
  // answer, and there is nothing to repair. Bail before touching a word.
  if (!Array.isArray(v?.foundations) || v.foundations.length === 0) return text;

  const collapsed = foundationTotals(fv);
  const stored = storedFoundationTotals(fv);

  // Each pair is "a number the old code published" -> "the number it should have been".
  const repairs: Array<{ wrong: number; right: number }> = [];
  for (const key of ["totalAssets", "totalGrants"] as const) {
    const wrong = stored[key];
    const right = collapsed[key];
    if (wrong > 0 && right > 0 && Math.abs(wrong - right) / wrong > 0.01) {
      repairs.push({ wrong, right });
    }
  }
  if (repairs.length === 0) return text;

  return text.replace(PROSE_MONEY_RE, (whole, digits: string, unit: string) => {
    const scale = UNIT_SCALE[unit.toLowerCase()];
    if (!scale) return whole;
    const written = Number(String(digits).replace(/,/g, "")) * scale;
    if (!Number.isFinite(written) || written <= 0) return whole;

    for (const { wrong, right } of repairs) {
      if (Math.abs(written - wrong) / wrong <= 0.005) return inSameUnit(right, unit);
    }
    return whole;
  });
}
