import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPERSEDED_CARDS, isSupersededCard, supersededCardIds } from "./feed-superseded";

// The three judge-confirmed SAME pairs from the live front door, 2026-09-05
// (PROBE_JUDGE=1 npm run check:frontdoor -> NOT CLEAR, 3 of 11 pairs SAME).
// Named here so the set this file exists to remove is READABLE, not just counted.
const ACKMAN_KEPT = "d6e6b527-4fb2-4873-8522-7c35c2a07488"; // Ackman + Oxman, 09-04
const ACKMAN_WITHHELD = "1061c305-7566-45ab-87b1-c55563e20dc3"; // Ackman Pershing, 08-24
const SCOTT_DEBATE = "5f5ad59f-1fda-42dc-a07a-583ca737cd9d"; // 09-05
const SCOTT_VS_MUSK = "83853b3a-7198-407c-9e5d-d7282568f643"; // 09-04
const SCOTT_WITHHELD = "a97f9303-b99a-48db-b57e-397a3aa5367e"; // 09-01, duplicates BOTH

test("today's duplicate set is withheld — the two cards a reader was meeting twice", () => {
  assert.equal(isSupersededCard(ACKMAN_WITHHELD), true);
  assert.equal(isSupersededCard(SCOTT_WITHHELD), true);
});

test("the SURVIVOR of each pair is never withheld — suppressing both would delete the receipt", () => {
  // The failure this pins is not hypothetical: suppress both halves and the front door
  // silently loses a real story, which is strictly worse than showing it twice.
  assert.equal(isSupersededCard(ACKMAN_KEPT), false);
  assert.equal(isSupersededCard(SCOTT_DEBATE), false);
  assert.equal(isSupersededCard(SCOTT_VS_MUSK), false);
});

test("three adjudicated pairs collapse to TWO withheld cards", () => {
  // a97f9303 duplicates BOTH Scott survivors, so one suppression closes two pairs. If a
  // future edit expands this to three entries, one of the survivors is being deleted.
  assert.equal(supersededCardIds().length, 2);
});

test("every entry points at a survivor that is itself served", () => {
  for (const [withheldId, entry] of SUPERSEDED_CARDS) {
    assert.notEqual(entry.duplicateOf, withheldId, `${withheldId} supersedes itself`);
    assert.equal(
      isSupersededCard(entry.duplicateOf),
      false,
      `${withheldId} defers to ${entry.duplicateOf}, which is ALSO withheld — the pair would vanish entirely`
    );
  }
});

test("every entry carries the evidence that justifies it", () => {
  for (const [id, entry] of SUPERSEDED_CARDS) {
    assert.match(entry.adjudicated, /^\d{4}-\d{2}-\d{2}$/, `${id} has no adjudication date`);
    assert.ok(entry.score > 0 && entry.score < 1, `${id} has no usable score`);
    // A bare id with no prose is how a list like this rots into folklore.
    assert.ok(entry.note.length > 80, `${id} has no readable note`);
  }
});

test("an ordinary card is NOT withheld — the list is a named set, not a heuristic", () => {
  assert.equal(isSupersededCard("00000000-0000-0000-0000-000000000000"), false);
  assert.equal(isSupersededCard(""), false);
});

test("the scores recorded here INTERLEAVE with measured DIFFERENT pairs — why no threshold is used", () => {
  // Measured in the same run: DIFFERENT pairs at 0.250, SAME pairs at 0.286-0.313. Any
  // cut that catches all three SAME pairs also catches a 0.250 DIFFERENT one. This test
  // exists so a future reader who proposes "just lower the threshold" sees the numbers.
  const sameScores = [...SUPERSEDED_CARDS.values()].map((e) => e.score);
  const HIGHEST_MEASURED_DIFFERENT = 0.25;
  assert.ok(
    Math.min(...sameScores) > HIGHEST_MEASURED_DIFFERENT,
    "sanity: recorded SAME scores should sit above the measured DIFFERENT band"
  );
  // ...but only just: 0.308 - 0.250 = 0.058, against a band 0.200-0.400 wide. A cut
  // placed in that 0.058 gap would have to be accurate to a hundredth on 11 samples, and
  // the run ALSO contains a third SAME pair at 0.286 (a97f9303 vs 83853b3a) which is not
  // stored here because this entry records its primary pair only — counting it, the real
  // gap is 0.036. Either way it is far too small to be a threshold, which is the whole
  // argument for adjudicating pairs instead of cutting scores.
  assert.ok(Math.min(...sameScores) - HIGHEST_MEASURED_DIFFERENT < 0.07);
});
