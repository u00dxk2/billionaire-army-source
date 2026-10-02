/**
 * Public Benefit Score (PBS) v2 — scoring + grading, shared by the jobs scorer
 * (which computes + stores it) and the web app (which grades + displays it).
 *
 * Scored on a 0–100 scale from the data we actually have populated. v1 weighted
 * five components, three of which were hardcoded placeholders (goalImpact=0,
 * controversyInv=0.7, approval=0.5) that crushed every score to ~0.5 — and it
 * stored 0–1 while the grade bands checked 0–100, so everyone graded F. v2 drops
 * the dead weights and scores from two real, populated signals, reweighted to
 * sum to 100%. See docs/PBS_METHODOLOGY.md for the full rationale + limitations.
 */

import type { PbsFeatures } from "./schemas";

export const PBS_VERSION = "v2";

/** Top-level component weights (sum to 1). */
export const PBS_WEIGHTS = {
  philanthropy: 0.65,
  transparency: 0.35,
} as const;

export interface PbsSignals {
  /** Net worth in USD, or null if unknown. */
  netWorth: number | null;
  /** Total charitable-foundation assets in USD (sum across 990s), 0 if none. */
  foundationAssets: number;
  /** Annual charitable disbursement in USD (money given OUT, sum across 990s), 0 if none. */
  foundationGiving: number;
  /**
   * Annualized documented direct giving in USD (LLC / DAF / direct gifts that
   * leave no 990 to read), 0 if none. R-007 — feeds generosity as the larger of
   * this and foundationGiving, so direct-only givers (e.g. MacKenzie Scott) are
   * no longer scored as if they gave nothing.
   */
  directGivingAnnual: number;
  /** Signed The Giving Pledge (public commitment to give away the majority of wealth). */
  givingPledge: boolean;
  /** Count of distinct public-accountability data sources on file (incl. a profile image). */
  sourceCount: number;
}

export interface PbsResult {
  pbs: number; // 0..100
  features: PbsFeatures; // shape defined by pbsFeaturesSchema in ./schemas
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

/**
 * Compute the 0–100 PBS from populated signals.
 *
 * Philanthropy (65%) = 0.15·pledge + 0.65·generosity + 0.2·scale
 *   Built on actual GIVING (annual charitable disbursement), not parked assets —
 *   a foundation you don't disburse from no longer scores. Generosity dominates:
 *   actions speak louder than pledges (the owner, 2026-06-16), and it's the share of
 *   your fortune you give, not the headline number. A signatory who gives little
 *   relative to wealth (e.g. Musk, 0.03% ratio) lands mid-pack despite a sizeable
 *   absolute gift; the pledge itself is only a small nudge.
 *   - generosity: annual giving ÷ net worth, log-curved (proportional giving) — 65%
 *   - scale: absolute annual giving, log-scaled ($1M → 0, $10B → 1) — 20%
 *   - pledge: signed The Giving Pledge (public commitment — a small nudge only) — 15%
 * Transparency (35%) = distinct public-accountability sources / 8 (capped at 1)
 *
 * "Annual giving" is the LARGER of annual 990 disbursement and annualized
 * documented direct giving (R-007) — the max avoids double-counting anyone who
 * gives through BOTH a foundation and directly, while crediting direct-only
 * givers (LLC/DAF/direct gifts leave no 990) the scorer used to score as zero.
 */
export function computePbs(s: PbsSignals): PbsResult {
  const annualGiving = Math.max(s.foundationGiving, s.directGivingAnnual);
  const ratio =
    s.netWorth && s.netWorth > 0 && annualGiving > 0
      ? annualGiving / s.netWorth
      : 0;
  const generosity = ratio > 0 ? clamp(Math.log10(1 + ratio * 5000) / 3) : 0;
  const scale =
    annualGiving > 0 ? clamp((Math.log10(annualGiving) - 6) / 4) : 0;
  const pledge = s.givingPledge ? 1 : 0;
  const philanthropy = clamp(0.15 * pledge + 0.65 * generosity + 0.2 * scale);
  const transparency = clamp(s.sourceCount / 8);

  const raw =
    100 *
    (PBS_WEIGHTS.philanthropy * philanthropy +
      PBS_WEIGHTS.transparency * transparency);
  const pbs = Math.round(raw * 100) / 100;

  return {
    pbs,
    features: {
      philanthropy,
      transparency,
      pledge,
      generosity,
      scale,
      sourceCount: s.sourceCount,
      directGiving: s.directGivingAnnual,
    },
  };
}

/**
 * Grade bands, calibrated 2026-06-16 against the real population spread.
 * Colors darkened 2026-08-05 (design-detector sweep): each band color renders
 * BOTH as a white-text circle background (profile/leaderboard grades) and as
 * colored letter text on the #f5f6f8 feed nugget, so every one must clear
 * 4.5:1 in both directions. Verified: B 4.93/4.56, C 5.54/5.12, D 6.31/5.83
 * (white-on-color / color-on-#f5f6f8); A + F inherit the darkened brand vars.
 */
export const PBS_GRADE_BANDS = [
  { min: 60, letter: "A", color: "var(--color-accent-green)" },
  { min: 45, letter: "B", color: "#2a7d6f" },
  { min: 30, letter: "C", color: "#8a6100" },
  { min: 15, letter: "D", color: "#b02a5b" },
  { min: 0, letter: "F", color: "var(--color-accent)" },
] as const;

export function pbsGrade(pbs: number): { letter: string; color: string } {
  for (const b of PBS_GRADE_BANDS) {
    if (pbs >= b.min) return { letter: b.letter, color: b.color };
  }
  return { letter: "F", color: "var(--color-accent)" };
}

/**
 * The concrete hex behind each CSS custom property used by the grade bands.
 * Mirrors `globals.css` — keep in sync if a brand colour changes there.
 */
const CSS_VAR_HEX: Record<string, string> = {
  "var(--color-accent-green)": "#1f7a3f",
  "var(--color-accent)": "#bd3a27",
};

/**
 * Grade colour as a literal hex, for renderers with no CSS-variable support.
 *
 * `pbsGrade()` returns two of its five band colours as `var(--color-*)`, which
 * resolves fine in the browser and NOT AT ALL in Satori (the engine behind the
 * OG-image `ImageResponse`) — there an unresolved `var(...)` silently renders as
 * transparent/black, so an A and an F would both lose their colour, in an image
 * whose entire job is the wealth↔giving contrast. Always use this in an image,
 * PDF, or email context; keep using `pbsGrade()` for the DOM, where the variable
 * is the point (it themes).
 */
export function pbsGradeHex(pbs: number): { letter: string; hex: string } {
  const { letter, color } = pbsGrade(pbs);
  return { letter, hex: CSS_VAR_HEX[color] ?? color };
}
