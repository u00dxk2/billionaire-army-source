import { test } from "node:test";
import assert from "node:assert/strict";
import { CROSS_RUN_EVENT_THRESHOLD } from "./feed-event-dedup";
import { GRAY_BAND_FLOOR, grayBandMatches, parseSameVerdicts, remapToOriginal } from "./feed-same-event-judge";

/**
 * Headlines below are verbatim from the live front door (2026-08-03 probe run). The band
 * cases are the real ones: every measured duplicate sat in 0.25..0.364, and the collapsed
 * set (>= 0.40) was empty — which is why this judge reads BELOW the threshold.
 */

const KOUM_A = "Jan Koum gives $200 million to Shaare Zedek Medical Center";
const KOUM_B = "Jan Koum donates $200 million to expand Jerusalem’s Shaare Zedek hospital";
const BUFFETT_A = "Buffett Ends Gates Foundation Donations After Two Decades, While Berkshire Holdings Remain Influential";
const BUFFETT_B = "Buffett discusses Gates Foundation donations, Epstein regret and estate plans";

// --- band selection ---

test("a real live duplicate pair lands in the band the judge is asked about", () => {
  const got = grayBandMatches([KOUM_A], [KOUM_B]);
  assert.equal(got.length, 1);
  assert.ok(got[0].score >= GRAY_BAND_FLOOR);
  assert.ok(got[0].score < CROSS_RUN_EVENT_THRESHOLD);
});

test("the Buffett pair the deterministic guard misses is asked about", () => {
  assert.equal(grayBandMatches([BUFFETT_A], [BUFFETT_B]).length, 1);
});

test("pairs at or above the threshold are NOT asked — the guard already dropped them", () => {
  // Identical text scores 1.0: firmly the guard's business, never the judge's.
  assert.equal(grayBandMatches([KOUM_A], [KOUM_A]).length, 0);
});

test("unrelated headlines are not asked about", () => {
  assert.equal(
    grayBandMatches(["Elon Musk sells Tesla shares"], ["Illinois Gov. J.B. Pritzker signs AI regulation into law"]).length,
    0
  );
});

test("a candidate is asked about its BEST published match only, never once per neighbour", () => {
  const got = grayBandMatches([KOUM_A], [KOUM_B, "Jan Koum gives $200 million for a surgical tower at a Jerusalem hospital"]);
  assert.equal(got.length, 1);
});

test("empty published set asks nothing", () => {
  assert.equal(grayBandMatches([KOUM_A], []).length, 0);
});

// --- verdict parsing: anything that is not an explicit SAME is a keep ---

test("SAME verdicts are collected from the documented envelope", () => {
  const { duplicate, reasons } = parseSameVerdicts(
    JSON.stringify({ verdicts: [{ index: 3, verdict: "SAME", reason: "one $200M gift" }] })
  );
  assert.deepEqual([...duplicate], [3]);
  assert.equal(reasons.get(3), "one $200M gift");
});

test("SAME verdicts are collected from a bare array too", () => {
  const { duplicate } = parseSameVerdicts(JSON.stringify([{ index: 1, verdict: "same" }]));
  assert.deepEqual([...duplicate], [1]);
});

test("DIFFERENT keeps the card", () => {
  const { duplicate } = parseSameVerdicts(
    JSON.stringify({ verdicts: [{ index: 0, verdict: "DIFFERENT", reason: "two different gifts" }] })
  );
  assert.equal(duplicate.size, 0);
});

test("a verdict with no usable index is skipped, not guessed at", () => {
  const { duplicate } = parseSameVerdicts(JSON.stringify({ verdicts: [{ verdict: "SAME" }] }));
  assert.equal(duplicate.size, 0);
});

test("an unrecognised verdict word keeps the card (refute-only)", () => {
  const { duplicate } = parseSameVerdicts(JSON.stringify({ verdicts: [{ index: 0, verdict: "MAYBE" }] }));
  assert.equal(duplicate.size, 0);
});

// --- B-023 Pass D: index remapping across the post-B/C filter ---------------------
//
// The hazard is silent, which is why it is pinned: Pass D scores only the cards still
// standing after Passes B/C/attribution, so a matcher index is an index into THAT subset.
// Using it against the unfiltered list drops a different, innocent card while the log
// names the duplicate it meant to drop.

test("remapToOriginal maps subset indices back onto the caller's own indices", () => {
  // curated 0..4; Pass B rejected 1, Pass C dropped 3 => live subset is [0, 2, 4].
  const originals = [0, 2, 4];
  // The matcher flagged subset positions 1 and 2 — i.e. curated 2 and 4.
  assert.deepEqual(remapToOriginal([1, 2], originals), [2, 4]);
});

test("remapToOriginal is NOT the identity when anything was filtered out", () => {
  // The whole point: without the remap, flagging subset index 1 would drop curated 1,
  // which Pass B already rejected, while curated 2 — the actual duplicate — still ships.
  const originals = [0, 2, 4];
  assert.notDeepEqual(remapToOriginal([1], originals), [1]);
  assert.deepEqual(remapToOriginal([1], originals), [2]);
});

test("remapToOriginal drops an out-of-range index rather than emitting undefined", () => {
  assert.deepEqual(remapToOriginal([0, 99], [7]), [7]);
});

test("grayBandMatches above the ceiling returns the hard duplicates Pass D drops without asking", () => {
  // Pass D reuses grayBandMatches TWICE: [floor, threshold) for the judge, and
  // [threshold, Infinity) for the score-settles-it set. Pin the second bound so a change
  // to the shared helper cannot silently empty the no-judge-needed path.
  const hard = grayBandMatches([KOUM_A], [KOUM_A], CROSS_RUN_EVENT_THRESHOLD, Infinity);
  assert.equal(hard.length, 1);
  assert.equal(hard[0].score, 1);
  // ...and the SAME call at the judge's bounds must NOT claim it, or the two paths overlap.
  assert.equal(grayBandMatches([KOUM_A], [KOUM_A], GRAY_BAND_FLOOR, CROSS_RUN_EVENT_THRESHOLD).length, 0);
});
