import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findEndowmentDoubleCounts,
  collapseEndowmentVehicles,
  foundationTotals,
  foundationAssetsChip,
} from "./foundation-endowment";

/**
 * B-030. The rule is deliberately asymmetric: it must catch the endowment vehicle that
 * double-counts its parent's money, and it must NOT collapse two genuinely separate
 * foundations — because a false collapse UNDERSTATES giving, and inventing a reason to deny
 * someone's real philanthropy is the worse error on this platform.
 */

// The live 2026-08-12 fact, verbatim from prod.
const GATES = [
  { name: "Gates Foundation", totalAssets: 76951451400, grantsPaid: 7793604635 },
  { name: "Gates Foundation Trust", totalAssets: 75530745576, grantsPaid: 6708165714 },
  { name: "Gates Foundation", totalAssets: 1227735, grantsPaid: 70868 },
];

test("the live case: Gates Foundation Trust is an endowment vehicle of Gates Foundation", () => {
  // Index 1 only. The Michigan same-name row (index 2) is a B-021 attribution question,
  // NOT a double-count, and this rule must not claim it.
  assert.deepEqual(findEndowmentDoubleCounts(GATES), [1]);
});

test("two separate foundations sharing a surname are NOT a pair", () => {
  const founds = [
    { name: "Ford Foundation", totalAssets: 16000000000, grantsPaid: 918000000 },
    { name: "Ford Motor Company Fund", totalAssets: 200000000, grantsPaid: 30000000 },
  ];
  assert.deepEqual(findEndowmentDoubleCounts(founds), []);
});

test("a prefix match with an UNKNOWN remainder is not a pair — the suffix list is closed", () => {
  // "Foundation" is not an endowment suffix, so this is two grantmakers, not one counted twice.
  const founds = [
    { name: "Walton Family", totalAssets: 1000, grantsPaid: 10 },
    { name: "Walton Family Foundation", totalAssets: 5000000000, grantsPaid: 700000000 },
  ];
  assert.deepEqual(findEndowmentDoubleCounts(founds), []);
});

test("substring alone does not pair — the parent must be a leading WORD boundary", () => {
  const founds = [
    { name: "Kaiser Foundation", totalAssets: 100, grantsPaid: 10 },
    { name: "Kaiser Foundation Health Plan Trust", totalAssets: 30600000000, grantsPaid: 1000000 },
  ];
  assert.deepEqual(findEndowmentDoubleCounts(founds), []);
});

test("punctuation and casing do not defeat the match", () => {
  const founds = [
    { name: "The Simons Foundation", totalAssets: 5e9, grantsPaid: 4e8 },
    { name: "the simons foundation — TRUST", totalAssets: 5e9, grantsPaid: 4e8 },
  ];
  assert.deepEqual(findEndowmentDoubleCounts(founds), [1]);
});

test("a single foundation can never be its own double-count (the i === j guard)", () => {
  assert.deepEqual(findEndowmentDoubleCounts([{ name: "Gates Foundation Trust" }]), []);
});

test("empty and nameless rows do not throw or match", () => {
  assert.deepEqual(findEndowmentDoubleCounts([]), []);
  assert.deepEqual(findEndowmentDoubleCounts([{ name: null }, { name: undefined }, {}]), []);
});

test("collapse drops the vehicle and KEEPS everything else, without mutating the input", () => {
  const kept = collapseEndowmentVehicles(GATES);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((f) => f.totalAssets), [76951451400, 1227735]);
  assert.equal(GATES.length, 3, "input must be untouched — the breakdown still shows the trust");
});

test("THE FIX: totals exclude the endowment vehicle, roughly halving the Gates figure", () => {
  const t = foundationTotals({
    foundations: GATES,
    totalFoundationAssets: 152483424711,
    totalGrantsPaid: 14501841217,
  });
  assert.equal(t.totalAssets, 76951451400 + 1227735);
  assert.equal(t.totalGrants, 7793604635 + 70868);
});

test("the stored top-level sums are IGNORED when foundations[] exists — they are the doubled ones", () => {
  // This is the regression that shipped the $152.5B tile: both consumers preferred these fields.
  const t = foundationTotals({
    foundations: [{ name: "X Foundation", totalAssets: 10, grantsPaid: 2 }],
    totalFoundationAssets: 999999,
    totalGrantsPaid: 888888,
  });
  assert.equal(t.totalAssets, 10);
  assert.equal(t.totalGrants, 2);
});

test("stored sums ARE the fallback when the fact carries no foundations[] (older facts)", () => {
  const t = foundationTotals({ totalFoundationAssets: 500, totalGrantsPaid: 42 });
  assert.equal(t.totalAssets, 500);
  assert.equal(t.totalGrants, 42);
});

test("legacy `totalGrants` field is still read (older facts predate `grantsPaid`)", () => {
  const t = foundationTotals({ foundations: [{ name: "Y Foundation", totalGrants: 7 }] });
  assert.equal(t.totalGrants, 7);
});

test("a fact with neither shape yields zeros rather than NaN", () => {
  const t = foundationTotals({});
  assert.equal(t.totalAssets, 0);
  assert.equal(t.totalGrants, 0);
  assert.equal(foundationTotals(null).totalAssets, 0);
});

// ---------------------------------------------------------------- foundationAssetsChip (B-030)
// The chip is what a READER sees on a feed card. It is pinned here because the curator built it
// by hand-summing `foundations[].totalAssets` until 2026-08-20, and that string is also handed to
// Pass A as context — so the doubled figure reached both the chip and the GPT-written dek.

test("the chip collapses an endowment trust — the live 2026-08-20 front-door defect", () => {
  const fv = {
    foundations: [
      { name: "Gates Foundation", totalAssets: 76_950_000_000, grantsPaid: 6_000_000_000 },
      { name: "Gates Foundation Trust", totalAssets: 75_550_000_000, grantsPaid: 0 },
    ],
    // the fetcher's un-collapsed sums, deliberately present and deliberately ignored
    totalFoundationAssets: 152_500_000_000,
    totalGrantsPaid: 6_000_000_000,
  };
  assert.equal(foundationAssetsChip(fv), "$77.0B in foundation assets");
  assert.notEqual(foundationAssetsChip(fv), "$152.5B in foundation assets");
});

test("an independent second foundation is NOT collapsed — the chip must still add those", () => {
  const fv = {
    foundations: [
      { name: "Example Foundation", totalAssets: 3_000_000_000 },
      { name: "Unrelated Family Fund", totalAssets: 1_000_000_000 },
    ],
  };
  assert.equal(foundationAssetsChip(fv), "$4.0B in foundation assets");
});

test("the chip is null below $1M rather than asserting a zero about a named person", () => {
  assert.equal(foundationAssetsChip({ foundations: [{ name: "Tiny Fund", totalAssets: 1 }] }), null);
  assert.equal(foundationAssetsChip({ foundations: [] }), null);
  assert.equal(foundationAssetsChip(null), null);
  assert.equal(foundationAssetsChip(undefined), null);
});

test("millions render as M, and the units do not silently change shape", () => {
  assert.equal(
    foundationAssetsChip({ foundations: [{ name: "Mid Fund", totalAssets: 67_000_000 }] }),
    "$67M in foundation assets",
  );
});
