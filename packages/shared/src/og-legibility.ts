/**
 * Type scale for the OG share images, plus the check that keeps it legible where
 * it is actually READ.
 *
 * Why this module exists (R-044, 2026-07-27): an OG image is authored on a
 * 1200x630 canvas and consumed at roughly 250-500px inside a messaging client.
 * At that reduction, type that looks correctly subordinate on the canvas can fall
 * below legibility entirely. The `GIVING` label shipped at 17px, which lands at
 * ~3.5px in a worst-case mobile unfurl — it vanished, leaving a bare grade letter.
 *
 * That is not cosmetic. The label is the ENTIRE mitigation for R-041: beside a
 * political or controversy card, a lone grade letter reads as the platform's
 * overall verdict on a named person and exonerates the card meant to indict.
 * Typecheck, the full test suite, and a production build were all green while
 * that was true, because nothing we run looks at an artifact at human scale.
 *
 * So the numbers live here rather than inline in the image, and a test asserts
 * the load-bearing ones survive the downscale. **The image must IMPORT these** —
 * a test over a second copy of the numbers guards nothing.
 */

/** Width the OG image is authored at. */
export const OG_CANVAS_WIDTH = 1200;

/**
 * Worst-case width a messaging client renders an OG card at. Mobile iMessage /
 * WhatsApp sit near here; an X timeline card is roughly double, so this is the
 * conservative end of the observed range and the right one to design against.
 */
export const NARROWEST_UNFURL_WIDTH = 250;

/**
 * Floor, in rendered pixels, below which text stops being readable and becomes
 * texture.
 *
 * Calibrated against the two real data points from the R-044 build rather than
 * picked from theory: 17px on the canvas (≈3.5px here) was confirmed illegible,
 * and 24px (≈5.0px here) was confirmed legible in downscaled renders at both
 * 300px and 500px. 4.5 is the separating value. It is a heuristic, not a
 * perceptual constant — treat it as "this much smaller than a known-good value
 * is known-bad", and re-derive it if the typeface or letter-spacing changes.
 */
export const MIN_LEGIBLE_UNFURL_PX = 4.5;

/** What a canvas-sized glyph actually measures once the client scales the card down. */
export function effectiveUnfurlPx(
  canvasPx: number,
  unfurlWidth: number = NARROWEST_UNFURL_WIDTH
): number {
  return (canvasPx * unfurlWidth) / OG_CANVAS_WIDTH;
}

/** Does this canvas size still read at the narrowest width a client will use? */
export function survivesUnfurl(
  canvasPx: number,
  unfurlWidth: number = NARROWEST_UNFURL_WIDTH
): boolean {
  return effectiveUnfurlPx(canvasPx, unfurlWidth) >= MIN_LEGIBLE_UNFURL_PX;
}

/**
 * The per-card image's type scale.
 *
 * `loadBearing` marks the elements whose disappearance changes what the card
 * MEANS, as opposed to how polished it looks. Those are the ones the test holds
 * to `survivesUnfurl`. Decorative or secondary text is allowed to soften at
 * thumbnail scale — the source line going quiet costs a reader nothing; the
 * grade label going quiet libels someone.
 */
export const OG_FEED_TYPE = {
  /** Grade letter — the verdict itself. */
  gradeLetter: { px: 52, loadBearing: true },
  /**
   * "GIVING <n>" — R-041's mitigation. Deliberately larger than its visual
   * weight on the full canvas warrants, because it is sized for the unfurl.
   * Do NOT reduce this to "balance" the composition.
   */
  gradeLabel: { px: 24, loadBearing: true },
  /** Who the card is about. */
  personName: { px: 40, loadBearing: true },
  /** The wealth half of the wealth-vs-giving contrast. */
  netWorth: { px: 34, loadBearing: true },
  /** The claim. */
  headline: { px: 40, loadBearing: true },
  /** Section label above the net-worth figure. */
  netWorthLabel: { px: 21, loadBearing: false },
  /** Wordmark — recognisable by shape and colour even when unreadable. */
  wordmark: { px: 26, loadBearing: false },
  /** Category chip. */
  category: { px: 22, loadBearing: false },
  /** Provenance line. */
  provenance: { px: 22, loadBearing: false },
} as const satisfies Record<string, { px: number; loadBearing: boolean }>;

/**
 * The per-PERSON profile image's type scale (Flow 4 Cycle 10 Finding 3, shipped
 * Cycle 15 on 2026-09-07).
 *
 * A separate scale rather than a reuse of OG_FEED_TYPE, because the two images
 * carry different content: the feed card spends its middle band on a headline,
 * so the name is subordinate to the claim. The profile has no claim — the person
 * IS the subject — so the name and the wealth-vs-giving pair are the whole
 * composition and are sized up accordingly.
 *
 * Same load-bearing rule as the feed scale, and the same reason: R-041 says a
 * bare grade letter beside a named living person reads as a verdict on them, so
 * the qualifying label must survive the downscale or the image libels someone.
 * The sweep in the test file picks this up STRUCTURALLY — it walks every exported
 * scale, so a third scale added later is guarded without anyone remembering to
 * register it.
 */
export const OG_PROFILE_TYPE = {
  /** Grade letter — the verdict itself. */
  gradeLetter: { px: 60, loadBearing: true },
  /** "GIVING <n>" — R-041's mitigation. Never let this fall below the floor. */
  gradeLabel: { px: 26, loadBearing: true },
  /** Whose profile this is. The subject of the whole image. */
  personName: { px: 56, loadBearing: true },
  /** The wealth half of the wealth-vs-giving contrast. */
  netWorth: { px: 40, loadBearing: true },
  /** Section label above the net-worth figure. */
  netWorthLabel: { px: 21, loadBearing: false },
  /** Wordmark — recognisable by shape and colour even when unreadable. */
  wordmark: { px: 26, loadBearing: false },
  /** Industry / home-state chip. */
  meta: { px: 22, loadBearing: false },
  /** Standing promise line along the bottom. */
  provenance: { px: 22, loadBearing: false },
} as const satisfies Record<string, { px: number; loadBearing: boolean }>;
