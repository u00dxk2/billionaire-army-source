import { test } from "node:test";
import assert from "node:assert/strict";
import { voteCastAt, VOTE_CAST_AT_TRUST_WINDOW_MS } from "./vote-cast-at";

const NOW = Date.UTC(2026, 8, 18, 17, 0, 0);

test("the voter's own stamp is what orders their two verdicts", () => {
  assert.equal(voteCastAt(NOW - 5000, NOW).getTime(), NOW - 5000);
  assert.equal(voteCastAt(NOW, NOW).getTime(), NOW);
});

test("a missing or junk stamp falls back to now — an old client is never refused", () => {
  for (const junk of [undefined, null, "1758212000000", NaN, Infinity, {}]) {
    assert.equal(voteCastAt(junk, NOW).getTime(), NOW);
  }
});

test("a stamp outside the window is REPLACED by server time, never bent toward it", () => {
  // Round 3's inversion: clamping mapped an out-of-range stamp to a bound derived from `now`, so the
  // OLDER verdict — arriving later, with a later `now` — clamped ABOVE the newer one and won.
  const skew = 24 * 60 * 60_000;
  const newerArrivesFirst = voteCastAt(NOW + skew, NOW).getTime();
  const olderArrivesSecond = voteCastAt(NOW + skew - 5000, NOW + 1000).getTime();
  assert.equal(newerArrivesFirst, NOW, "a skewed stamp is discarded for server time");
  assert.equal(olderArrivesSecond, NOW + 1000, "…and so is its predecessor");
  assert.ok(
    olderArrivesSecond > newerArrivesFirst,
    "STATED CEILING: a client outside the window gets today's last-arrival-wins, NOT a guaranteed order",
  );
});

test("the window is symmetric, and its edge is inclusive", () => {
  assert.equal(voteCastAt(NOW - VOTE_CAST_AT_TRUST_WINDOW_MS, NOW).getTime(), NOW - VOTE_CAST_AT_TRUST_WINDOW_MS);
  assert.equal(voteCastAt(NOW + VOTE_CAST_AT_TRUST_WINDOW_MS, NOW).getTime(), NOW + VOTE_CAST_AT_TRUST_WINDOW_MS);
  assert.equal(voteCastAt(NOW - VOTE_CAST_AT_TRUST_WINDOW_MS - 1, NOW).getTime(), NOW);
  assert.equal(voteCastAt(NOW + VOTE_CAST_AT_TRUST_WINDOW_MS + 1, NOW).getTime(), NOW);
});

test("THE CASE THIS EXISTS FOR: reversed arrival inside the window keeps the LAST verdict", () => {
  // The voter chooses approve at T, goes Back and disapproves at T+2s; the T request commits last.
  const chosenFirst = voteCastAt(NOW, NOW + 40).getTime();
  const chosenSecond = voteCastAt(NOW + 2000, NOW + 30).getTime();
  assert.ok(chosenSecond > chosenFirst, "the API's stored <= incoming guard refuses the older one whichever arrives last");
});
