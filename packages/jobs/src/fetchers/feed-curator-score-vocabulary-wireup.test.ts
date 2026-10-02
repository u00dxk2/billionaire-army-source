import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { namesInternalScore, readerFacingScorePhrase } from "@ba/shared";
import { GENERATOR_SYSTEM_PROMPT, GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING } from "./feed-generator-prompt";

/**
 * R-081, the WRITE half. The curator used to be handed `PBS Score: 91.6/100` and told to weave in
 * the "PBS score", and it did exactly that: five of the served 40 on 2026-09-03 named the platform's
 * own score in reader-facing prose beside a badge reading GIVING A (92).
 *
 * FIXED AT THE INPUT, for the reason Cycle 11's political-units fix and B-030's
 * `collapseFoundationTotalsForPrompt` are: Pass C audits the rewrite against this same context
 * blob, so a label copied out of it is "supported by the provided context" by construction. A gate
 * cannot adjudicate its own blind spot.
 *
 * ONE STRING, TWO READERS is the property that has to hold and it exists only at the call sites:
 * the generator's candidate block and `contextReceiptsFor` (which builds Pass C's receipts AND the
 * drop log) must be built by the same function. If they drift, the faithfulness judge audits a
 * figure the generator was never shown and rejects a grounded card as invented.
 */

// Both builders moved to the side-effect-free feed-receipt-lines.ts (B-063) so they can be tested
// by their emitted text; this file pins the score phrase where they now live.
const CURATOR = join(dirname(fileURLToPath(import.meta.url)), "feed-curator.ts");
const RECEIPTS = join(dirname(fileURLToPath(import.meta.url)), "feed-receipt-lines.ts");
const src = readFileSync(CURATOR, "utf8");
const receiptsSrc = readFileSync(RECEIPTS, "utf8");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the curator imports the shared vocabulary rather than restating it", () => {
  assert.ok(
    /import\s*\{[^}]*\breaderFacingScorePhrase\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(code(receiptsSrc)),
    "feed-receipt-lines.ts must import readerFacingScorePhrase from @ba/shared",
  );
});

test("BOTH the generator prompt and Pass C's receipts are built from that one function", () => {
  const body = code(receiptsSrc);
  const calls = [...body.matchAll(/readerFacingScorePhrase\s*\(/g)];
  assert.equal(
    calls.length,
    2,
    "the candidate block handed to the generator and contextReceiptsFor (Pass C + the drop log) " +
      "must each build the score line from the shared phrase — one string, two readers",
  );
});

test("the raw score is never interpolated into a prompt again", () => {
  const body = code(src) + code(receiptsSrc);
  assert.ok(
    !/\$\{c\.context\.pbs\}/.test(body),
    "no prompt line may interpolate the raw stored score — it carries a second rounding and no " +
      "reader-facing label, which is exactly what the model echoed onto five live cards",
  );
});

test("the system prompt forbids the acronym in reader-facing text", () => {
  // The rule is COPY, so it is pinned as copy: a future prompt edit that drops it should go red
  // rather than silently reopening the defect on the next curator run. The prompt moved to the
  // side-effect-free feed-generator-prompt.ts (R-048 round 2), so this reads the EMITTED text of
  // BOTH the live prompt and the dry-run baseline.
  for (const [name, prompt] of [["live", GENERATOR_SYSTEM_PROMPT], ["baseline", GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING]] as const) {
    assert.ok(
      /NEVER write "PBS" or "Public Benefit Score" in a headline or summary/.test(prompt),
      `the generator (${name}) must be told not to name the internal score on the card`,
    );
    assert.ok(
      !/weaves in the contextual data provided \([^)]*PBS score/.test(prompt),
      `the instruction that ASKED for a PBS score must be gone (${name}), not merely contradicted below it`,
    );
  }
});

test("the phrase the curator now hands the model would not trip the served-feed gate", () => {
  // Otherwise the write-path fix ships cards the gate reds on, the day it lands.
  const phrase = readerFacingScorePhrase("91.6");
  assert.ok(phrase, "a usable stored score must produce a phrase");
  assert.equal(namesInternalScore(`Scott has a ${phrase}.`), false);
});
