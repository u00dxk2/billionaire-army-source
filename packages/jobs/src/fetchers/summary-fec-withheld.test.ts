import { test } from "node:test";
import assert from "node:assert/strict";
import { withholdImpossibleFecForPrompt } from "./summary-fact-collapse";
import { buildUserPrompt } from "./summary-prompt";

/**
 * B-037. COPIED FROM PROD, not invented — Adam Forste's `fec_contributions` fact on 2026-09-02.
 * His live profile rendered the withholding notice ("we can't prove they're this person's") AND,
 * in the Political Activity section below it, "Federal records show 48 contributions totaling
 * $128,108 from July 23, 1979, through September 4, 2025." He was born 1978; a 1979 contribution
 * would make him one year old. 12 of 12 withheld people carried their figures in stored prose.
 *
 * THE TESTS THAT MATTER HERE ARE THE WIRE-UP ONES. A test of `withholdImpossibleFecForPrompt`
 * alone stays green through the entire defect — the helper was never the broken part, the call
 * site was. That is this lane's 2026-08-26 lesson (`/today` shipped a raw float where a dollar
 * belonged: the cause was a FORK, not a wrong function, and the helper's own test passed).
 */
const FORSTE_FEC_FACT = {
  count: 48,
  dateRange: "1979-07-23 to 2025-09-04",
  totalAmount: 128108,
  partyBreakdown: { DEM: 64183, REP: 1000 },
  topRecipients: [{ name: "BIDEN VICTORY FUND", amount: 47000 }],
};

const personWith = (factValue: unknown, birthYear: number | null) => ({
  name: "Adam Forste",
  state: "Wyoming",
  industry: ["Real Estate"],
  birthYear,
  country: "United States",
  facts: [
    { factKey: "net_worth", factValue: "$1.2B", sourceType: "wikidata" },
    { factKey: "fec_contributions", factValue, sourceType: "fec" },
  ],
});

test("WIRE-UP: an impossible FEC record never reaches the model — no figures, no label", () => {
  const prompt = buildUserPrompt(personWith(FORSTE_FEC_FACT, 1978));
  assert.ok(!prompt.includes("FEC CONTRIBUTIONS"), "the fact block must be gone entirely");
  assert.ok(!prompt.includes("128108") && !prompt.includes("128,108"), "no total may survive");
  assert.ok(!prompt.includes("1979-07-23"), "no date range may survive");
  assert.ok(!prompt.includes("BIDEN VICTORY FUND"), "no recipient may survive");
  // The positive control: the REST of the prompt still builds. A guard that emptied the whole
  // prompt would pass every assertion above while destroying the summary.
  assert.ok(prompt.includes("Adam Forste"), "the person must survive");
  assert.ok(prompt.includes("NET WORTH"), "unrelated facts must survive");
});

test("WIRE-UP CONTROL: a plausible record still reaches the model in full", () => {
  const prompt = buildUserPrompt(personWith(FORSTE_FEC_FACT, 1955));
  assert.ok(prompt.includes("FEC CONTRIBUTIONS"), "the fact block must be present");
  assert.ok(prompt.includes("BIDEN VICTORY FUND"), "recipients must be present");
});

test("WIRE-UP: fails OPEN on a junk birth year, matching the guard's own direction", () => {
  // B-039 — `persons.birth_year` holds future years. The guard refuses to read one as an FEC
  // verdict, because a false positive here erases a real person's real record. 4 such rows exist.
  for (const junk of [2027, 2021, null]) {
    const prompt = buildUserPrompt(personWith(FORSTE_FEC_FACT, junk));
    assert.ok(
      prompt.includes("FEC CONTRIBUTIONS"),
      `birthYear ${junk} must NOT withhold — doubt means show, here`,
    );
  }
});

test("the helper drops ONLY the FEC fact, and only on the impossible case", () => {
  assert.equal(withholdImpossibleFecForPrompt("fec_contributions", FORSTE_FEC_FACT, 1978), null);
  assert.equal(
    withholdImpossibleFecForPrompt("fec_contributions", FORSTE_FEC_FACT, 1955),
    FORSTE_FEC_FACT,
  );
  // A different fact key with the same shape must pass through untouched — the guard adjudicates
  // FEC attribution, not "any object carrying a dateRange".
  assert.equal(
    withholdImpossibleFecForPrompt("sec_filings", FORSTE_FEC_FACT, 1978),
    FORSTE_FEC_FACT,
  );
  // Unparsable / absent range: nothing to falsify, so nothing is withheld. Compared by REFERENCE
  // — the helper must hand back the same object, not a copy.
  const noRange = { count: 3 };
  assert.equal(withholdImpossibleFecForPrompt("fec_contributions", noRange, 1978), noRange);
});

test("POSITIVE CONTROL — the wire-up assertion can actually fail", () => {
  // If the guard were removed from buildUserPrompt, this is the prompt that would be built. The
  // test above asserts its ABSENCE, so prove the string it looks for is one this input really
  // produces — otherwise that test would pass against any prompt, including an empty one.
  const unguarded = buildUserPrompt(personWith(FORSTE_FEC_FACT, 1955));
  assert.ok(unguarded.includes("FEC CONTRIBUTIONS"), "the sentinel must be producible");
  assert.ok(unguarded.includes("128,108") || unguarded.includes("128108"), "the figure must be producible");
});
