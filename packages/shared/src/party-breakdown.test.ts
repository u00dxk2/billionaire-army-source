import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePartyBreakdown, topPartyLabel } from "./party-breakdown";

// THE INVARIANT. Normalising must never drop, invent or round money. This is the test that fails
// first if anyone adds a filter to the fold — and a dropped bucket is exactly the B-038 defect,
// arriving from the other direction (there the PROSE dropped one; here the RENDERER would).
test("the sum is preserved exactly — no bucket is ever dropped", () => {
  // Alec Gores, live prod row 2026-09-08. The stored parts sum to the stored totalAmount; the
  // GENERATED PROSE dropped DFL and fell $518.75 short, which is how B-038 was found.
  const gores = { DEM: 214043.75, DFL: 518.75, REP: 155900, Unknown: 213400 };
  const out = normalizePartyBreakdown(gores);
  const total = out.reduce((s, b) => s + b.amount, 0);
  assert.equal(total, 583862.5);
  assert.equal(out.length, 4, "four distinct parties stay four buckets");
});

// Zach McLeroy, live prod row 2026-09-08: the same party under two keys. Before the fold these
// rendered as two bars and the top-party pickers compared FRAGMENTS.
test("DEM and Dem are one party, not two bars", () => {
  const out = normalizePartyBreakdown({ DEM: 2300, Dem: 4600, REP: 1000 });
  const dem = out.find((b) => b.code === "DEM");
  assert.equal(dem?.amount, 6900, "the two spellings add up");
  assert.equal(out.length, 2);
  assert.equal(dem?.label, "Democratic");
});

test("REP and Rep fold the same way", () => {
  const out = normalizePartyBreakdown({ REP: 500, Rep: 250 });
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 750);
});

test("the no-party family folds — Unknown, UNK and UN claim nothing about anyone", () => {
  const out = normalizePartyBreakdown({ Unknown: 100, UNK: 50, UN: 25 });
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "Unknown");
  assert.equal(out[0].amount, 175);
});

// THE DELIBERATE NON-MERGES. Each of these would be a political claim, so each stays separate.
test("DFL does NOT fold into DEM — that would be a claim, not a normalisation", () => {
  const out = normalizePartyBreakdown({ DEM: 1000, DFL: 500 });
  assert.equal(out.length, 2);
  assert.ok(out.some((b) => b.code === "DFL"));
});

test("NNE (no party listed) is not Unknown (we could not tell)", () => {
  const out = normalizePartyBreakdown({ NNE: 100, Unknown: 100 });
  assert.equal(out.length, 2);
});

test("a bare R is not inferred to be REP", () => {
  const out = normalizePartyBreakdown({ REP: 1000, R: 50 });
  assert.equal(out.length, 2, "a single-letter code is an inference, and inference is the bug");
});

// A WRONG LABEL IS A FALSE CLAIM; A RAW CODE IS ONLY UGLY. This pins the choice.
test("an unrecognised code renders as itself rather than being guessed at", () => {
  const out = normalizePartyBreakdown({ DCG: 250 });
  assert.equal(out[0].label, "DCG");
});

test("known codes get human labels — the reader never sees an FEC internal", () => {
  const out = normalizePartyBreakdown({ DEM: 5, REP: 4, NNE: 3, "PAC/Other": 2, DFL: 1 });
  const byCode = Object.fromEntries(out.map((b) => [b.code, b.label]));
  assert.equal(byCode.DEM, "Democratic");
  assert.equal(byCode.REP, "Republican");
  assert.equal(byCode.NNE, "No party listed");
  assert.equal(byCode["PAC/Other"], "PACs & other committees");
  assert.equal(byCode.DFL, "Democratic–Farmer–Labor");
});

test("buckets come back largest first", () => {
  const out = normalizePartyBreakdown({ REP: 10, DEM: 100, IND: 50 });
  assert.deepEqual(out.map((b) => b.code), ["DEM", "IND", "REP"]);
});

// THE CORRECTNESS BUG, pinned. Split keys made the pickers compare fragments.
test("topPartyLabel compares WHOLE parties, so a split key cannot flip the lean", () => {
  // Democratic giving is 6,900 across two keys; Republican is 5,000 in one. Pre-fold, the
  // pickers saw Dem 4,600 vs REP 5,000 and reported the wrong lean.
  const split = { DEM: 2300, Dem: 4600, REP: 5000 };
  assert.equal(topPartyLabel(split), "Democratic");
});

test("topPartyLabel never reports a non-party bucket as a lean", () => {
  assert.equal(topPartyLabel({ Unknown: 1e9, "PAC/Other": 1e9, NNE: 1e9, DEM: 1 }), "Democratic");
  assert.equal(topPartyLabel({ Unknown: 500, "PAC/Other": 400 }), null);
});

test("empty, null and undefined are handled without inventing a lean", () => {
  assert.equal(topPartyLabel(null), null);
  assert.equal(topPartyLabel(undefined), null);
  assert.equal(topPartyLabel({}), null);
  assert.deepEqual(normalizePartyBreakdown(null), []);
});

test("a non-numeric amount is skipped rather than poisoning the total with NaN", () => {
  const out = normalizePartyBreakdown({ DEM: 100, REP: Number.NaN as unknown as number });
  const total = out.reduce((s, b) => s + b.amount, 0);
  assert.equal(total, 100);
});
