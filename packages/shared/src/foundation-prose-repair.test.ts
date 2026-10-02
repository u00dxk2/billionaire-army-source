import { test } from "node:test";
import assert from "node:assert/strict";
import { repairFoundationProse, storedFoundationTotals } from "./foundation-endowment";

/**
 * B-030 residual, second surface. The chip was repaired at render time on 2026-08-20; the GPT-written
 * `summary` prose on already-published cards was not, so on 2026-08-21 five cards in the served 40
 * read "$152.5 billion" beside a chip reading "$77.0B" — about the SAME person, on the SAME card.
 *
 * The asymmetry that matters here is the same one the collapse itself has: over-matching would
 * rewrite a number that was correct, on a platform whose thesis is that no claim outruns its
 * citation. Every "leaves it alone" case below is therefore load-bearing, not filler.
 */

// The live 2026-08-12 fact, verbatim from prod — same fixture the collapse tests use.
const GATES_FACT = {
  foundations: [
    { name: "Gates Foundation", totalAssets: 76951451400, grantsPaid: 7793604635 },
    { name: "Gates Foundation Trust", totalAssets: 75530745576, grantsPaid: 6708165714 },
    { name: "Gates Foundation", totalAssets: 1227735, grantsPaid: 70868 },
  ],
  totalFoundationAssets: 152483424711,
  totalGrantsPaid: 14501841217,
};

test("the stored sums are read, not re-summed (KP-7: no fourth hand-rolled aggregation)", () => {
  const { totalAssets, totalGrants } = storedFoundationTotals(GATES_FACT);
  assert.equal(totalAssets, 152483424711);
  assert.equal(totalGrants, 14501841217);
});

test("the live prod sentence: the doubled assets figure is corrected in place", () => {
  // Verbatim from card 3ea56621 on 2026-08-21.
  const before =
    "The Gates Foundation announced a $540 million science-focused gift as federal support pulls " +
    "back, according to Fortune. Melinda French Gates has an estimated net worth of $29 billion; " +
    "the foundation’s reported assets total about $152.5 billion, making the grant a notable example.";
  const after = repairFoundationProse(before, GATES_FACT);

  assert.ok(!after.includes("$152.5 billion"), "the doubled figure must be gone");
  assert.ok(after.includes("$77.0 billion"), "the collapsed figure must replace it, same unit word");
  // The two numbers that were always correct must survive untouched.
  assert.ok(after.includes("$540 million"), "the grant size is not a foundation total");
  assert.ok(after.includes("$29 billion"), "net worth is not a foundation total");
});

test("a card that never mentioned the figure is returned byte-identical", () => {
  const text = "Melinda French Gates says her $600 million donation is meant to draw other donors.";
  assert.equal(repairFoundationProse(text, GATES_FACT), text);
});

test("the 'B' spelling is repaired in its own shape, not normalised to prose", () => {
  const after = repairFoundationProse("The foundation holds $152.5B in assets.", GATES_FACT);
  assert.equal(after, "The foundation holds $77.0B in assets.");
});

test("the doubled GRANTS figure is repaired too, not just assets", () => {
  const after = repairFoundationProse("It paid out $14.5 billion in grants.", GATES_FACT);
  assert.equal(after, "It paid out $7.8 billion in grants.");
});

test("NO foundations[] array is a no-op — the stored sums ARE the collapsed answer there", () => {
  const legacy = { totalFoundationAssets: 152483424711, totalGrantsPaid: 14501841217 };
  const text = "Assets total about $152.5 billion.";
  assert.equal(repairFoundationProse(text, legacy), text);
});

test("a person with no endowment double-count is left completely alone", () => {
  const clean = {
    foundations: [{ name: "Example Foundation", totalAssets: 5_000_000_000, grantsPaid: 250_000_000 }],
    totalFoundationAssets: 5_000_000_000,
    totalGrantsPaid: 250_000_000,
  };
  const text = "The foundation reports $5.0 billion in assets and $250 million in grants.";
  assert.equal(repairFoundationProse(text, clean), text);
});

test("a figure merely NEAR the doubled one is not swept up (0.5% band, not fuzzy match)", () => {
  // $150B is within 2% of $152.5B — close enough to look like a rounding of it, far enough
  // that it is a different claim. Replacing it would be inventing a correction.
  const text = "A rival endowment holds $150 billion.";
  assert.equal(repairFoundationProse(text, GATES_FACT), text);
});

test("empty and non-string input degrade quietly rather than throwing mid-render", () => {
  assert.equal(repairFoundationProse("", GATES_FACT), "");
  assert.equal(repairFoundationProse(undefined as unknown as string, GATES_FACT), undefined);
});
