/**
 * B-045's block, pinned in BOTH directions.
 *
 * The negatives matter more than the positives here. Three separate designs for a prose-figure
 * withhold were rejected by adversarial review (2026-09-11 party-prose into a render, thirteen false
 * withholds; 2026-09-13 a figure-matching staleness withhold, three more), and the shapes that
 * killed them are pinned below as MUST-NOT-FLAG. A future tightening that makes one of them go red
 * is re-creating a defect this project has already paid for twice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findFigureDisagreements,
  figureAgrees,
  significantDigits,
  dollarAmounts,
  storedNumericLeaves,
  storedFiguresForSummary,
  MIN_SIGNIFICANT_DIGITS,
} from "./figure-disagreement";

// The live defect this block exists for: Michael Jordan's political section stated $689,538 on
// 2026-09-11 where the stored FEC record reads $669,538. Corrected by hand 2026-09-12 (264b120).
const JORDAN_STORED = [669538, 1516288];

test("THE LIVE DEFECT: a one-digit mis-transcription of a stored figure is a disagreement", () => {
  const hits = findFigureDisagreements(
    "Federal campaign finance records show $689,538 in contributions [FEC].",
    JORDAN_STORED,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].stated, 689538);
  assert.equal(hits[0].stored, 669538, "the block must name WHICH stored record it disagreed with");
});

test("an adjacent transposition is the same class of typo", () => {
  const hits = findFigureDisagreements("Records show $696,538 in contributions.", JORDAN_STORED);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].stored, 669538);
});

test("the CORRECT figure is not a disagreement (the positive control's negative half)", () => {
  assert.deepEqual(findFigureDisagreements("Records show $669,538 [FEC].", JORDAN_STORED), []);
});

// ---- MUST NOT FLAG: the shapes adversarial review reproduced against earlier designs ----

test("REJECTED-DESIGN SHAPE 1 — a top recipient's amount, which carries no context, is left alone", () => {
  // The case that ended the 2026-09-13 design: prose states a recipient amount, not a subtotal.
  // It is STORED (top recipients are in the FEC fact), so it agrees and is never examined.
  const stored = [669538, 48250, 12500];
  assert.deepEqual(
    findFigureDisagreements("The largest single recipient received $48,250 [FEC].", stored),
    [],
  );
});

test("REJECTED-DESIGN SHAPE 2 — a thousands-separated COUNT is not a dollar figure", () => {
  // "1,234 contributions" read as money was a reproduced false withhold. A count one digit off a
  // stored count must not delete a section: the ruling authorises DOLLAR figures only.
  assert.deepEqual(findFigureDisagreements("Filed 12,345 contributions in total.", [12346]), []);
  assert.deepEqual(dollarAmounts("Filed 12,345 contributions in total."), []);
});

test("REJECTED-DESIGN SHAPE 3 — a scaled figure ('$1 million') is never read as its bare number", () => {
  assert.deepEqual(findFigureDisagreements("Gave more than $1 million [990].", [1, 669538]), []);
  assert.deepEqual(findFigureDisagreements("Gave about $1.5 million [990].", [2, 669538]), []);
});

test("cents and float noise agree — a stored 260267.41999999998 prints as $260,267.42", () => {
  assert.deepEqual(findFigureDisagreements("Contributed $260,267.42 [FEC].", [260267.41999999998]), []);
});

test("ROUNDING agrees at every power of ten — this is what keeps true prose on the page", () => {
  for (const rounded of ["$669,540", "$669,500", "$670,000", "$700,000"]) {
    assert.deepEqual(
      findFigureDisagreements(`Contributed ${rounded} [FEC].`, [669538]),
      [],
      `${rounded} is a rounding of 669538 and must agree`,
    );
  }
});

test("ROUND AMOUNTS can never reach the significance floor, so they can never be typos", () => {
  // $200,000 is one digit from a stored $100,000 and both are entirely plausible distinct amounts.
  assert.deepEqual(findFigureDisagreements("Granted $200,000 [990].", [100000]), []);
  assert.ok(significantDigits(200000) < MIN_SIGNIFICANT_DIGITS);
  assert.ok(significantDigits(100000) < MIN_SIGNIFICANT_DIGITS);
});

test("a YEAR-shaped dollar figure cannot qualify", () => {
  assert.deepEqual(findFigureDisagreements("A $2,026 contribution [FEC].", [2025]), []);
});

test("AMBIGUITY leaves the figure alone — one edit from two stored figures names neither", () => {
  assert.deepEqual(findFigureDisagreements("Reported $12,345 [FEC].", [12346, 12335]), []);
});

test("a different MAGNITUDE is a different error class and is left alone", () => {
  // $61,779 vs a stored 617,798 — an inserted/dropped digit, not a substitution.
  assert.deepEqual(findFigureDisagreements("Reported $61,779 [FEC].", [617798]), []);
});

test("a figure with NO stored neighbour is unmatched, never a disagreement", () => {
  // Explicitly the onTrigger's rule (c): an unmatched figure is NOT a disagreement.
  assert.deepEqual(findFigureDisagreements("Reported $842,119 [FEC].", [669538, 1516288]), []);
});

test("no stored figures at all blocks nothing", () => {
  assert.deepEqual(findFigureDisagreements("Reported $689,538 [FEC].", []), []);
});

test("empty and absent prose block nothing", () => {
  assert.deepEqual(findFigureDisagreements("", [669538]), []);
  assert.deepEqual(findFigureDisagreements(null, [669538]), []);
  assert.deepEqual(findFigureDisagreements(undefined, [669538]), []);
});

// ---- the pieces, so a failure names which rule broke ----

test("figureAgrees: within a dollar, and any clean rounding", () => {
  assert.ok(figureAgrees(669538, 669538));
  assert.ok(figureAgrees(669538, 669538.49));
  assert.ok(figureAgrees(669540, 669538));
  assert.ok(!figureAgrees(689538, 669538));
});

test("significantDigits strips trailing zeros", () => {
  assert.equal(significantDigits(669538), 6);
  assert.equal(significantDigits(200000), 1);
  assert.equal(significantDigits(26300000000), 3);
  assert.equal(significantDigits(2025), 4);
});

test("storedNumericLeaves walks nested facts and SKIPS strings", () => {
  const fact = {
    ein: "131623829",
    committeeId: "C00123456",
    totalAmount: 669538,
    partyBreakdown: { DEM: 400000, REP: 269538 },
    recipients: [{ name: "X", amount: 48250 }],
  };
  const leaves = storedNumericLeaves(fact).sort((a, b) => a - b);
  assert.deepEqual(leaves, [48250, 269538, 400000, 669538]);
});

test("THE LIVE FALSE POSITIVE: a MERGED party bucket agrees, and raw leaves alone would block it", () => {
  // Jeff Bezos, read from prod 2026-09-14. Stored keys UNK 1000 and Unknown 10334174.26 are handed
  // to the model MERGED as $10,335,174.26 (B-038 write path), and the prose states the merged
  // figure — which reconciles to the cent: 10,335,174.26 + 17,200 + 11,600 = 10,363,974.26.
  const raw = { totalAmount: 10363974.26, partyBreakdown: { DEM: 11600, REP: 17200, UNK: 1000, Unknown: 10334174.26 } };
  const shaped = {
    totalAmountUsd: "$10,363,974.26",
    partyBreakdownUsd: { Democratic: "$11,600", Republican: "$17,200", Unknown: "$10,335,174.26" },
  };
  const prose =
    "Of that total, $10,335,174.26 was classified as unknown party affiliation, $17,200 went to Republican recipients, and $11,600 went to Democratic recipients [FEC].";

  // Raw leaves ALONE — what the first version compared against — call the true paragraph a lie.
  const rawOnly = findFigureDisagreements(prose, storedNumericLeaves(raw));
  assert.equal(rawOnly.length, 1, "pinning the defect: raw leaves alone flag the merged bucket");
  assert.equal(rawOnly[0].stored, 10334174.26);

  // The figures the summary was actually written from: no disagreement.
  assert.deepEqual(findFigureDisagreements(prose, storedFiguresForSummary([raw], [shaped])), []);
});

test("the merged-bucket fix does not blind the predicate — Jordan still flags through the same path", () => {
  const raw = { totalAmount: 1516288, partyBreakdown: { UNK: 100, Unknown: 669438 } };
  const shaped = { totalAmountUsd: "$1,516,288", partyBreakdownUsd: { Unknown: "$669,538" } };
  const hits = findFigureDisagreements(
    "Federal records show $689,538 in contributions [FEC].",
    storedFiguresForSummary([raw], [shaped]),
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].stored, 669538, "it must name the MERGED figure the model was handed");
});

// ---- THE THREE REPRODUCTIONS THAT ENDED THE BLOCK (adversarial review, 2026-09-14) ----
// Two are now FIXED in the tokenizer and pinned so they cannot return. The third is NOT fixable and
// is the reason this file is an instrument: it is pinned as a KNOWN, DOCUMENTED false positive, so
// anyone who re-proposes deletion meets it in a red test rather than in production.

test("FIXED — a SCALED figure is dropped, not truncated to its mantissa", () => {
  // "$12,345 million" is $12.345B. Read as 12345 it collided with a stored 12,346.
  assert.deepEqual(dollarAmounts("Assets of $12,345 million [990]."), []);
  assert.deepEqual(findFigureDisagreements("Assets of $12,345 million [990].", [12346]), []);
  for (const unit of ["billion", "trillion", "thousand", "bn"]) {
    assert.deepEqual(dollarAmounts(`Gave $12,345 ${unit}.`), [], `${unit} must disqualify the token`);
  }
});

test("FIXED 2026-09-15 — a B suffix scales, and a figure opening a bare range is not read at its near end", () => {
  assert.deepEqual(dollarAmounts("Assets of $89,538B [990]."), []);
  assert.deepEqual(dollarAmounts("Grants ranged from $89,538–90,000K."), []);
  assert.deepEqual(dollarAmounts("Gave $10-12 million."), []);
  assert.deepEqual(dollarAmounts("Gave $89,538 by 2024."), [89538], "a word starting with b is not a suffix");
  // Round 2: only a SCALED far end makes a range — a count after "to" is not one, and a second $ still is.
  assert.deepEqual(dollarAmounts("Gave $89,538 to 12 charities."), [89538], "a recipient count is not a range end");
  assert.deepEqual(dollarAmounts("Ranged $89,538–$90,000K."), [], "a second dollar sign does not hide the scale");
  // Round 3: a scale word NEARBY makes a PROSE figure ambiguous; the STORED side keeps it, because a
  // stored figure dropped from the record is what deletes a true section.
  assert.deepEqual(dollarAmounts("Assets ranged between $12,345 and $12,350 million."), []);
  assert.deepEqual(dollarAmounts("Gave $89,538 to 1 million children."), [], "prose skips the ambiguous figure");
  assert.deepEqual(dollarAmounts("Gave $89,538 to 1 million children.", { keepAmbiguous: true }), [89538], "stored keeps it");
});

test("FIXED — a dollar figure does not swallow the COUNT that follows it", () => {
  // The permissive character class ran past "$10," and emitted 12345 as a second token.
  assert.deepEqual(dollarAmounts("At $10, 12,345 grants were awarded."), [10]);
  assert.deepEqual(findFigureDisagreements("At $10, 12,345 grants were awarded.", [12346, 10]), []);
});

test("KNOWN FALSE POSITIVE of this INSTRUMENT — a CORRECT derived subtotal flags; why the block is figure-block.ts, not this", () => {
  /* $669,538 + $20,000 = $689,538 is a true sentence about two 2024 foundation grants, and
     $689,538 is one digit-edit from $669,538, so this predicate flags it.
     CORRECTED 2026-09-14 (P4): this was first pinned as "NOT FIXABLE". That overclaimed. Treating a
     sum of 2-3 of the person's own stored figures as AGREEMENT clears this case and all six live
     merged-bucket false positives — measured against prod — at a cost of 17.3% recall. So it is
     fixable with a measured tradeoff. If a later design makes this go green, the test to add
     beside it is the recall cost, and the real Michael Jordan record (78 figures, where 669538
     exists only as a sum) as a case it must still CATCH. */
  const raw = [{ foundations: [{ year: 2024, grantsPaid: 669538 }, { year: 2024, grantsPaid: 20000 }] }];
  const hits = findFigureDisagreements(
    "The two foundations reporting for 2024 paid $689,538 in grants [990].",
    storedFiguresForSummary(raw, raw),
  );
  assert.equal(hits.length, 1, "pinned as a KNOWN false positive — the reason this is an instrument");
  assert.equal(hits[0].stored, 669538);
});

test("a committee id cannot become a typo target, because it is stored as a STRING", () => {
  // C00123456 → if it leaked in as the number 123456, "$123,457" would read as a typo of it.
  const stored = storedNumericLeaves({ committeeId: "C00123456", totalAmount: 669538 });
  assert.deepEqual(findFigureDisagreements("Paid $123,457 [FEC].", stored), []);
});
