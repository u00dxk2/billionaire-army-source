import { test } from "node:test";
import assert from "node:assert/strict";
import { labelFecTruncationForPrompt, FEC_PAGE_CAP } from "./summary-fact-collapse";
import { buildUserPrompt } from "./summary-prompt";

/**
 * COPIED FROM PROD, not invented — Henry Davis's `fec_contributions` fact on 2026-08-29, whose
 * live profile read *"FEC records show 100 contributions totaling $2,388.28 from 2025-09-28 to
 * 2025-12-31"*. Every number in that sentence is an artifact of `per_page=100`: a three-month
 * window and a four-figure total for a record that is larger and longer on both counts. 481
 * published profiles stated a count of 100 the same way.
 */
const DAVIS_FEC_FACT = {
  count: 100,
  dateRange: "2025-09-28 to 2025-12-31",
  totalAmount: 2388.2799999999997,
  topRecipients: [{ name: "WINRED", amount: 835.64 }],
  partyBreakdown: { REP: 1552.64, "PAC/Other": 835.64 },
};

/** A genuinely complete record — 329 of 877 approved persons are under the cap. */
const UNDER_CAP_FACT = {
  count: 17,
  dateRange: "2018-10-30 to 2025-07-01",
  totalAmount: 48300,
  partyBreakdown: { DEM: 4000, REP: 3000, "PAC/Other": 41300 },
};

const personWith = (factValue: unknown) => ({
  id: "test",
  name: "Henry Davis",
  state: "New York",
  industry: ["Finance"],
  birthYear: 1970,
  country: "United States",
  facts: [{ factKey: "fec_contributions", factValue, sourceType: "fec" }],
});

test("a capped record loses the bare count and date range entirely — there is nothing left to copy", () => {
  const out = labelFecTruncationForPrompt(DAVIS_FEC_FACT) as Record<string, unknown>;
  assert.equal(out.count, undefined, "the bare count must not survive");
  assert.equal(out.dateRange, undefined, "the bare date range must not survive");
  assert.equal(out.recordIsTruncated, true);
  assert.equal(out.contributionsInThisSample, 100);
  assert.equal(out.dateRangeOfThisSampleOnly, "2025-09-28 to 2025-12-31");
  assert.match(String(out.truncationNote), /AT LEAST 100/);
});

test("a complete record is returned untouched — 329 profiles must not be hedged into false doubt", () => {
  assert.equal(labelFecTruncationForPrompt(UNDER_CAP_FACT), UNDER_CAP_FACT);
  assert.equal(labelFecTruncationForPrompt(null), null);
  assert.equal(labelFecTruncationForPrompt("string"), "string");
  const noCount = { noCount: true };
  assert.equal(labelFecTruncationForPrompt(noCount), noCount, "a fact with no count field is untouched");
});

test("the FEC's own reported total is used when the fetcher captured it", () => {
  const withTotal = { ...DAVIS_FEC_FACT, reportedTotalContributions: 4213 };
  const out = labelFecTruncationForPrompt(withTotal) as Record<string, unknown>;
  assert.equal(out.reportedTotalContributions, 4213);
  assert.match(String(out.truncationNote), /the FEC reports 4213 in total/);
});

/**
 * THE WIRE-UP TEST — the one that matters, and the reason this file exists rather than a helper
 * test alone. `labelFecTruncationForPrompt` stays green forever if nobody calls it; that is how
 * the 2026-08-26 /today float defect survived a green suite, and it is why the 2026-08-28 units
 * fix shipped its own wire-up assertion. This asserts the string the model actually receives.
 */
test("WIRE-UP: the prompt the model receives cannot state 100 as a complete count", () => {
  const prompt = buildUserPrompt(personWith(DAVIS_FEC_FACT) as never);
  assert.ok(prompt.includes("recordIsTruncated"), "the truncation flag must reach the model");
  assert.ok(prompt.includes("TRUNCATED SAMPLE"), "the note must reach the model");
  assert.ok(!prompt.includes('"count"'), "no bare count field may reach the model");
  assert.ok(!prompt.includes('"dateRange"'), "no bare date range may reach the model");
  // The money labelling from the 08-28 fix must still be intact — the three shapers compose.
  assert.ok(prompt.includes("partyBreakdownUsd"), "the units fix must survive the truncation pass");
  assert.ok(!prompt.includes("2388.2799999999997"), "the raw float must not reach the model");
});

test("WIRE-UP: a complete record still reaches the model as a plain count", () => {
  const prompt = buildUserPrompt(personWith(UNDER_CAP_FACT) as never);
  assert.ok(prompt.includes('"count":17'), "a genuine count must survive untouched");
  assert.ok(!prompt.includes("TRUNCATED SAMPLE"), "a complete record must not be hedged");
});

test("the cap is one constant, so the helper and the fetcher cannot drift", () => {
  assert.equal(FEC_PAGE_CAP, 100);
});
