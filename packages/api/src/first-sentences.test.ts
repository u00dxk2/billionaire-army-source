import { test } from "node:test";
import assert from "node:assert/strict";
import { firstSentences } from "./first-sentences.js";

test("does not truncate at 'U.S.' (the live Slootman defect)", () => {
  const overview =
    "Frank Slootman is a U.S. technology executive based in California, born in 1958, with an estimated net worth of ~$3.0B RTB. SEC records show 318 filings tied to him. He has been associated with Snowflake.";
  assert.equal(
    firstSentences(overview, 1),
    "Frank Slootman is a U.S. technology executive based in California, born in 1958, with an estimated net worth of ~$3.0B RTB."
  );
});

test("handles initials in names (J.B. Pritzker)", () => {
  const overview =
    "J.B. Pritzker is an Illinois businessman and politician. He signed an AI bill.";
  assert.equal(
    firstSentences(overview, 1),
    "J.B. Pritzker is an Illinois businessman and politician."
  );
});

test("plain sentences take the first two", () => {
  const overview = "First sentence here. Second one here. Third is dropped.";
  assert.equal(firstSentences(overview, 2), "First sentence here. Second one here.");
});

test("text with no terminal punctuation passes through", () => {
  assert.equal(firstSentences("No punctuation at all", 2), "No punctuation at all");
});
