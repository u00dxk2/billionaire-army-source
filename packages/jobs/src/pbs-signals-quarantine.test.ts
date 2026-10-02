/**
 * B-045 C2: a summary_quarantine row must not move the published score. sourceCount counts DISTINCT
 * fact types, so an unfiltered quarantine row (factType "quarantine") would add one source — raising
 * transparency for exactly the people whose summary the figure block caught wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUMMARY_QUARANTINE_FACT_KEY } from "@ba/shared";
import { extractPbsSignals } from "./pbs-signals";

const person = { badges: {}, images: [] };
const base = [
  { factType: "net_worth", factKey: "net_worth", factValue: { value: 5_000_000_000 } },
  { factType: "summary", factKey: "profile_summary", factValue: { overview: "x" } },
];

test("a quarantine row does not add a source, and the control shows a new type WOULD", () => {
  const quarantine = { factType: "quarantine", factKey: SUMMARY_QUARANTINE_FACT_KEY, factValue: { entries: [] } };
  const without = extractPbsSignals(person, base).sourceCount;
  assert.equal(extractPbsSignals(person, [...base, quarantine]).sourceCount, without);
  // Positive control: the same row under any other key IS counted, so the equality above is the filter.
  const control = { ...quarantine, factKey: "some_other_key" };
  assert.equal(extractPbsSignals(person, [...base, control]).sourceCount, without + 1);
});
