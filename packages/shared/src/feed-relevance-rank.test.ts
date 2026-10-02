import { test } from "node:test";
import assert from "node:assert/strict";
import { accountabilityScore } from "./feed-relevance-rank";

// R-048 branch (A), owner-approved 2026-08-08. Every headline below is REAL, taken
// from the live candidate set the preview ran against - including their GDELT
// spacing, which is the whole point of two of these tests.

test("GDELT spaces punctuation apart, and the noise rule still fires", () => {
  // THE test. Iteration 1 of this rule missed exactly this headline: the pattern
  // was "forward p/e" and the real title says "Forward P / E". It sat at slot 1
  // of the previewed shortlist - the clearest stock-pick in the set, untouched by
  // a rule written for it. Delete normalizeForNoise() and this goes green->red.
  const withSpaces = "Meta Trades at a Forward P / E of 17 , Below Its 5 - Year Average , Making the Stock a Potential Bargain";
  assert.ok(accountabilityScore(withSpaces) < 0, `expected negative, got ${accountabilityScore(withSpaces)}`);
});

test("an earnings-call transcript sinks hard", () => {
  assert.ok(accountabilityScore("Kinder Morgan ( KMI ) Q2 2026 Earnings Call Transcript") < 0);
});

test("rich-list churn sinks", () => {
  assert.ok(accountabilityScore("Zuckerberg Net Worth Drops 18 Billion : Meta AI Spending Shock") <= 0);
  assert.ok(accountabilityScore("Bezos Is Third - Richest Again Reclaiming Spot From Google Sergei Brin") < 0);
});

test("a ticker cashtag marks a markets story", () => {
  assert.ok(accountabilityScore("Edgestream Partners L . P . Reduces Stake in Stryker Corporation $SYK") <= 0);
});

test("a REAL GIVING STORY is not penalized - the case this rule must not break", () => {
  // The most dangerous false positive available: it is about shares, a foundation
  // and a dollar figure, and it is exactly the accountability receipt the feed
  // exists to publish. "shares" was deliberately kept OUT of the noise list for
  // this reason; if someone adds it, this test is what says no.
  const giving = "Warren Buffett Donated $6 Billion in Berkshire Hathaway Shares Recently -- and Cut the Gates Foundation Off";
  assert.ok(accountabilityScore(giving) > 0, `expected positive, got ${accountabilityScore(giving)}`);
});

test("bare 'net worth' is NOT noise - it is the product's own vocabulary", () => {
  // Only the CHURN phrases are penalized. A story stating someone's net worth
  // alongside their giving is the core card, not noise.
  const s = accountabilityScore("Foundation gave $2 billion last year against a $90 billion net worth");
  assert.ok(s > 0, `expected positive, got ${s}`);
});

test("an on-thesis policy story survives", () => {
  assert.ok(accountabilityScore("Pritzker signs school cellphone ban to avoid student distractions") >= 0);
});
