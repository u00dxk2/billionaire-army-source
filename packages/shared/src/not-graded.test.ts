import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeStatus, NOT_GRADED_LABEL } from "./pbs-evidence";
import { statesOwnScore, withholdScoreProse, readerFacingScorePhrase } from "./score-vocabulary";

/**
 * NOT GRADED (2026-10-02). A person with no giving fact on file carries no letter and no number.
 * Measured that morning: 358 of 1,102 approved profiles, every one graded F, D or C by a score
 * made entirely of how many fact types we hold about them.
 */

test("no giving fact ⇒ not graded, whatever else is on file", () => {
  assert.equal(gradeStatus([]), "not_graded");
  assert.equal(gradeStatus(["net_worth", "fec_contributions", "sec_filings", "profile_summary"]), "not_graded");
});

test("a Giving Pledge signer with no giving amount is NOT graded — a promise is not a record", () => {
  // The pledge alone scored 0.15 on the component, so a "component is 0" rule kept grading these
  // 21 people (measured 2026-10-02). The rule reads the fact set, never the features blob.
  assert.equal(gradeStatus(["giving_pledge", "net_worth"]), "not_graded");
});

test("either giving fact grades the person, including one that reports zero", () => {
  assert.equal(gradeStatus(["foundation_990s"]), "graded");
  assert.equal(gradeStatus(["total_giving"]), "graded");
  // An evidenced zero (a 990 on file reporting no grants) is a finding and keeps its grade.
  assert.equal(gradeStatus(["foundation_990s", "giving_pledge"]), "graded");
});

test("the factTYPE 'philanthropy' is not evidence — only the two KEYS are", () => {
  // The importer writes factType `philanthropy` on pledge rows too; matching the type would grade
  // every pledge signer again.
  assert.equal(gradeStatus(["philanthropy"]), "not_graded");
});

test("the label the surfaces print", () => {
  assert.equal(NOT_GRADED_LABEL, "Not graded");
});

test("statesOwnScore fires on any sentence that NAMES our score", () => {
  const phrase = readerFacingScorePhrase("13.4");
  assert.ok(phrase && statesOwnScore(`Ballmer carries a Billionaire Army ${phrase}.`));
  assert.ok(statesOwnScore("He has a PBS score of 13.40."));
  assert.ok(statesOwnScore("His giving score is 13."));
  assert.ok(statesOwnScore("A 13 giving score puts him near the bottom."));
  assert.ok(statesOwnScore("He holds a giving grade of F."));
  assert.ok(statesOwnScore("The Public Benefit score puts him last."));
  // The three shapes a cold Codex round got past the first, pattern-matching version (2026-10-02).
  assert.ok(statesOwnScore("His giving score is just 13."));
  assert.ok(statesOwnScore("His giving score 13 reflects our coverage."));
  assert.ok(statesOwnScore("He has an F giving grade."));
});

test("a mention with no figure still withholds — the rule is the NAME, on purpose", () => {
  // The first version read the article "a" here as grade A. The stated rule has no letter
  // pattern to mis-fire: a paragraph about our score, on a not-graded person's card, goes.
  assert.ok(statesOwnScore("The giving score is a measure of documented philanthropy."));
});

test("statesOwnScore leaves money, percentages, giving and the broadcaster alone", () => {
  assert.equal(statesOwnScore("He gave $13 million to PBS NewsHour."), false);
  assert.equal(statesOwnScore("Giving rose 13% last year."), false);
  assert.equal(statesOwnScore("Net worth of $13.4B, per Forbes."), false);
  assert.equal(statesOwnScore("She scored a major giving milestone and earned a grade-school naming."), false);
  assert.equal(statesOwnScore(""), false);
});

test("withholdScoreProse removes the WHOLE summary or returns it byte-identical", () => {
  const stating = "Ballmer gave $50M to a school. He carries a giving grade F (13 of 100).";
  assert.equal(withholdScoreProse(stating), "");
  const clean = "Ballmer gave $50M to a school, per the Seattle Times.";
  assert.equal(withholdScoreProse(clean), clean);
});
