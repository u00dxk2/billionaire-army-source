import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripPipelineCommentary } from "@ba/shared";
import { firstSentences } from "../first-sentences.js";

/**
 * /today's receipt bio must never open on our own plumbing.
 *
 * WHY THIS EXISTS. The profile fix (93e879f) stripped pipeline-referential prose from the
 * profile summary sections — and the sibling sweep required by the fix-then-grep rule found
 * the SAME prose reaching readers on a SECOND surface: `/api/persons/daily-ten` serves
 * `firstSentences(overview, 2)` as the daily-ten highlight, and /today renders it. Measured
 * live 2026-08-25, one hour after the profile fix shipped: Daniel Snyder's card read
 * "The data provided does not identify his operating…" — 1 of 10 cards on the demo surface
 * card #1 of /today is drawn from.
 *
 * A correction that reaches one copy is not a correction. This pins the second copy.
 *
 * Source-level, because the helper is already covered in @ba/shared and would stay green
 * through a revert of THIS call site — the same wire-up-vs-helper distinction that
 * `profile-commentary-wireup.test.ts` and `feed-source-name-wireup.test.ts` exist for.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "persons.ts");
const src = readFileSync(ROUTE, "utf8");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("daily-ten strips pipeline commentary BEFORE taking the first sentences", () => {
  const body = code(src);

  assert.ok(
    /import\s*\{[^}]*\bstripPipelineCommentary\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "persons.ts must import stripPipelineCommentary from @ba/shared",
  );

  assert.ok(
    /stripPipelineCommentary\(\s*overview\s*\)/.test(body),
    "the overview must be passed through stripPipelineCommentary — without this, /today's receipt bio can open on 'The data provided does not…'",
  );

  // Ordering is load-bearing: strip THEN take two sentences. Reversed, a dropped sentence
  // silently shortens the bio instead of being replaced by real content.
  const stripAt = body.indexOf("stripPipelineCommentary(overview)");
  const firstAt = body.indexOf("firstSentences(clean");
  assert.ok(stripAt > 0 && firstAt > stripAt, "strip must run BEFORE firstSentences()");

  assert.ok(
    /h\.summary\s*=\s*clean\s*\?\s*firstSentences\(clean,\s*2\)\s*:\s*null/.test(body),
    "an overview that is entirely plumbing must yield null, not a stub — absent, never empty",
  );
});

test("the live-measured Snyder shape is actually handled end to end", () => {
  // Verbatim shape from the daily-ten payload on 2026-08-25.
  const overview =
    "Daniel Snyder is an American businessman born in 1964 with an estimated net worth of ~$4.7B [Wikidata]. The data provided does not identify his operating company.";
  const clean = stripPipelineCommentary(overview);
  assert.ok(clean, "the real claim must survive");
  assert.ok(!clean!.includes("data provided"), "the plumbing sentence must be gone");
  assert.ok(clean!.includes("$4.7B"), "the sourced figure must remain");

  const bio = firstSentences(clean!, 2);
  assert.ok(!bio.includes("data provided"), "the rendered bio must not carry plumbing");
  assert.ok(bio.includes("born in 1964"), "the rendered bio keeps the real sentence");
});
