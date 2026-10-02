import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OG_CANVAS_WIDTH,
  NARROWEST_UNFURL_WIDTH,
  MIN_LEGIBLE_UNFURL_PX,
  effectiveUnfurlPx,
  survivesUnfurl,
  OG_FEED_TYPE,
} from "./og-legibility";
// Namespace import so the sweep below can discover type scales by SHAPE rather than
// by a hand-kept list — see typeScales().
import * as mod from "./og-legibility";

// The control this file exists to be (R-044, 2026-07-27). The defect it guards
// shipped past typecheck, 80 passing tests and a green production build, because
// none of those look at the artifact at the size a human reads it.

test("effectiveUnfurlPx — scales by the ratio the client actually renders at", () => {
  assert.equal(effectiveUnfurlPx(OG_CANVAS_WIDTH), NARROWEST_UNFURL_WIDTH);
  assert.equal(effectiveUnfurlPx(24, 600), 12);
  assert.equal(effectiveUnfurlPx(0), 0);
});

test("effectiveUnfurlPx — a wider unfurl is more forgiving than the narrow default", () => {
  assert.ok(effectiveUnfurlPx(24, 500) > effectiveUnfurlPx(24, 250));
});

// The regression itself, pinned to the two REAL observations from the build:
// 17px was confirmed illegible in a downscaled render; 24px was confirmed legible
// at both 300px and 500px. If someone re-tunes the threshold so these stop
// separating, that is the signal the calibration has drifted off its evidence.
test("survivesUnfurl — the exact 17px label that vanished FAILS", () => {
  assert.equal(survivesUnfurl(17), false);
  assert.ok(effectiveUnfurlPx(17) < MIN_LEGIBLE_UNFURL_PX);
});

test("survivesUnfurl — the 24px replacement PASSES", () => {
  assert.equal(survivesUnfurl(24), true);
});

/**
 * Every type scale this module exports, discovered STRUCTURALLY rather than listed.
 *
 * Why not a hand-kept list: until 2026-09-07 the sweep below iterated OG_FEED_TYPE
 * by name, so when the profile image needed its own scale the honest options were
 * to reuse the feed's numbers or to add a second scale the test did not look at —
 * and the second is this module's own documented trap ("a test over a second copy
 * of the numbers guards nothing"). Shape-matching the exports closes it: a third
 * scale added tomorrow is swept the moment it is exported, with nothing to
 * remember and no registry to fall out of date.
 */
function typeScales(): [string, Record<string, { px: number; loadBearing: boolean }>][] {
  const isScale = (v: unknown): v is Record<string, { px: number; loadBearing: boolean }> =>
    typeof v === "object" &&
    v !== null &&
    Object.values(v).length > 0 &&
    Object.values(v).every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as { px?: unknown }).px === "number" &&
        typeof (e as { loadBearing?: unknown }).loadBearing === "boolean"
    );
  return Object.entries(mod).filter(([, v]) => isScale(v)) as [
    string,
    Record<string, { px: number; loadBearing: boolean }>,
  ][];
}

test("the structural sweep actually finds the scales — denominator, not a silent empty set", () => {
  const found = typeScales().map(([name]) => name).sort();
  // An empty or shrinking set is the false-clean shape: the sweep below would pass
  // over nothing and report success. Name the scales so a REMOVAL is also visible.
  assert.ok(
    found.length >= 2,
    `expected at least the feed and profile scales, found: ${found.join(", ") || "(none)"}`
  );
  assert.ok(found.includes("OG_FEED_TYPE"), `feed scale missing from sweep, got: ${found.join(", ")}`);
  assert.ok(found.includes("OG_PROFILE_TYPE"), `profile scale missing from sweep, got: ${found.join(", ")}`);
});

test("every LOAD-BEARING element of EVERY OG type scale survives the narrowest unfurl", () => {
  for (const [scaleName, scale] of typeScales()) {
    for (const [name, spec] of Object.entries(scale)) {
      if (!spec.loadBearing) continue;
      assert.ok(
        survivesUnfurl(spec.px),
        `${scaleName}.${name} at ${spec.px}px renders ~${effectiveUnfurlPx(spec.px).toFixed(1)}px ` +
          `at a ${NARROWEST_UNFURL_WIDTH}px unfurl, below the ${MIN_LEGIBLE_UNFURL_PX}px floor. ` +
          `An element marked loadBearing changes what the card MEANS when it disappears — ` +
          `either raise the size or justify demoting it.`
      );
    }
  }
});

// R-041 again, on every scale that renders a grade. The feed-specific version below
// stays as the named regression; this generalises it so a new image cannot ship a
// grade letter with no legible qualifier.
test("R-041 — every scale carrying a grade marks its GIVING label load-bearing and legible", () => {
  for (const [scaleName, scale] of typeScales()) {
    if (!("gradeLetter" in scale)) continue;
    assert.ok(
      "gradeLabel" in scale,
      `${scaleName} sizes a grade letter but no gradeLabel — a bare letter beside a named ` +
        `living person reads as a verdict on them (R-041).`
    );
    assert.equal(scale.gradeLabel.loadBearing, true, `${scaleName}.gradeLabel must be load-bearing`);
    assert.ok(survivesUnfurl(scale.gradeLabel.px), `${scaleName}.gradeLabel must survive the unfurl`);
    assert.ok(
      scale.gradeLetter.px > scale.gradeLabel.px,
      `${scaleName}: the grade letter must not be smaller than the label that qualifies it`
    );
  }
});

// R-041 gets its own named test rather than relying on the sweep above, because
// this is the one whose failure is defamatory rather than untidy: with the label
// gone, a bare grade letter beside a controversy card reads as the platform's
// overall verdict on a named person.
test("R-041 — the GIVING label is load-bearing and legible in a real unfurl", () => {
  assert.equal(OG_FEED_TYPE.gradeLabel.loadBearing, true);
  assert.ok(survivesUnfurl(OG_FEED_TYPE.gradeLabel.px));
});

test("the grade letter is never smaller than the label that qualifies it", () => {
  assert.ok(OG_FEED_TYPE.gradeLetter.px > OG_FEED_TYPE.gradeLabel.px);
});
