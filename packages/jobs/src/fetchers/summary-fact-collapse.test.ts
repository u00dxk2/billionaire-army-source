import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseFoundationTotalsForPrompt } from "./summary-fact-collapse";

/**
 * COPIED FROM PROD, not invented — the exact `philanthropy` / `foundation_990s` fact served by
 * /api/persons/cedfd5f4… on 2026-08-19, which is what put $152,483,424,711 on the Bill Gates
 * profile. The Trust is the endowment that funds the Foundation, so summing them counts the same
 * pile twice.
 *
 * The first draft of this fixture named the parent "Bill & Melinda Gates Foundation" and the test
 * failed: `findEndowmentDoubleCounts` matches PREFIX + endowment suffix, so nothing collapsed. The
 * stored name is plainly "Gates Foundation". Keep this fixture byte-faithful to the stored row —
 * a hand-written approximation tests a shape the pipeline never produces.
 */
const GATES_990_FACT = {
  foundations: [
    { name: "Gates Foundation", totalAssets: 76951451400, grantsPaid: 7793604635 },
    // A second, tiny entity filed under the same name — real, and NOT an endowment vehicle.
    { name: "Gates Foundation", totalAssets: 1227735, grantsPaid: 70868 },
    { name: "Gates Foundation Trust", totalAssets: 75530745576, grantsPaid: 6708165714 },
  ],
  totalGrantsPaid: 14501841217,
  totalFoundationAssets: 152483424711,
  sourceUrl: "https://projects.propublica.org/nonprofits/search?q=Gates%20foundation",
};

/** Collapsed = both real "Gates Foundation" rows, with only the Trust dropped. */
const COLLAPSED_ASSETS = 76951451400 + 1227735;
const COLLAPSED_GRANTS = 7793604635 + 70868;

test("the doubled figure never reaches the model's source data (the exact number that shipped)", () => {
  const out = collapseFoundationTotalsForPrompt(GATES_990_FACT) as Record<string, unknown>;
  assert.notEqual(out.totalFoundationAssets, 152483424711);
  assert.equal(out.totalFoundationAssets, COLLAPSED_ASSETS);
  assert.equal(out.totalGrantsPaid, COLLAPSED_GRANTS);
});

test("the SERIALISED string is clean — that string, not the object, is what the model reads", () => {
  const json = JSON.stringify(collapseFoundationTotalsForPrompt(GATES_990_FACT));
  assert.ok(!json.includes("152483424711"), "un-collapsed total still present in the prompt JSON");
  assert.ok(json.includes(String(COLLAPSED_ASSETS)), "collapsed total missing from the prompt JSON");
});

test("per-foundation rows survive, so the prose can still name each entity", () => {
  const out = collapseFoundationTotalsForPrompt(GATES_990_FACT) as Record<string, unknown>;
  assert.equal((out.foundations as unknown[]).length, 3);
  // Dropping the trust row would make the prose wrong in the other direction — the trust exists.
  assert.ok(JSON.stringify(out.foundations).includes("Gates Foundation Trust"));
  assert.equal(out.sourceUrl, GATES_990_FACT.sourceUrl);
});

test("a genuinely single-foundation fact is left at its real numbers", () => {
  const single = {
    foundations: [{ ein: 1, name: "Michelson Found Animals Foundation", grantsPaid: 12, totalAssets: 34 }],
    totalGrantsPaid: 12,
    totalFoundationAssets: 34,
  };
  const out = collapseFoundationTotalsForPrompt(single) as Record<string, unknown>;
  assert.equal(out.totalFoundationAssets, 34);
  assert.equal(out.totalGrantsPaid, 12);
});

test("an older fact carrying no foundations[] passes through rather than being zeroed", () => {
  // This is the false-zero direction: overwriting here would assert $0 of foundation giving for
  // every pre-array fact in the corpus.
  const legacy = { totalGrantsPaid: 5_000_000, totalFoundationAssets: 20_000_000 };
  assert.deepEqual(collapseFoundationTotalsForPrompt(legacy), legacy);
});

test("an empty foundations[] is also left alone, not collapsed to zero", () => {
  const empty = { foundations: [], totalGrantsPaid: 7, totalFoundationAssets: 9 };
  assert.deepEqual(collapseFoundationTotalsForPrompt(empty), empty);
});

test("non-object values pass through without throwing", () => {
  assert.equal(collapseFoundationTotalsForPrompt(null), null);
  assert.equal(collapseFoundationTotalsForPrompt(undefined), undefined);
  assert.equal(collapseFoundationTotalsForPrompt("$1B"), "$1B");
  assert.equal(collapseFoundationTotalsForPrompt(42), 42);
  const arr = [1, 2];
  assert.equal(collapseFoundationTotalsForPrompt(arr), arr);
});
