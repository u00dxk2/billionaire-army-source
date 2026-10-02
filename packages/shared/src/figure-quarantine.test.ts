/**
 * B-045 C2 — the two positive controls the closeWhen names, pinned against the CONSEQUENCE:
 *   (a) a TRUE bound the predicate cannot enumerate is QUARANTINED and the old text STAYS LIVE;
 *   (b) Michael Jordan's real $689,538 against his real record NEVER PUBLISHES.
 * Plus the negative control that keeps (a)/(b) honest: a TRUE figure publishes the fresh candidate.
 * Jordan's figures are the real prod set from figure-block.test.ts (dumped 2026-09-15).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFigureBlock, preservedSectionDates, SUMMARY_QUARANTINE_FACT_KEY } from "./figure-quarantine";
import { MAX_FIGURES_FOR_DERIVATION } from "./figure-block";

const SECTIONS = ["overview", "business", "philanthropy", "political", "newsDigest"] as const;

const JORDAN = [
  1, 18, 90, 100, 109, 250, 475, 900, 931, 1145, 1162, 2023, 3794, 10038, 142680, 304670, 311194,
  364868, 383916, 385323, 476916, 846750, 878622, 1181810, 1516288, 2335280, 13078216, 15798819,
  586039423, 752486085, 882989784,
];

const OLD_PHIL = "His two foundations reported grants in the 2024 filing year [IRS].";

test("(a) a TRUE bound is QUARANTINED and the published text STAYS LIVE", () => {
  const candidate = { overview: "Fresh overview.", philanthropy: "He gave more than $123,450 to schools." };
  const out = applyFigureBlock(candidate, { overview: "Old overview.", philanthropy: OLD_PHIL }, SECTIONS, [123459]);
  assert.equal(out.summary.philanthropy, OLD_PHIL, "the already-published section must be kept");
  assert.equal(out.summary.overview, "Fresh overview.", "a section the block did not fire on is the fresh candidate");
  assert.equal(out.quarantined.length, 1);
  const [q] = out.quarantined;
  assert.equal(q.section, "philanthropy");
  assert.equal(q.kept, "previous");
  assert.equal(q.candidate, candidate.philanthropy, "the COMPLETE candidate is recorded");
  assert.deepEqual(q.disagreements.map((d) => [d.stated, d.stored]), [[123450, 123459]], "the figure pair is recorded");
});

test("(a) on a FIRST generation the same bound withholds that one section, and is quarantined", () => {
  const out = applyFigureBlock(
    { overview: "Fresh overview.", philanthropy: "He gave more than $123,450 to schools." },
    null,
    SECTIONS,
    [123459],
  );
  assert.equal("philanthropy" in out.summary, false, "nothing was published, so nothing is kept");
  assert.equal(out.summary.overview, "Fresh overview.");
  assert.equal(out.quarantined[0].kept, "withheld");
});

test("(b) Jordan's real $689,538 NEVER publishes — neither over a published section nor on a first generation", () => {
  const wrong = "His foundations reported a combined $689,538 in grants paid across the 2024 filing year [IRS].";
  const kept = applyFigureBlock({ philanthropy: wrong }, { philanthropy: OLD_PHIL }, SECTIONS, JORDAN);
  assert.equal(kept.summary.philanthropy, OLD_PHIL);
  const first = applyFigureBlock({ philanthropy: wrong }, undefined, SECTIONS, JORDAN);
  assert.equal("philanthropy" in first.summary, false);
  for (const out of [kept, first]) {
    assert.notEqual(out.summary.philanthropy, wrong);
    assert.deepEqual(out.quarantined[0].disagreements.map((d) => [d.stated, d.stored, d.via]), [[689538, 669538, "derived"]]);
  }
});

test("NEGATIVE CONTROL: Jordan's TRUE $669,538 publishes the fresh candidate and quarantines nothing", () => {
  const right = "His foundations reported a combined $669,538 in grants paid across the 2024 filing year [IRS].";
  const out = applyFigureBlock({ philanthropy: right }, { philanthropy: OLD_PHIL }, SECTIONS, JORDAN);
  assert.equal(out.summary.philanthropy, right, "a clean regeneration must replace the old text, or C2 freezes every profile");
  assert.equal(out.quarantined.length, 0);
});

test("a blank published section is NOT kept — it is a withhold, not an empty paragraph", () => {
  const out = applyFigureBlock({ philanthropy: "More than $123,450." }, { philanthropy: "  " }, SECTIONS, [123459]);
  assert.equal("philanthropy" in out.summary, false);
  assert.equal(out.quarantined[0].kept, "withheld");
});

test("a record over the derivation cap is NOT JUDGED: published unchecked, and named", () => {
  const huge = Array.from({ length: MAX_FIGURES_FOR_DERIVATION + 1 }, (_, i) => 100003 + i * 7919);
  const out = applyFigureBlock({ philanthropy: "More than $123,450." }, { philanthropy: OLD_PHIL }, SECTIONS, huge);
  assert.equal(out.summary.philanthropy, "More than $123,450.");
  assert.deepEqual(out.notJudged, ["philanthropy"]);
  assert.equal(out.quarantined.length, 0);
});

test("a KEPT section carries the date it was WRITTEN, not the date it was kept", () => {
  const published = { philanthropy: OLD_PHIL, generatedAt: "2026-08-01T00:00:00.000Z" };
  const out = applyFigureBlock({ philanthropy: "More than $123,450." }, published, SECTIONS, [123459]);
  assert.deepEqual(preservedSectionDates(published, out.quarantined), { philanthropy: "2026-08-01T00:00:00.000Z" });
  // Kept a SECOND time: the original date survives, or old prose would drift toward looking fresh
  // one regeneration at a time — and the profile reads this date for its staleness caveat (R-077).
  const twice = { ...published, generatedAt: "2026-09-18T00:00:00.000Z", sectionGeneratedAt: { philanthropy: "2026-08-01T00:00:00.000Z" } };
  assert.deepEqual(preservedSectionDates(twice, out.quarantined), { philanthropy: "2026-08-01T00:00:00.000Z" });
  // A WITHHELD section has no published paragraph, so it contributes no date.
  const first = applyFigureBlock({ philanthropy: "More than $123,450." }, null, SECTIONS, [123459]);
  assert.deepEqual(preservedSectionDates(null, first.quarantined), {});
});

test("the candidate object is not mutated, and the quarantine key is the one read paths exclude", () => {
  const candidate = { philanthropy: "More than $123,450." };
  applyFigureBlock(candidate, null, SECTIONS, [123459]);
  assert.equal(candidate.philanthropy, "More than $123,450.");
  assert.equal(SUMMARY_QUARANTINE_FACT_KEY, "summary_quarantine");
});
