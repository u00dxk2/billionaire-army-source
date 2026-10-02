import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripPipelineCommentary } from "@ba/shared";

/**
 * The profile must never render our own plumbing to a reader.
 *
 * WHY A SOURCE-LEVEL TEST AND NOT ONLY A BEHAVIOURAL ONE. `stripPipelineCommentary()` is
 * covered in `@ba/shared` (`meta-commentary.test.ts`) and would stay green through a
 * revert of the CALL SITE — the exact failure this project keeps re-finding, and the same
 * reason `feed-source-name-wireup.test.ts` exists ("a falsifier must revert the WIRE-UP,
 * not just the helper"). The helper was never the hard part here either: the defect was
 * that 22 of 89 summarised profiles rendered "the provided data does not include a
 * specific company role" straight through, on real named people (Julia Koch, John Menard
 * Jr.), measured live 2026-08-25.
 *
 * So this asserts the call site, and asserts it in CODE rather than in a comment — the
 * `code()` strip below exists so the prose explaining the wire-up cannot satisfy the
 * assertion that the wire-up is present.
 */

const PAGE = join(dirname(fileURLToPath(import.meta.url)), "page.tsx");
const src = readFileSync(PAGE, "utf8");

/** Strip comments so surrounding prose can neither satisfy nor trip an assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the profile summary sections are passed through stripPipelineCommentary", () => {
  const body = code(src);

  assert.ok(
    /import\s*\{[^}]*\bstripPipelineCommentary\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "page.tsx must import stripPipelineCommentary from @ba/shared — a local copy would fork the vocabulary the purge script also reads",
  );

  assert.ok(
    /\.map\(\s*s\s*=>\s*\(\{\s*\.\.\.s,\s*content:\s*stripPipelineCommentary\(s\.content\)\s*\}\)\s*\)/.test(body),
    "the sections list must map content through stripPipelineCommentary() before the .filter(s => s.content) — without this, plumbing sentences render verbatim",
  );

  // Ordering is load-bearing: strip THEN filter, so a section left empty by the strip is
  // dropped by the existing filter rather than rendering as a bare heading.
  const mapAt = body.indexOf("stripPipelineCommentary(s.content)");
  const filterAt = body.indexOf(".filter(s => s.content)");
  assert.ok(mapAt > 0 && filterAt > mapAt, "strip must run BEFORE the empty-section filter");
});

test("the strip actually removes the sentences observed on the live profiles", () => {
  // Verbatim from billionaire.army on 2026-08-25 — if these ever render again, the
  // product is telling readers about its own inputs.
  assert.equal(
    stripPipelineCommentary("No validated news articles were available in the provided dataset."),
    undefined,
  );
  assert.equal(
    stripPipelineCommentary("The provided data identifies Menard's industry as retail."),
    undefined,
  );
  // ...while a real sourced claim on the same page survives untouched.
  const legit = "Foundation filings show $9,747,795 in total grants paid.";
  assert.equal(stripPipelineCommentary(legit), legit);
});
