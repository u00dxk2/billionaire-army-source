import { test } from "node:test";
import assert from "node:assert/strict";
import {
  netWorthAge,
  netWorthAgeLabel,
  netWorthWithAge,
  currentGivingRatio,
  gradeUsesNetWorth,
  cardNetWorthDisplay,
  netWorthAgeNote,
  netWorthSummaryNote,
} from "./net-worth-age";

const NOW = new Date("2026-09-29T22:00:00Z");

// Bloomberg's live row on 2026-09-29: Wikidata's preferred value as of 2019-01-01, stamped
// retrievedAt 2026-09-27 by the weekly fetch. The retrieval date must never read as the as-of date.
const BLOOMBERG = {
  factValue: "~$55.5B",
  sourceType: "wikidata",
  retrievedAt: "2026-09-27T09:44:22.194Z",
};
const RTB_MARCH = { factValue: "~$1.7B", sourceType: "rtb", retrievedAt: "2026-03-09T12:00:00Z" };
const RTB_OLD = { factValue: "~$4.0B", sourceType: "rtb", retrievedAt: "2025-06-01T12:00:00Z" };

test("a Wikidata figure is UNDATED however fresh its retrievedAt", () => {
  assert.equal(netWorthAge(BLOOMBERG, NOW).kind, "undated");
});

test("an RTB figure retrieved six months ago is current and renders unchanged", () => {
  const age = netWorthAge(RTB_MARCH, NOW);
  assert.equal(age.kind, "current");
  assert.equal(netWorthAgeLabel(age), null);
  assert.equal(netWorthWithAge("~$1.7B", RTB_MARCH, NOW), "~$1.7B");
});

test("an RTB figure past the age line is stale and says its month", () => {
  const age = netWorthAge(RTB_OLD, NOW);
  assert.equal(age.kind, "stale");
  assert.equal(netWorthAgeLabel(age), "as of Jun 2025");
});

test("unknown source, missing fact, missing or junk retrievedAt all claim less", () => {
  assert.equal(netWorthAge({ sourceType: null, retrievedAt: "2026-09-01" }, NOW).kind, "undated");
  assert.equal(netWorthAge({ sourceType: "web_search", retrievedAt: "2026-09-01" }, NOW).kind, "undated");
  assert.equal(netWorthAge(null, NOW).kind, "undated");
  assert.equal(netWorthAge({ sourceType: "rtb", retrievedAt: null }, NOW).kind, "undated");
  assert.equal(netWorthAge({ sourceType: "rtb", retrievedAt: "not a date" }, NOW).kind, "undated");
});

test("the label for an undated figure", () => {
  assert.equal(netWorthWithAge("~$55.5B", BLOOMBERG, NOW), "~$55.5B (undated estimate)");
});

test("the ratio is absent when its denominator is not current, present when it is", () => {
  assert.equal(currentGivingRatio(BLOOMBERG, { annualGiving: 3.7e9 }, NOW), null);
  assert.equal(currentGivingRatio({ ...RTB_OLD }, { annualGiving: 1e8 }, NOW), null);
  const r = currentGivingRatio({ ...RTB_MARCH }, { annualGiving: 1e8 }, NOW);
  assert.ok(r, "a current denominator keeps its ratio");
  assert.equal(Number(r.percent.toFixed(1)), 5.9);
});

test("the grade uses net worth only through generosity", () => {
  assert.equal(gradeUsesNetWorth({ generosity: 0.61, philanthropy: 0.7 }), true);
  assert.equal(gradeUsesNetWorth({ generosity: 0, philanthropy: 0.15 }), false);
  assert.equal(gradeUsesNetWorth(null), false);
  assert.equal(gradeUsesNetWorth({}), false);
});

const U = "undated estimate";

test("card display: Bloomberg — live undated figure, grade flag on, no text figure", () => {
  assert.deepEqual(cardNetWorthDisplay("~$55.5B", BLOOMBERG, { generosity: 0.81 }, NOW), {
    netWorth: "~$55.5B",
    netWorthAsOf: U,
    gradeUsesStaleNetWorth: true,
    textFigure: null,
  });
});

test("card display: a current RTB figure is unchanged and says nothing", () => {
  const d = cardNetWorthDisplay("~$1.7B", RTB_MARCH, { generosity: 0.2 }, NOW);
  assert.deepEqual(d, { netWorth: "~$1.7B", netWorthAsOf: null, gradeUsesStaleNetWorth: false, textFigure: null });
  assert.equal(netWorthAgeNote(d.netWorthAsOf, d.gradeUsesStaleNetWorth, d.textFigure, d.netWorth), null);
});

test("card display: a live row with a NULL value counts as no live fact", () => {
  const d = cardNetWorthDisplay("~$9.9B", { ...RTB_MARCH, factValue: null }, { generosity: 0.5 }, NOW);
  assert.equal(d.netWorth, "~$9.9B");
  assert.equal(d.netWorthAsOf, U);
  assert.equal(d.gradeUsesStaleNetWorth, true);
  assert.equal(d.textFigure, null);
});

test("card display: a frozen chip with no live fact is undated (a lookup miss never reads as current)", () => {
  const d = cardNetWorthDisplay("~$9.9B", undefined, { generosity: 0.5 }, NOW);
  assert.equal(d.netWorthAsOf, U);
  assert.equal(d.gradeUsesStaleNetWorth, true);
});

test("card display: an undated figure with no giving carries no grade clause", () => {
  const d = cardNetWorthDisplay("~$55.5B", BLOOMBERG, { generosity: 0 }, NOW);
  assert.equal(netWorthAgeNote(d.netWorthAsOf, d.gradeUsesStaleNetWorth), "The net worth shown on this card is an undated estimate.");
});

test("card display: no figure at all renders nothing", () => {
  assert.equal(cardNetWorthDisplay(null, undefined, null, NOW).netWorth, null);
});

test("Bloomberg's card sentence: the age, then the grade clause", () => {
  const d = cardNetWorthDisplay("~$55.5B", BLOOMBERG, { generosity: 0.81 }, NOW);
  assert.equal(
    netWorthAgeNote(d.netWorthAsOf, d.gradeUsesStaleNetWorth, d.textFigure, d.netWorth),
    "The net worth shown on this card is an undated estimate. The giving grade is computed from our net-worth figure, so treat the grade as approximate.",
  );
});

test("a moved CURRENT chip: the earlier text figure is stated with no date, and the current one named (Codex r3-2 #1)", () => {
  const d = cardNetWorthDisplay("~$1.2B", RTB_MARCH, null, NOW);
  assert.equal(d.textFigure, "~$1.2B");
  assert.equal(
    netWorthAgeNote(d.netWorthAsOf, d.gradeUsesStaleNetWorth, d.textFigure, d.netWorth),
    "This card was written from an earlier net-worth figure, ~$1.2B, whose date we do not have; the current figure is ~$1.7B.",
  );
});

test("a moved OLD chip: the live date is never lent to the earlier text figure (Codex r3-3 #1)", () => {
  const d = cardNetWorthDisplay("~$3.1B", RTB_OLD, null, NOW);
  const note = netWorthAgeNote(d.netWorthAsOf, d.gradeUsesStaleNetWorth, d.textFigure, d.netWorth)!;
  assert.equal(
    note,
    "The net worth shown on this card is a figure as of Jun 2025. This card was written from an earlier net-worth figure, ~$3.1B, whose date we do not have.",
  );
  assert.ok(!/\$3\.1B[^.]*Jun 2025/.test(note), "the June date must not attach to ~$3.1B");
});

test("same figure on both sides → no text figure; no live fact → the chip IS the text figure", () => {
  assert.equal(cardNetWorthDisplay("~$1.7B", RTB_MARCH, null, NOW).textFigure, null);
  assert.equal(cardNetWorthDisplay("~$1.2B", undefined, null, NOW).textFigure, null);
});

const SUMMARY_NOTE = "A net worth stated in this summary may be out of date.";

test("summary note: fires on a not-current figure regardless of when the summary was written", () => {
  assert.equal(netWorthSummaryNote(BLOOMBERG, "2026-09-28T00:00:00Z", NOW), SUMMARY_NOTE);
  assert.equal(netWorthSummaryNote(RTB_OLD, "2026-09-28T00:00:00Z", NOW), SUMMARY_NOTE);
});

test("summary note: a CURRENT figure still fires when the summary PREDATES it (Codex r3-3 #2)", () => {
  assert.equal(netWorthSummaryNote(RTB_MARCH, "2026-02-01T00:00:00Z", NOW), SUMMARY_NOTE);
});

test("summary note: a current figure and a summary written after it → no note", () => {
  assert.equal(netWorthSummaryNote(RTB_MARCH, "2026-04-01T00:00:00Z", NOW), null);
});

test("summary note: an unknown write date claims less; no net-worth fact says nothing", () => {
  assert.equal(netWorthSummaryNote(RTB_MARCH, undefined, NOW), SUMMARY_NOTE);
  assert.equal(netWorthSummaryNote(RTB_MARCH, "garbage", NOW), SUMMARY_NOTE);
  assert.equal(netWorthSummaryNote(undefined, "2026-04-01T00:00:00Z", NOW), null);
});

test("the summary note dates NOTHING — it never names a month or a figure (Codex r3-3 #1)", () => {
  assert.ok(!/\d|as of|estimate/.test(SUMMARY_NOTE));
});

test("the grade clause never appears without an age — a current figure says nothing, even if a grade flag leaks through (M18)", () => {
  assert.equal(netWorthAgeNote(null, true), null);
  assert.equal(
    netWorthAgeNote(null, true, "~$1.2B", "~$1.7B"),
    "This card was written from an earlier net-worth figure, ~$1.2B, whose date we do not have; the current figure is ~$1.7B.",
  );
});
