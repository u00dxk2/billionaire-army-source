import { test } from "node:test";
import assert from "node:assert/strict";
import { computePbs, pbsGrade, pbsGradeHex, PBS_GRADE_BANDS, type PbsSignals } from "./pbs";

const baseSignals: PbsSignals = {
  netWorth: null,
  foundationAssets: 0,
  foundationGiving: 0,
  directGivingAnnual: 0,
  givingPledge: false,
  sourceCount: 0,
};

test("pbsGrade — band boundaries (calibrated 2026-06-16)", () => {
  assert.equal(pbsGrade(100).letter, "A");
  assert.equal(pbsGrade(60).letter, "A");
  assert.equal(pbsGrade(59.99).letter, "B");
  assert.equal(pbsGrade(45).letter, "B");
  assert.equal(pbsGrade(44.99).letter, "C");
  assert.equal(pbsGrade(30).letter, "C");
  assert.equal(pbsGrade(29.99).letter, "D");
  assert.equal(pbsGrade(15).letter, "D");
  assert.equal(pbsGrade(14.99).letter, "F");
  assert.equal(pbsGrade(0).letter, "F");
  assert.equal(pbsGrade(-5).letter, "F");
});

test("computePbs — all-zero signals score 0 with no NaN/Infinity", () => {
  const { pbs, features } = computePbs(baseSignals);
  assert.equal(pbs, 0);
  assert.equal(features.philanthropy, 0);
  assert.equal(features.transparency, 0);
});

test("computePbs — zero or missing net worth never divides by zero", () => {
  const zeroNetWorth = computePbs({ ...baseSignals, netWorth: 0, foundationGiving: 1_000_000 });
  const nullNetWorth = computePbs({ ...baseSignals, netWorth: null, foundationGiving: 1_000_000 });
  assert.equal(zeroNetWorth.features.generosity, 0);
  assert.equal(nullNetWorth.features.generosity, 0);
  assert.ok(Number.isFinite(zeroNetWorth.pbs));
  assert.ok(Number.isFinite(nullNetWorth.pbs));
});

test("computePbs — Giving Pledge alone is a small nudge, not a big score mover", () => {
  const { pbs } = computePbs({ ...baseSignals, givingPledge: true });
  // 0.15 pledge weight * 65% philanthropy weight = 9.75% of 100 at most.
  assert.ok(pbs > 0, "pledge should move the score off zero");
  assert.ok(pbs < 10, `pledge-only score should stay a small nudge, got ${pbs}`);
});

test("computePbs — sourceCount transparency caps at 8 sources", () => {
  const capped = computePbs({ ...baseSignals, sourceCount: 8 });
  const overCapped = computePbs({ ...baseSignals, sourceCount: 20 });
  assert.equal(capped.features.transparency, 1);
  assert.equal(overCapped.features.transparency, 1);
});

test("computePbs — direct giving (R-007) counts even with no foundation 990", () => {
  const directOnly = computePbs({
    ...baseSignals,
    netWorth: 100_000_000_000,
    foundationGiving: 0,
    directGivingAnnual: 5_000_000_000,
  });
  assert.ok(directOnly.pbs > 0, "a direct-only giver (e.g. MacKenzie Scott) must not score as if they gave nothing");
  assert.equal(directOnly.features.directGiving, 5_000_000_000);
});

test("computePbs — annual giving is the MAX of foundation and direct, not the sum (no double-count)", () => {
  const viaMax = computePbs({
    ...baseSignals,
    netWorth: 100_000_000_000,
    foundationGiving: 3_000_000_000,
    directGivingAnnual: 5_000_000_000,
  });
  const viaLargerAlone = computePbs({
    ...baseSignals,
    netWorth: 100_000_000_000,
    foundationGiving: 5_000_000_000,
    directGivingAnnual: 0,
  });
  assert.equal(viaMax.pbs, viaLargerAlone.pbs);
});

test("computePbs — higher generosity ratio (giving relative to net worth) scores higher, all else equal", () => {
  const lowRatio = computePbs({
    ...baseSignals,
    netWorth: 200_000_000_000,
    foundationGiving: 100_000_000,
  });
  const highRatio = computePbs({
    ...baseSignals,
    netWorth: 10_000_000_000,
    foundationGiving: 100_000_000,
  });
  assert.ok(highRatio.pbs > lowRatio.pbs);
});

// pbsGradeHex — the OG image (Satori) cannot resolve CSS custom properties, so
// every band must come back as a literal colour. A regression here is invisible
// in the DOM and only shows up as a colourless grade badge in a shared link.
test("pbsGradeHex — every grade band resolves to a literal hex, never a CSS var", () => {
  for (const band of PBS_GRADE_BANDS) {
    const { hex } = pbsGradeHex(band.min);
    assert.ok(
      /^#[0-9a-fA-F]{3,8}$/.test(hex),
      `band ${band.letter} resolved to "${hex}", which is not a hex colour`
    );
    assert.ok(!hex.includes("var("), `band ${band.letter} leaked a CSS variable`);
  }
});

test("pbsGradeHex — letter always matches pbsGrade, only the colour differs", () => {
  for (const score of [0, 14, 15, 29, 30, 44, 45, 59, 60, 100]) {
    assert.equal(pbsGradeHex(score).letter, pbsGrade(score).letter);
  }
});

test("pbsGradeHex — the two CSS-var bands (A and F) map to their brand hexes", () => {
  assert.equal(pbsGradeHex(75).hex, "#1f7a3f"); // A — accent green (darkened 2026-08-05)
  assert.equal(pbsGradeHex(5).hex, "#bd3a27"); // F — accent red (darkened 2026-08-05)
});

test("pbsGradeHex — bands already written as hex pass through unchanged", () => {
  assert.equal(pbsGradeHex(50).hex, "#2a7d6f"); // B
  assert.equal(pbsGradeHex(35).hex, "#8a6100"); // C
  assert.equal(pbsGradeHex(20).hex, "#b02a5b"); // D
});
