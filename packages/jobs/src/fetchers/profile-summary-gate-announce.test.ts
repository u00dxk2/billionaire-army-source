import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A RULING WITH NO MECHANISM IS INDISTINGUISHABLE FROM NO RULING AT THE MOMENT IT MATTERS.
 *
 * 2026-09-12 the owner ruled the faithfulness verifier MAY hold back a section stating a dollar figure
 * that disagrees with our stored records. 2026-09-13 an 855-profile regeneration published all 90
 * flagged sections, because that block is not built (B-045) and the gate runs log-only — and
 * nothing said so until the run was over and the corrections were being made by hand.
 *
 * The mechanism is the run stating its own gate: once BEFORE the first profile, and once at the end
 * with the count it let through. These assertions fail when that announcement is removed, which is
 * the failure a unit test of the verifier itself cannot see.
 */
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "profile-summary.ts"), "utf8");

describe("the run announces its faithfulness gate", () => {
  test("BEFORE the first profile, naming both states", () => {
    const banner = SRC.indexOf("=== Profile Summary Generator");
    const announce = SRC.indexOf("Faithfulness gate: LOG-ONLY");
    const loop = SRC.indexOf("Processing ${personList.length} persons");
    assert.ok(announce > banner, "the gate line must follow the generator banner");
    assert.ok(announce < loop, "the gate line must print BEFORE the person loop — after it is the failure this pins");
    assert.match(SRC, /Faithfulness gate: ENFORCING/, "the enforcing state must be sayable too");
    assert.match(
      SRC,
      /PUBLISHED ANYWAY \(set SUMMARY_FAITHFULNESS_ENFORCE=1/,
      "log-only must say what it costs and how to change it, not just its name",
    );
  });

  test("the closing summary states the gate and the count it let through", () => {
    const complete = SRC.indexOf("=== Summary Generation Complete ===");
    const closing = SRC.indexOf("flagged section(s) were PUBLISHED ANYWAY");
    assert.ok(complete > -1 && closing > complete, "the count must print inside the closing summary");
    assert.match(
      SRC,
      /Faithfulness gate ENFORCING . rejected sections were omitted\./,
      "stated even when enforcing — silence at zero reads the same as a verifier that never ran",
    );
  });

  test("the counter counts PUBLISHED rejections only — never the omitted ones", () => {
    assert.match(SRC, /let flaggedPublished = 0;/);
    // The increment sits on the else of the ENFORCE branch: when the gate omits a section it is not
    // published, so counting it there would report a defect the reader never saw.
    assert.match(
      SRC,
      /if \(FAITHFULNESS_ENFORCE\) delete \(summary as SummaryShape\)\[sec as keyof SummaryShape\];\s*\n\s*else flaggedPublished\+\+;/,
      "increment must be the else of the omit branch",
    );
  });
});
