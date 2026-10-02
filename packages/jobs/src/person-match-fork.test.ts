import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * B-033 fork guard — nobody may re-implement candidate pairing outside `person-match.ts`.
 *
 * THE DEFECT THIS EXISTS FOR. `person-match.ts` is documented (B-009) as the ONE source of truth
 * for "are these two rows the same person", shared by the de-dup tool and both seeder guards so
 * they can never drift. `dedupe-persons.ts` nevertheless carried its own inline copy of the
 * pairing test:
 *
 *     if (A.core[0] === B.core[0] && A.core[at(-1)] === B.core[at(-1)])
 *
 * It imported `coreTokens` for the tokenising and then rolled its own comparison. That copy was
 * a snapshot of an older rule, so the analyzer had silently opted itself OUT of every subsequent
 * improvement to the shared matcher — and on 2026-08-19 it reported a clean index while ELEVEN
 * duplicate people sat in it. Nothing was wrong with the shared rule. The consumer had forked it.
 *
 * WHY A STATIC GUARD AND NOT A UNIT TEST. This failure is invisible from either file alone: the
 * matcher's tests pass, the analyzer's output looks plausible, and only the RELATIONSHIP between
 * them is broken. Unit tests cannot see a relationship; a repo-wide read can.
 *
 * THE SAME RISK APPLIES TO EVERY SHARED CALIBRATION. CLAUDE.md names four more primitives that
 * must never be forked — `accountabilityScore`, `credibilityTier`, `eventSignature`, and
 * `foundationTotals` (that last one already has its own guard, foundation-endowment-fork.test.ts,
 * and this file is deliberately built to the same shape). If you add a consumer of any of them,
 * import the function; do not copy the comparison.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const MATCHER = join("packages", "jobs", "src", "person-match.ts");

/**
 * The tell. `coreTokens` is the tokeniser; `isCandidatePair` is the decision. A file that reaches
 * for the tokeniser and NOT the decision is doing its own pairing — which is exactly, and only,
 * what dedupe-persons.ts was doing.
 */
const IMPORTS_TOKENISER = /\bcoreTokens\b/;
const IMPORTS_DECISION = /\b(isCandidatePair|findMergeDuplicate)\b/;

/** A hand-rolled comparison of first/last core tokens, in any of the shapes it plausibly takes. */
const INLINE_PAIRING = /\bcore\s*\[\s*0\s*\]\s*===|\.core\[[^\]]*length\s*-\s*1\]\s*===/;

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "tmp"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = () =>
  walk(join(REPO, "packages")).filter((f) => {
    const rel = relative(REPO, f).split(sep).join(sep);
    return rel !== MATCHER && !rel.endsWith(".test.ts");
  });

test("no file re-implements candidate pairing inline (B-033 fork guard)", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const rel = relative(REPO, file);
    const src = readFileSync(file, "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      if (isComment(line)) continue;
      if (INLINE_PAIRING.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "These compare core tokens by hand instead of calling isCandidatePair() from person-match.ts. " +
      "That is the fork that hid 11 duplicate people from dedupe:persons (B-033):\n" +
      offenders.join("\n")
  );
});

test("no file uses coreTokens() without the pairing decision that goes with it", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    const code = src
      .split("\n")
      .filter((l) => !isComment(l))
      .join("\n");
    if (!IMPORTS_TOKENISER.test(code)) continue;
    if (IMPORTS_DECISION.test(code)) continue;
    offenders.push(relative(REPO, file));
  }
  assert.deepEqual(
    offenders,
    [],
    "These import the tokeniser but never the decision, which means they decide identity " +
      "themselves. Use isCandidatePair() / findMergeDuplicate():\n" + offenders.join("\n")
  );
});

test("the guard can actually fail — patterns match where they legitimately live", () => {
  // Positive control. Without it, a broken walk or a pattern typo makes both tests above pass by
  // scanning nothing — the comfortable-green shape that produced the very defect this guards.
  assert.ok(sourceFiles().length > 50, "walk must actually reach the source tree");

  const matcher = readFileSync(join(REPO, MATCHER), "utf8");
  assert.ok(IMPORTS_TOKENISER.test(matcher), "tokeniser pattern must match where it is defined");
  assert.ok(IMPORTS_DECISION.test(matcher), "decision pattern must match where it is defined");

  // And the inline-pairing pattern must match the exact line that was live in dedupe-persons.ts
  // before 7b285f0 — the guard is calibrated against the real defect, not an imagined one.
  const theOriginalFork = "        A.core[0] === B.core[0] &&";
  assert.ok(
    INLINE_PAIRING.test(theOriginalFork),
    "pattern must catch the actual forked line this guard was built for"
  );
});
