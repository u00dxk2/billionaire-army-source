/**
 * B-045's block is WIRED, wired to the C2 CONSEQUENCE, and wired the way the owner's ruling requires.
 *
 * FLIPPED AGAIN 2026-09-18 for C2 (orchestrator ruling 2026-09-17, bus ac23cd8e): the block no longer
 * DELETES a section. A blocked candidate is quarantined; the already-published section is kept, or on
 * a first generation that one section is withheld. The consequence is pure and pinned against both
 * positive controls in `packages/shared/src/figure-quarantine.test.ts`; this file pins that the
 * generator applies it AT THE WRITE, inside the transaction, against a locked read.
 *
 * WHY AT THE WRITE, not before the verifier (adversarial review round 2): the preservation decision
 * needs the row as it is when the write happens. Applied before `verifyFaithfulness` — an unbounded
 * external call — a correction committed during it would be silently restored by a decision taken
 * against the older text.
 *
 * WHY A SOURCE-READING TEST. A pure function nothing calls passes every gate this repo owns. These
 * assertions fail when the CALL disappears. CEILING, stated: they read source order, not a run; the
 * runtime proof is a PROFILE_DRY_RUN over a planted case, which the regeneration lock forbids today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyFigureBlock } from "@ba/shared";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "profile-summary.ts"), "utf8");
/** The helper that owns the consequence: read → applyFigureBlock → log → provenance → escalate. */
const HELPER = SRC.slice(SRC.indexOf("async function applyBlockAtWrite("), SRC.indexOf("async function main()"));

test("the generator IMPORTS the shared consequence rather than re-deriving it", () => {
  assert.match(
    SRC,
    /import\s*\{[\s\S]*?applyFigureBlock[\s\S]*?\}\s*from\s*"@ba\/shared"/,
    "a checker that re-implements the predicate is a FORK of it (fd83f65, 2026-08-25)",
  );
  assert.match(SRC, /storedFiguresForSummary/, "the comparison set must come from the shared helper");
  assert.match(SRC, /preservedSectionDates/, "the kept-section date rule is shared and unit-tested, not re-derived here");
  assert.ok(HELPER.length > 0, "the helper region must exist, or every assertion below guards an empty string");
  assert.doesNotMatch(HELPER, /delete \(summary as SummaryShape\)/, "the option-A delete arm must be gone — C2 never deletes a published section");
});

test("the block is applied INSIDE the write transaction, on a LOCKED read of what is published", () => {
  const tx = SRC.indexOf("await db.transaction(async (tx) => {");
  const call = SRC.indexOf("await applyBlockAtWrite(tx, personData, summary, storedFigures, true)");
  const quarantine = SRC.indexOf("factKey: SUMMARY_QUARANTINE_FACT_KEY");
  const del = SRC.indexOf("await tx.delete(personFacts)");
  const ins = SRC.indexOf("await tx.insert(personFacts)", del);
  assert.ok(tx > 0 && tx < call && call < quarantine && quarantine < del && del < ins, "read, quarantine, delete and insert must commit together");
  assert.match(HELPER, /lock \? sql`FOR UPDATE` : sql``/, "the transaction's read must lock the row it preserves from");
  assert.match(HELPER, /fact_key = 'profile_summary'/, "…and it must read the published summary");
  assert.doesNotMatch(SRC, /await db\.delete\(personFacts\)/, "no delete outside the transaction");
  assert.doesNotMatch(SRC, /publishedSummaries/, "no run-start snapshot: it goes stale over a multi-hour run");
});

test("the verifier runs BEFORE the write, so the block's read cannot precede an unbounded call", () => {
  const verifier = SRC.indexOf("const faith = await verifyFaithfulness(");
  const call = SRC.indexOf("await applyBlockAtWrite(tx, personData, summary, storedFigures, true)");
  assert.ok(verifier > 0 && verifier < call, "round 2's lost-update: the preservation read must come after the LLM calls");
});

test("what is written is the block's outcome, with the KEPT sections' own dates", () => {
  assert.match(SRC, /\.\.\.finalSummary,/, "the row carries the block's summary, never the raw candidate");
  assert.match(SRC, /sectionGeneratedAt: block\.preservedAt/, "a kept paragraph stamped today would silence its own staleness caveat");
  const region = SRC.slice(SRC.indexOf("factKey: SUMMARY_QUARANTINE_FACT_KEY") - 400, SRC.indexOf("factKey: SUMMARY_QUARANTINE_FACT_KEY") + 400);
  assert.match(region, /entries: block\.quarantined/, "the complete candidate + figure pairs go into the record");
  assert.match(region, /storedFigures/, "the stored-record snapshot goes into the record");
});

test("the quarantine key never feeds the summary prompt", () => {
  assert.match(
    SRC,
    /pf\.fact_key NOT IN \('profile_summary', \$\{SUMMARY_QUARANTINE_FACT_KEY\}\)/,
    "a quarantined candidate read back as a fact would put the wrong figure straight into the next prompt",
  );
});

test("a REFUSAL is handled separately from a clean section and is never silent", () => {
  assert.match(HELPER, /block\.notJudged/, "the caller must read the refusals");
  assert.match(HELPER, /figureRefused\+\+/, "refusals need their own counter");
  assert.match(HELPER, /NOT JUDGED/, "a record that could not be enumerated must say so");
  assert.match(HELPER, /figureKept\+\+/);
  assert.match(HELPER, /figureWithheld\+\+/);
});

test("the no-section escalation asks what a READER would see, by the profile's own rules", () => {
  assert.match(HELPER, /stripPipelineCommentary/, "a section that is only pipeline commentary renders as nothing");
  assert.match(HELPER, /section === "political" && withholdPolitical/, "a withheld political section never reaches the page");
  assert.match(HELPER, /isFecRecordImpossible/, "the withhold decision is the shared guard, not a second copy");
  assert.match(HELPER, /ESCALATE/, "a generation left with nothing visible is escalated, per B-045's closeWhen");
});

test("POSITIVE CONTROL, end to end: Jordan's REAL $689,538 never publishes through the called function", () => {
  const JORDAN = [
    1, 18, 90, 100, 109, 250, 475, 900, 931, 1145, 1162, 2023, 3794, 10038, 142680, 304670, 311194,
    364868, 383916, 385323, 476916, 846750, 878622, 1181810, 1516288, 2335280, 13078216, 15798819,
    586039423, 752486085, 882989784,
  ];
  const wrong = "His foundation reported $689,538 in grants paid across the 2024 filing year [IRS].";
  const out = applyFigureBlock({ philanthropy: wrong }, { philanthropy: "Published text." }, ["philanthropy"], JORDAN);
  assert.equal(out.summary.philanthropy, "Published text.");
  assert.equal(out.quarantined[0].disagreements[0].stored, 669538);
});

test("the run ANNOUNCES the block as ENFORCING, at start and at the end, and states it AT ZERO", () => {
  assert.match(SRC, /Figure block \(B-045\): ENFORCING/);
  assert.match(SRC, /Figure block \(B-045, ENFORCING\): \$\{figureKept \+ figureWithheld\}/);
  assert.match(SRC, /\$\{figureRefused\}/, "the closing summary states refusals too, or they vanish");
  assert.match(SRC, /\$\{figureEmptied\}/, "…and the escalations");
});

test("THE RULING: the deterministic block is NOT inside the LLM verifier's enforce branch", () => {
  /* The owner ruled the faithfulness verdict stays log-only and authorised only this deterministic block.
     The two are indistinguishable from outside the process, so the separation is pinned structurally:
     the whole consequence lives in a helper that never reads the enforce flag. */
  const region = HELPER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(region, /FAITHFULNESS_ENFORCE/, "the deterministic block must never be gated on the LLM verifier's enforce flag");
  assert.ok(region.includes("applyFigureBlock("), "…and the call must still be IN this region, or the test guards an empty string");
  assert.match(SRC, /if \(FAITHFULNESS_ENFORCE\) delete \(summary as SummaryShape\)/, "the verifier's own log-only branch is a DIFFERENT mechanism and still exists");
});
