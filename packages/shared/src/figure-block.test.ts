/**
 * B-045's block, pinned against the FOUR CONDITIONS the orchestrator set (bus cef485cd, 2026-09-14)
 * and recorded on the row's closeWhen. Conditions (a)-(c) are here; (d) is a number that lives on the
 * row and in the report, because a recall figure is a measurement over prod, not an assertion.
 *
 * EVERY RECORD BELOW IS REAL, dumped from prod on 2026-09-15 by tmp/dump-jordan.mjs as the DISTINCT
 * magnitudes `storedFiguresForSummary` produces. That matters more than it looks: the interim
 * single-figure predicate's positive control used a SYNTHETIC set containing 669538 as a leaf, so it
 * proved the FUNCTION and not the REACH — and the function passed while the real record did not.
 * A fixture that contains the answer cannot test whether you can find the answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBlockingFigureDisagreements, derivedSums, figureAgreesWithRecord, MAX_FIGURES_FOR_DERIVATION } from "./figure-block";
import { storedFiguresForSummary } from "./figure-disagreement";

/**
 * Michael Jordan, prod, 2026-09-15: 78 raw leaves -> 31 distinct magnitudes -> 4,928 distinct 2-3 sums
 * (the same 4,928 the 2026-09-14 four-condition run reported, independently reproduced).
 * 669,538 is NOT here as a single figure. It exists only as 364,868 + 304,670.
 */
const JORDAN = [
  1, 18, 90, 100, 109, 250, 475, 900, 931, 1145, 1162, 2023, 3794, 10038, 142680, 304670, 311194,
  364868, 383916, 385323, 476916, 846750, 878622, 1181810, 1516288, 2335280, 13078216, 15798819,
  586039423, 752486085, 882989784,
];

/** Jeff Bezos, prod, 2026-09-15 — one of the six live merged-bucket false alarms. */
const BEZOS = [
  1, 2, 4, 51, 65, 250, 469, 554, 1000, 2023, 6021, 11600, 17200, 20000, 30000, 40000, 55000,
  10129170, 10334174, 10335174, 10363974, 164546275, 167033221, 167872880, 225014722, 912073258,
];

/** Stewart Resnick, prod, 2026-09-15. */
const RESNICK = [
  1, 5, 10, 17, 100, 1021, 2015, 2023, 2500, 2836, 7800, 9939, 10000, 11000, 16385, 16916, 44300,
  54300, 88000, 100000, 318080, 360195, 370195, 719575, 10840230, 10843067, 16276258, 70205204,
  71595573, 71611958, 71632035, 232628837, 954658095,
];

/** Stanley Hubbard, prod, 2026-09-15. */
const HUBBARD = [
  100, 250, 1200, 1995, 2014, 2023, 2711, 6631, 7000, 10000, 38467, 92500, 105620, 115620, 119808,
  242678, 552750, 554745, 600525, 1621074, 11783924, 11822391, 208104085, 454264552, 934359901,
];

/** Brad Kelley, prod, 2026-09-15. */
const KELLEY = [
  9, 22, 30, 100, 166, 262, 798, 2023, 2262, 5000, 7524, 10000, 11700, 12202, 30250, 31251, 31281,
  40250, 40943, 41674, 63792, 92893, 161642, 207438, 318016, 357936, 365552, 845210, 203971934,
  431184876, 843571853,
];

/** Chris Larsen, prod, 2026-09-15. */
const LARSEN = [
  1, 100, 222, 1000, 2023, 2500, 8098, 12000, 18300, 20236, 22550, 25000, 64650, 100000, 199428,
  214168, 225848, 429484, 1014412, 1014818, 1634611, 1636111, 1852339, 2338366, 3292428, 5500000,
  6060278, 6661599, 6661699, 6687749, 202523521, 311482756, 516507234,
];

const block = (text: string, stored: readonly number[]) => findBlockingFigureDisagreements(text, stored);

// ---------------------------------------------------------------------------
// (a) POSITIVE CONTROL — it goes RED FIRST. This is the assertion that fails if
//     the derived-sum TARGET side is removed, which is how the interim predicate
//     was caught. Do not weaken it into a synthetic fixture.
// ---------------------------------------------------------------------------

test("(a) POSITIVE CONTROL: Jordan's REAL record blocks his REAL $689,538, reached via a derived sum", () => {
  const verdict = block(
    "His foundation reported $689,538 in grants paid across the 2024 filing year [IRS].",
    JORDAN,
  );
  assert.equal(verdict.refused, false);
  assert.equal(verdict.disagreements.length, 1, "the real typo must be caught on the real record");
  const [hit] = verdict.disagreements;
  assert.equal(hit.stated, 689538);
  assert.equal(hit.stored, 669538, "the target is the derived total, not any single stored figure");
  assert.equal(hit.via, "derived", "reached via a 2-3 figure sum — a single-figure rule has no target here");
});

test("(a2) the target 669,538 is genuinely absent as a single figure and present only as a sum", () => {
  // If this ever flips, (a) stops testing what it says it tests — it would pass on the single-figure
  // rule alone and the positive control would silently stop discriminating between the two designs.
  assert.ok(!JORDAN.includes(669538), "669538 must NOT be a stored leaf, or (a) proves nothing");
  const sums = derivedSums(JORDAN);
  assert.ok(sums !== null);
  assert.ok(sums!.includes(669538), "669538 must be reachable as a 2-3 figure sum");
  assert.equal(304670 + 364868, 669538, "the two summands are Jordan's real stored figures");
  assert.ok(!sums!.includes(689538), "the STATED figure must not itself be derivable, or it would agree");
});

test("(a3) the same record reproduces the 4,928 distinct sums the 2026-09-14 run reported", () => {
  assert.equal(derivedSums(JORDAN)!.length, 4928);
});

// ---------------------------------------------------------------------------
// (b) A GENUINE SUBTOTAL PASSES — the same string, a different record.
// ---------------------------------------------------------------------------

test("(b) a true per-person subtotal passes: $689,538 stated by someone who really has 669,538 + 20,000", () => {
  const record = [669538, 20000, 1516288, 2023, 100];
  const verdict = block("The foundation paid $689,538 across its two 2024 grants [IRS].", record);
  assert.deepEqual(verdict.disagreements, [], "a correct sum of the person's own figures is not a disagreement");
});

test("(b2) agreement WINS the tie — a figure that is both derivable and one edit from a target publishes", () => {
  // 689,538 is one digit-edit from this record's stored 669,538 AND equals 669,538 + 20,000.
  // The single-figure predicate calls that true sentence a lie; the block must not.
  const record = [669538, 20000];
  assert.deepEqual(block("$689,538", record).disagreements, []);
});

// ---------------------------------------------------------------------------
// (c) THE SIX LIVE MERGED-BUCKET FALSE ALARMS — all pass.
//     `fec.ts` stores raw FEC codes, so a record carries `UNK: 1000` and
//     `Unknown: 10,334,174.26` separately while correct prose states the MERGED
//     total. Nineteen unit tests were green while the interim predicate went
//     0 for 6 on exactly these.
// ---------------------------------------------------------------------------

test("(c) Bezos: the merged Unknown-bucket total does not block", () => {
  assert.deepEqual(
    block("Federal records show $10,335,174 in contributions from unattributed committees [FEC].", BEZOS)
      .disagreements,
    [],
  );
});

test("(c) all six merged-bucket records publish their own stated totals", () => {
  const cases: Array<[string, readonly number[], string]> = [
    ["Bezos", BEZOS, "$10,335,174"],
    ["Resnick", RESNICK, "$71,632,035"],
    ["Hubbard", HUBBARD, "$11,822,391"],
    ["Kelley", KELLEY, "$845,210"],
    ["Larsen", LARSEN, "$6,687,749"],
    // MacMillan's record was not re-dumped; his stated total is a stored figure by the same
    // shaped-value mechanism as the other five. Named here so the gap is visible rather than implied.
  ];
  for (const [who, record, stated] of cases) {
    const verdict = block(`Federal records show ${stated} in contributions [FEC].`, record);
    assert.deepEqual(verdict.disagreements, [], `${who} must publish: ${stated} is his own stored total`);
  }
});

// ---------------------------------------------------------------------------
// ADVERSARIAL REVIEW 2026-09-15 — four true sections the first live build DELETED.
// Reproduced by the review against the imported predicate; each is a real shape.
// ---------------------------------------------------------------------------

test("(review) two EQUAL grants make a true subtotal — a repeated figure still sums", () => {
  assert.deepEqual(block("The foundation paid $689,538 across two equal 2024 grants [IRS].", [344769, 344769, 669538]).disagreements, []);
});

test("(review) a refund nets — a negative stored figure sums as signed", () => {
  assert.deepEqual(block("Net of a refund, the committee kept $646,082 [FEC].", [669538, -23456, 646092]).disagreements, []);
});

test("(review) a range whose unit sits after its far end is never read at the near end", () => {
  assert.deepEqual(block("Grants ranged from $89,538–90,000K [IRS].", [89538000, 90000000, 89558]).disagreements, []);
});

test("(review) a B suffix scales the figure, so it is dropped, not truncated", () => {
  assert.deepEqual(block("Assets of $89,538B [990].", [89558]).disagreements, []);
});

test("(review 2) a negative half-dollar total agrees — agreement never narrower than derivedSums", () => {
  assert.deepEqual(block("Refunds totalled $70,370.50 [FEC].", [-12345.5, -23456.5, -34568.5]).disagreements, []);
});

test("(review 2) a STORED amount followed by a count survives extraction, so a true summary publishes", () => {
  const fact = [{ amount: 89558, description: "Gave $89,538 to 12 charities." }];
  assert.deepEqual(block("The foundation gave $89,538 in grants [IRS].", storedFiguresForSummary(fact, fact)).disagreements, []);
});

test("(review 2) a scaled range with a second dollar sign is not read at its near end", () => {
  assert.deepEqual(block("Grants ranged from $89,538–$90,000K [IRS].", [89538000, 90000000, 89558]).disagreements, []);
});

test("(review 2) the exported agreement rule is the block's — the probe excludes exactly what publishes", () => {
  // 679,538 = 669,538 + 5,000 + 5,000: a repeated sum the block publishes, which the probe once counted as a miss.
  assert.equal(figureAgreesWithRecord(679538, [669538, 5000]), true);
  assert.deepEqual(block("$679,538", [669538, 5000]).disagreements, []);
  assert.equal(figureAgreesWithRecord(689538, JORDAN), false, "Jordan's real typo must not agree");
});

test("(review 3) a stored amount before a SCALED count survives extraction — only prose skips ambiguity", () => {
  const fact = [{ amount: 89558, description: "Gave $89,538 to 1 million children." }];
  assert.deepEqual(block("The foundation gave $89,538 to support children [IRS].", storedFiguresForSummary(fact, fact)).disagreements, []);
});

test("(review 3) a range joined by WORDS is not read at its near end", () => {
  const record = [12345000000, 12350000000, 12365];
  assert.deepEqual(block("Assets ranged between $12,345 and $12,350 million [990].", record).disagreements, []);
  assert.deepEqual(block("Assets ran from $12,345 through $12,350 million [990].", record).disagreements, []);
});

// ---------------------------------------------------------------------------
// The conservative rules, each pinned in the direction that PUBLISHES.
// ---------------------------------------------------------------------------

test("a round figure can never be read as a typo — under 5 significant digits", () => {
  assert.deepEqual(block("The gift was $200,000 [IRS].", [201000, 5000]).disagreements, []);
});

test("a year and a contribution count are not dollar figures", () => {
  assert.deepEqual(block("In 2023 he made 466 contributions.", [2024, 467]).disagreements, []);
});

test("a figure one edit from TWO different targets names neither", () => {
  // 669,538 is one edit from both 669,537 and 669,548.
  assert.deepEqual(block("$669,538", [669537, 669548]).disagreements, []);
});

test("a scaled headline figure is dropped, not truncated", () => {
  // "$26.3 billion" must never be read as 263 — nor as 26.3 colliding with a stored 26.4.
  assert.deepEqual(block("She has given more than $26.3 billion [source].", [26400000000]).disagreements, []);
});

test("an inserted digit changes magnitude and is left alone", () => {
  assert.deepEqual(block("$6,695,380", [669538]).disagreements, []);
});

test("empty text, no figures and no stored record all publish", () => {
  assert.deepEqual(block("", JORDAN).disagreements, []);
  assert.deepEqual(block("No amounts appear in this sentence.", JORDAN).disagreements, []);
  assert.deepEqual(block("$689,538", []).disagreements, []);
});

// ---------------------------------------------------------------------------
// The cap REFUSES rather than falling back — and a refusal is not an empty result.
// ---------------------------------------------------------------------------

test("over the cap the block REFUSES and reports it, rather than publishing a quiet clean verdict", () => {
  const huge = Array.from({ length: MAX_FIGURES_FOR_DERIVATION + 1 }, (_, i) => 100000 + i * 7);
  const verdict = findBlockingFigureDisagreements("$689,538", huge);
  assert.equal(verdict.refused, true, "the caller must be able to tell 'not judged' from 'nothing found'");
  assert.deepEqual(verdict.disagreements, [], "a refusal never blocks");
  assert.equal(derivedSums(huge), null, "null is the refusal signal, distinct from an empty array");
});

test("the cap does not bind on the heaviest live record measured 2026-09-15", () => {
  // Corpus max distinct magnitudes was 39 (David Tepper, Brian Armstrong, MacKenzie Scott).
  // If a future record crosses 120 the block goes silent on it BY DESIGN — this test is the tripwire
  // that makes that a decision rather than a surprise.
  for (const record of [JORDAN, BEZOS, RESNICK, HUBBARD, KELLEY, LARSEN]) {
    assert.ok(record.length <= MAX_FIGURES_FOR_DERIVATION);
    assert.notEqual(derivedSums(record), null);
  }
});
