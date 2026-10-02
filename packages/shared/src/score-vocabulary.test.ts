import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READER_FACING_SCORE_NOUN,
  namesInternalScore,
  readerFacingScoreFigures,
  readerFacingScorePhrase,
  readerFacingScoreValue,
  repairScoreProse,
} from "./score-vocabulary";

/** Every live card measured on 2026-09-03 had exactly one tagged person; that is the repair's arm. */
const ONE_PERSON = 1;

/**
 * R-081. Measured on the served 40 on 2026-09-03: five cards named the platform's own score in
 * reader-facing prose, one of them PROMOTED at position 1, all five about MacKenzie Scott, each
 * three inches from a badge reading "GIVING A (92)".
 *
 * The asymmetry that matters is the one every prose repair in this repo has: over-matching would
 * rewrite a number that was correct, on a platform whose thesis is that no claim outruns its
 * citation. Every "leaves it alone" case below is load-bearing, not filler — and the sentences
 * that DO get repaired are quoted verbatim from prod, not invented, so the grammar this repair
 * has to survive is the grammar the generator actually writes.
 */

// The five live summaries, verbatim from `GET /api/feed?limit=40` on 2026-09-03. The live score
// that day was 91.6, so the badge rendered 92.
const LIVE_PBS = 91.6;

const LIVE_SUMMARIES: Array<{ id: string; text: string; promoted: boolean }> = [
  {
    id: "15aeda54",
    promoted: true,
    text:
      "Scott is estimated to be worth $59.4 billion and has a PBS score of 91.60; the article " +
      "describes her as having given away nearly half her fortune.",
  },
  {
    id: "e560f0c3",
    promoted: false,
    text:
      "Scott’s estimated fortune is about $59.4 billion and her PBS score is 91.60, placing " +
      "the real-estate gift in the context of her broader philanthropic profile.",
  },
  {
    id: "a97f9303",
    promoted: false,
    text:
      "Scott’s estimated $59.4 billion net worth and 91.60 PBS score put the scale of that " +
      "giving in unusually clear perspective — even by billionaire-philanthropy standards.",
  },
  {
    id: "0f34d0d4",
    promoted: false,
    text:
      "Scott is worth an estimated $59.4 billion and has a 91.60 PBS score; her reported federal " +
      "political donations total about $712.",
  },
  {
    id: "96a3beb0",
    promoted: false,
    text:
      "Scott, whose net worth is estimated at $59.4 billion and whose PBS score is 91.60, has " +
      "used large unrestricted-style gifts to make debt relief a recurring part of her giving " +
      "footprint.",
  },
];

test("every one of the five live sentences is detected", () => {
  for (const s of LIVE_SUMMARIES) {
    assert.ok(namesInternalScore(s.text), `card ${s.id} must be detected`);
  }
});

test("every one of the five live sentences is repaired to the badge's name and figure", () => {
  for (const s of LIVE_SUMMARIES) {
    const after = repairScoreProse(s.text, LIVE_PBS, ONE_PERSON);
    assert.ok(!/PBS/i.test(after), `card ${s.id}: the acronym must be gone — got: ${after}`);
    assert.ok(!after.includes("91.60"), `card ${s.id}: the second rounding must be gone`);
    assert.ok(after.includes(`${READER_FACING_SCORE_NOUN}`), `card ${s.id}: must name the badge's score`);
    assert.ok(after.includes("92"), `card ${s.id}: must state the badge's figure`);
    assert.ok(!namesInternalScore(after), `card ${s.id}: repaired text must not re-detect`);
  }
});

test("the repaired sentences read as the author wrote them — only the name and the digits change", () => {
  assert.equal(
    repairScoreProse(LIVE_SUMMARIES[0].text, LIVE_PBS, ONE_PERSON),
    "Scott is estimated to be worth $59.4 billion and has a giving score of 92; the article " +
      "describes her as having given away nearly half her fortune."
  );
  assert.equal(
    repairScoreProse(LIVE_SUMMARIES[1].text, LIVE_PBS, ONE_PERSON),
    "Scott’s estimated fortune is about $59.4 billion and her giving score is 92, placing " +
      "the real-estate gift in the context of her broader philanthropic profile."
  );
  assert.equal(
    repairScoreProse(LIVE_SUMMARIES[2].text, LIVE_PBS, ONE_PERSON),
    "Scott’s estimated $59.4 billion net worth and 92 giving score put the scale of that " +
      "giving in unusually clear perspective — even by billionaire-philanthropy standards."
  );
  assert.equal(
    repairScoreProse(LIVE_SUMMARIES[3].text, LIVE_PBS, ONE_PERSON),
    "Scott is worth an estimated $59.4 billion and has a 92 giving score; her reported federal " +
      "political donations total about $712."
  );
  assert.equal(
    repairScoreProse(LIVE_SUMMARIES[4].text, LIVE_PBS, ONE_PERSON),
    "Scott, whose net worth is estimated at $59.4 billion and whose giving score is 92, has " +
      "used large unrestricted-style gifts to make debt relief a recurring part of her giving " +
      "footprint."
  );
});

test("a frozen score that has since MOVED is restated at the live figure, not merely rounded", () => {
  // The stored prose is a snapshot; `contextData.pbs` is overridden live on both feed routes. A
  // rescore is exactly when the card starts contradicting its own badge by a wide margin.
  const after = repairScoreProse("She has a PBS score of 91.60 today.", 40.2, ONE_PERSON);
  assert.equal(after, "She has a giving score of 40 today.");
});

// ---------------------------------------------------------------------------
// Leaves it alone. Each of these is a way over-matching would put a false claim on the card.
// ---------------------------------------------------------------------------

test("the BROADCASTER is never touched — the bigram, not a bare acronym, is the anchor", () => {
  const text =
    "The foundation gave $5 million to PBS NewsHour and another $2 million to PBS member stations.";
  assert.equal(namesInternalScore(text), false);
  assert.equal(repairScoreProse(text, LIVE_PBS, ONE_PERSON), text);
});

test("a dollar figure, a net worth and a percentage are never rewritten", () => {
  const text =
    "Scott is worth an estimated $59.4 billion, gave away 12.5 percent of it, and 91.60 of that " +
    "went to education.";
  assert.equal(namesInternalScore(text), false);
  assert.equal(repairScoreProse(text, LIVE_PBS, ONE_PERSON), text);
});

test("with no live score in hand it is a no-op — an absent badge is not repaired with an invented figure", () => {
  const text = "Scott has a PBS score of 91.60.";
  assert.equal(repairScoreProse(text, null, ONE_PERSON), text);
  assert.equal(repairScoreProse(text, undefined, ONE_PERSON), text);
  assert.equal(repairScoreProse(text, "not a number", ONE_PERSON), text);
  assert.equal(repairScoreProse(text, Number.NaN, ONE_PERSON), text);
  // `Number("")` is 0, not NaN — the false zero this repo forbids on every surface.
  assert.equal(repairScoreProse(text, "", ONE_PERSON), text);
  assert.equal(repairScoreProse(text, "   ", ONE_PERSON), text);
});

test("empty and non-string inputs pass straight through", () => {
  assert.equal(repairScoreProse("", LIVE_PBS, ONE_PERSON), "");
  assert.equal(repairScoreProse(undefined as unknown as string, LIVE_PBS, ONE_PERSON), undefined);
  assert.equal(namesInternalScore(""), false);
  assert.equal(namesInternalScore(undefined as unknown as string), false);
});

test("a text with no score mention is returned byte-identical", () => {
  const text = "Elon Musk criticized MacKenzie Scott’s charitable giving.";
  assert.equal(repairScoreProse(text, LIVE_PBS, ONE_PERSON), text);
});

// ---------------------------------------------------------------------------
// The four defects a cold Codex round found on the first version of this file, 2026-09-03.
// Each is pinned by the exact input it named, so a future simplification re-opens them loudly.
// ---------------------------------------------------------------------------

test("MULTI-PERSON CARDS ARE NEVER REPAIRED — the false zero the repair could have manufactured", () => {
  // The live score belongs to the card's PRIMARY tagged person; the summary can name another one.
  // On a [Musk, Scott] card with Musk at 0, an unguarded repair prints "a giving score of 0" under
  // MacKenzie Scott's name — a false claim about a named living person, invented by the fix.
  const text = "MacKenzie Scott has a PBS score of 91.60.";
  assert.equal(repairScoreProse(text, 0, 2), text, "a two-person card is left exactly as written");
  assert.equal(repairScoreProse(text, 91.6, 2), text, "and that holds even when the score is right");
  assert.equal(repairScoreProse(text, 91.6, 0), text, "an untagged card too");
  // The gate still sees it — dropping on doubt must not mean hiding it.
  assert.equal(namesInternalScore(text), true);
});

test("A THIRD PARTY'S PERCENTAGE is not our score — '%' after the figure is somebody else's number", () => {
  const text = "The PBS score is 91.60% in the broadcaster-trust survey.";
  assert.equal(repairScoreProse(text, 40.2, ONE_PERSON), text);
  // Still DETECTED, deliberately: the detector over-fires so a human adjudicates, and the repair
  // under-fires so nothing correct is silently rewritten.
  assert.equal(namesInternalScore(text), true);
});

test("A DOLLAR FIGURE before the score's name is not our score either", () => {
  const text = "A $91.60 PBS score donation went unrecorded.";
  assert.equal(repairScoreProse(text, 40.2, ONE_PERSON), text);
});

test("THE PAST TENSE does not escape — 'score was 91.60' is the same defect in another tense", () => {
  assert.equal(namesInternalScore("MacKenzie Scott's PBS score was 91.60 before the rescore."), true);
  assert.equal(
    repairScoreProse("MacKenzie Scott's PBS score was 91.60 before the rescore.", 40.2, ONE_PERSON),
    "MacKenzie Scott's giving score was 40 before the rescore.",
  );
});

test("ANY shape naming the score internally is DETECTED, even one the repair will not touch", () => {
  // The detector is deliberately broader than the repairer: an under-firing detector hides a live
  // defect, an over-firing repairer rewrites a number that was correct.
  for (const text of [
    "Her PBS score, recalculated last week, sits near the top.",
    "The Public Benefit Score methodology is published in full.",
    "PBS score: 91.60",
  ]) {
    assert.equal(namesInternalScore(text), true, `must detect: ${text}`);
  }
});

test("OUR OWN vocabulary goes stale too, and the repair refreshes it — otherwise the fix re-creates the bug", () => {
  // The curator is now steered toward "giving grade A (92 of 100)". After a rescore that phrase is
  // exactly the two-figure contradiction R-081 is about, under an approved label.
  assert.equal(
    repairScoreProse("Scott's giving grade is A (92 of 100).", 40.2, ONE_PERSON),
    "Scott's giving grade is C (40 of 100).",
  );
  assert.equal(
    repairScoreProse("Scott has a giving score of 92.", 40.2, ONE_PERSON),
    "Scott has a giving score of 40.",
  );
  assert.equal(
    repairScoreProse("Scott's 92 giving score leads the index.", 40.2, ONE_PERSON),
    "Scott's 40 giving score leads the index.",
  );
});

test("the repair is IDEMPOTENT — running it twice changes nothing the second time", () => {
  const once = repairScoreProse(LIVE_SUMMARIES[0].text, LIVE_PBS, ONE_PERSON);
  assert.equal(repairScoreProse(once, LIVE_PBS, ONE_PERSON), once);
});

test("readerFacingScoreFigures reads what the card CLAIMS, so a gate can compare it with the badge", () => {
  assert.deepEqual(readerFacingScoreFigures("Scott has a giving score of 92."), [92]);
  assert.deepEqual(readerFacingScoreFigures("Scott's giving grade is A (92 of 100)."), [92]);
  assert.deepEqual(readerFacingScoreFigures("Scott's 92 giving score leads."), [92]);
  // Nothing to compare: no claim about our score at all.
  assert.deepEqual(readerFacingScoreFigures("Scott gave $26.2 billion, 12.5 percent of her wealth."), []);
  assert.deepEqual(readerFacingScoreFigures(""), []);
});

// ---------------------------------------------------------------------------
// The vocabulary itself
// ---------------------------------------------------------------------------

test("the reader-facing figure is the badge's rounding, in both directions", () => {
  assert.equal(readerFacingScoreValue(91.6), 92);
  assert.equal(readerFacingScoreValue(91.4), 91);
  assert.equal(readerFacingScoreValue(0), 0);
});

test("the curator is handed the badge's own label and the badge's own figure", () => {
  const phrase = readerFacingScorePhrase(91.6);
  assert.ok(phrase, "a usable score must produce a phrase");
  assert.ok(phrase!.includes("92"), "must carry the badge's integer, never the stored decimal");
  assert.ok(!phrase!.includes("91.6"), "must not hand the model a second rounding to echo");
  assert.ok(!/PBS/i.test(phrase!), "must not hand the model the internal acronym to echo");
  assert.ok(phrase!.startsWith("giving grade "), `unexpected phrase: ${phrase}`);
});

test("the phrase the curator is handed does not itself trip the detector", () => {
  // Otherwise the write-path fix would publish cards the gate reds on the same day it ships.
  assert.equal(namesInternalScore(readerFacingScorePhrase(91.6)!), false);
});

test("an unusable score yields NO phrase — the prompt drops the line rather than inventing one", () => {
  // `context.pbs` is `string | null` in the curator. A person with no score snapshot must not be
  // described to the model with a fabricated grade.
  assert.equal(readerFacingScorePhrase(null), null);
  assert.equal(readerFacingScorePhrase(undefined), null);
  assert.equal(readerFacingScorePhrase(""), null);
  assert.equal(readerFacingScorePhrase("not a number"), null);
  assert.equal(readerFacingScorePhrase("91.6"), "giving grade A (92 of 100)");
});
