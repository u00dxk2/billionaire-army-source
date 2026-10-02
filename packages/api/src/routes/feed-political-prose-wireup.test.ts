import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * B-037's PROSE leg is wired on BOTH served routes.
 *
 * The chip strip has been live since 2026-09-02 and never touched the sentence beside it, so card
 * `ac844ce9` served `contextData.political === null` AND "available records list $1.8 million in
 * political donations" in the same payload for 16 days. A helper test cannot catch that: the
 * function was never the problem, the missing CALL was.
 *
 * This is a wire-up test for the same reason `feed-political-chip-wireup.test.ts` is one — the
 * property lives at the call site. Sabotage that must turn it red: delete either
 * `withholdPoliticalProse` call, or move it INSIDE the repair chain so a later repair could
 * re-state the figure it just removed.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "feed.ts");
const src = readFileSync(ROUTE, "utf8");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("feed.ts imports the shared prose withhold rather than re-deriving it", () => {
  const body = code(src);
  assert.ok(
    /import\s*\{[^}]*\bwithholdPoliticalProse\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "feed.ts must import withholdPoliticalProse from @ba/shared",
  );
  // One rule, asked twice — never a second copy of the matching in this file.
  assert.ok(
    !/in\s+\(\?:federal\\s\+\)\?political/.test(body),
    "the clause matcher must not be re-implemented at the call site",
  );
});

test("BOTH served routes run the prose withhold, gated by the SAME withheld decision", () => {
  const body = code(src);

  const calls = [...body.matchAll(/withholdPoliticalProse/g)].filter((m) => {
    // Skip the import line itself.
    const line = body.slice(body.lastIndexOf("\n", m.index!) + 1, body.indexOf("\n", m.index!));
    return !line.includes("import");
  });
  assert.equal(calls.length, 2, "the list route and the detail route must each withhold prose");

  // Each call must be gated on the withhold decision, never on a locally re-derived predicate.
  assert.ok(
    /withheldPolitical\.has\(primaryId\)\s*\r?\n?\s*\?\s*withholdPoliticalProse/.test(body),
    "the list route must gate on withheldPolitical.has(primaryId)",
  );
  assert.ok(
    /politicalWithheld\s*\?\s*withholdPoliticalProse/.test(body),
    "the detail route must gate on politicalWithheld",
  );
});

test("the withhold wraps the repair chain — a repair can never restate what it removed", () => {
  const body = code(src);
  // In both routes the withhold must appear BEFORE repairScoreProse in source order, i.e. it is
  // the OUTER call, so it runs LAST on the string.
  for (const m of [...body.matchAll(/withholdPoliticalProse/g)].slice(1)) {
    const after = body.slice(m.index!, m.index! + 400);
    assert.ok(
      after.includes("repairScoreProse"),
      "withholdPoliticalProse must wrap repairScoreProse, not be wrapped by it",
    );
  }
});
