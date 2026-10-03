/**
 * B-037 (the owner, card d143c535): an FEC record matched by name alone must not count toward the
 * giving score, and must count again once a record matches the person's own company.
 * sourceCount counts DISTINCT fact types, so the name-only fact has to be skipped before the count.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePbs, FEC_CONTRIBUTIONS_FACT_KEY } from "@ba/shared";
import { extractPbsSignals } from "./pbs-signals";

const person = { badges: {}, images: [] };
const base = [
  { factType: "net_worth", factKey: "net_worth", factValue: { value: 5_000_000_000 } },
  { factType: "summary", factKey: "profile_summary", factValue: { overview: "x" } },
];
// The shape fec.ts stores today: aggregates only, no employer verdict.
const nameOnly = {
  factType: "political",
  factKey: FEC_CONTRIBUTIONS_FACT_KEY,
  factValue: { totalAmount: 128108, count: 48, dateRange: "1979-07-23 to 2025-09-04" },
};

test("a name-only FEC fact adds no source and moves no score", () => {
  const without = extractPbsSignals(person, base);
  const withFec = extractPbsSignals(person, [...base, nameOnly]);
  assert.equal(withFec.sourceCount, without.sourceCount);
  assert.equal(computePbs(withFec).pbs, computePbs(without).pbs);
});

test("the same fact counts again once a record matches the person's own company", () => {
  const without = extractPbsSignals(person, base).sourceCount;
  const verified = { ...nameOnly, factValue: { ...nameOnly.factValue, employerVerifiedCount: 3 } };
  assert.equal(extractPbsSignals(person, [...base, verified]).sourceCount, without + 1);
});

test("a political fact that is not an FEC name match still counts", () => {
  const without = extractPbsSignals(person, base).sourceCount;
  const other = { factType: "political", factKey: "some_other_political_key", factValue: {} };
  assert.equal(extractPbsSignals(person, [...base, other]).sourceCount, without + 1);
});

test("a profile image does not let a name-only FEC fact back in", () => {
  // Codex r2 mutant: an `images.length > 0 ||` guard on the filter left every other test green.
  const pictured = { badges: {}, images: ["https://example.org/a.jpg"] };
  const without = extractPbsSignals(pictured, base).sourceCount;
  assert.equal(without, extractPbsSignals(person, base).sourceCount + 1);
  assert.equal(extractPbsSignals(pictured, [...base, nameOnly]).sourceCount, without);
});

test("the FEC key decides, whatever factType the row carries", () => {
  // Codex r1 mutant: a `factType !== "political" ||` guard left every other test here green.
  const without = extractPbsSignals(person, base).sourceCount;
  const odd = { ...nameOnly, factType: "some_new_type" };
  assert.equal(extractPbsSignals(person, [...base, odd]).sourceCount, without);
});

test("skipping the FEC fact does not hide the other signals read from the same fact list", () => {
  const pledge = { factType: "giving_pledge", factKey: "giving_pledge", factValue: {} };
  const direct = { factType: "philanthropy", factKey: "total_giving", factValue: { annualGiving: 1_000_000_000 } };
  const withFec = extractPbsSignals(person, [...base, nameOnly, pledge, direct]);
  const withoutFec = extractPbsSignals(person, [...base, pledge, direct]);
  assert.equal(withFec.givingPledge, true);
  assert.equal(withFec.netWorth, 5_000_000_000);
  assert.deepEqual(withFec, withoutFec);
});

test("a pledge row stored under the FEC key still reads as a pledge (only the count skips it)", () => {
  const odd = { factType: "giving_pledge", factKey: FEC_CONTRIBUTIONS_FACT_KEY, factValue: {} };
  assert.equal(extractPbsSignals(person, [...base, odd]).givingPledge, true);
});
