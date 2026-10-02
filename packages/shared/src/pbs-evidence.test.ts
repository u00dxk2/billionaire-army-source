import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasGivingEvidence,
  philanthropyIsUnevidenced,
  GIVING_EVIDENCE_FACT_KEYS,
  philanthropyZeroKind,
  unevidencedGradeCaveat,
} from "./pbs-evidence";

test("hasGivingEvidence accepts the curated direct-giving fact", () => {
  assert.equal(hasGivingEvidence(["net_worth", "total_giving"]), true);
});

test("hasGivingEvidence accepts the 990 fact", () => {
  assert.equal(hasGivingEvidence(["foundation_990s"]), true);
});

test("hasGivingEvidence is false when only non-giving facts are present", () => {
  assert.equal(hasGivingEvidence(["net_worth", "sec_filings", "news_headlines"]), false);
});

test("hasGivingEvidence is false on an empty fact set", () => {
  assert.equal(hasGivingEvidence([]), false);
});

// The importer writes factType `philanthropy` while the fact KEY is `total_giving`.
// Reading the type is the documented false-zero trap; pin that we key on the key.
test("the fact TYPE 'philanthropy' is not evidence — only the fact KEY is", () => {
  assert.equal(hasGivingEvidence(["philanthropy"]), false);
});

// Measured on prod 2026-08-22: philanthropy 0, transparency 0.875, zero giving facts.
// His profile published "Philanthropy — 0 %" beside "Evidenced charitable giving".
test("Steve Ballmer's live shape is unevidenced, not a measured zero", () => {
  assert.equal(philanthropyIsUnevidenced(0, ["net_worth", "sec_filings", "description"]), true);
});

// 27 of the 298 zero-philanthropy profiles DO carry a giving fact. A 990 that
// discloses no grants is a real reading of real evidence — blanking it would hide
// a finding rather than withhold a non-finding.
test("a 990 disclosing no grants keeps its measured 0", () => {
  assert.equal(philanthropyIsUnevidenced(0, ["foundation_990s"]), false);
});

test("a non-zero component is never relabelled, however small", () => {
  // Jensen Huang's live value, 2026-08-22.
  assert.equal(philanthropyIsUnevidenced(0.0014940445964583401, []), false);
});

test("a missing component counts as zero; evidence still decides", () => {
  assert.equal(philanthropyIsUnevidenced(undefined, []), true);
  assert.equal(philanthropyIsUnevidenced(null, ["total_giving"]), false);
});

test("the evidence set is exactly what computePbs can score from", () => {
  assert.deepEqual([...GIVING_EVIDENCE_FACT_KEYS], ["total_giving", "foundation_990s"]);
});

// --- philanthropyZeroKind: which of the three statements a 0% is making ------------------

test("a non-zero component has no zero-kind at all", () => {
  assert.equal(philanthropyZeroKind(0.33, ["total_giving"]), null);
});

test("Ballmer's shape reads unevidenced", () => {
  assert.equal(philanthropyZeroKind(0, ["net_worth", "sec_filings"]), "unevidenced");
});

// All 27 of these on prod 2026-08-22 were real filings reporting $0 grants — Ted Leonsis
// (totalAssets $20,201, grantsPaid $0, taxYear 2023) is the representative row.
test("a 990 on file reporting no grants reads evidenced-zero, not a gap", () => {
  assert.equal(philanthropyZeroKind(0, ["foundation_990s"]), "evidenced-zero");
  assert.equal(philanthropyZeroKind(0, ["total_giving"]), "evidenced-zero");
});

test("the kind and the boolean cannot disagree", () => {
  for (const keys of [[], ["net_worth"], ["total_giving"], ["foundation_990s"], ["foundation_990s", "net_worth"]]) {
    assert.equal(
      philanthropyZeroKind(0, keys) === "unevidenced",
      philanthropyIsUnevidenced(0, keys),
      `disagreement on ${JSON.stringify(keys)}`
    );
  }
});

// ── unevidencedGradeCaveat: the HEADLINE grade qualifier's wire-up ───────────────────
//
// These pin the NAME LOOKUPS, not the predicate — philanthropyZeroKind is already covered
// above. The defect they guard is KP-93's: rename `features.philanthropy` or `fact.factKey`
// and the caveat goes permanently false, restoring a headline "C 30.6 PBS" sitting over a
// breakdown that reads "No giving data on file". A silent false IS what that failure looks
// like, so the positive control comes first.

const NO_GIVING_FACTS = [{ factKey: "net_worth" }, { factKey: "sec_filings" }];

test("POSITIVE CONTROL: header caveat fires on a zero score with no giving fact", () => {
  // Steve Ballmer's shape on 2026-08-22: grade C, philanthropy 0, no giving fact at all.
  assert.equal(
    unevidencedGradeCaveat({ features: { philanthropy: 0, netWorth: 0.9 } }, NO_GIVING_FACTS),
    true
  );
});

test("header caveat stays silent when a 990 is on file — that zero is a finding, not a gap", () => {
  assert.equal(
    unevidencedGradeCaveat({ features: { philanthropy: 0 } }, [{ factKey: "foundation_990s" }]),
    false
  );
});

test("header caveat stays silent on curated direct giving", () => {
  assert.equal(
    unevidencedGradeCaveat({ features: { philanthropy: 0 } }, [{ factKey: "total_giving" }]),
    false
  );
});

test("header caveat stays silent on a non-zero component, however small", () => {
  assert.equal(unevidencedGradeCaveat({ features: { philanthropy: 0.004 } }, NO_GIVING_FACTS), false);
});

test("header caveat stays silent when there is no score at all", () => {
  assert.equal(unevidencedGradeCaveat(null, NO_GIVING_FACTS), false);
  assert.equal(unevidencedGradeCaveat(undefined, NO_GIVING_FACTS), false);
});

// The asymmetry that makes this line safe to render: an unreadable features blob cannot make
// it LIE, because the fact set is an independent second condition. A malformed blob can only
// fire the caveat for someone who genuinely carries no giving fact.
test("a malformed features blob cannot fire the header caveat over real giving evidence", () => {
  assert.equal(unevidencedGradeCaveat({}, [{ factKey: "total_giving" }]), false);
  assert.equal(unevidencedGradeCaveat({ features: null }, [{ factKey: "foundation_990s" }]), false);
});

test("header caveat tolerates a missing fact list without throwing", () => {
  assert.equal(unevidencedGradeCaveat({ features: { philanthropy: 0 } }, null), true);
});
