import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every prod-WRITING script in packages/jobs must sit behind `isMain(import.meta.url)`.
 *
 * WHY THIS EXISTS. CLAUDE.md states the invariant as settled — "Every script used to end in a bare
 * `main()`, so *importing* one RAN it… All are now behind `if (isMain(import.meta.url))`" — and on
 * 2026-08-19 that was false for SIX files. Four ended in a bare call (`seedBillionaires();`,
 * `importGivingPledge();`, `importBusinessProfiles();`, `importDirectGiving();`), `score-all.ts`
 * had no function at all and re-scored 1,092 people at module scope, and `worker.ts` started a
 * queue consumer and called `process.exit(1)` on any importer missing DATABASE_URL.
 *
 * The invariant was ASSERTED in a doc that every session loads, which is precisely why nobody
 * re-checked it. A documented invariant with no gate decays silently; this is the gate.
 *
 * WHAT COUNTS AS A WRITER: any `db.insert/update/delete` or `tx.insert/update/delete`. Read-only
 * probes and pure helpers are untouched, which is why this can be strict without being noisy.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const JOBS_SRC = join(REPO, "packages", "jobs", "src");

/** Matches a drizzle write, including the common `await db\n  .insert(` line break. */
const WRITE_CALL = /\b(db|tx)\s*\.?\s*[\r\n\s]*\.(insert|update|delete)\s*\(/;
const HAS_GUARD = /\bisMain\s*\(\s*import\.meta\.url\s*\)/;

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Files that write but are LIBRARIES — imported on purpose, never run as an entrypoint. */
const LIBRARY_WRITERS: string[] = [
  // (empty today; add with a stated reason, never to silence a real entrypoint)
];

test("every prod-writing job script is behind isMain(import.meta.url)", () => {
  const offenders: string[] = [];
  for (const file of walk(JOBS_SRC)) {
    const rel = relative(REPO, file).split(sep).join("/");
    if (LIBRARY_WRITERS.includes(rel)) continue;
    const src = readFileSync(file, "utf8");
    if (!WRITE_CALL.test(src)) continue;
    if (HAS_GUARD.test(src)) continue;
    offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "These write to prod but run on IMPORT — importing one executes it. Wrap the body in a " +
      "function and end the file with `if (isMain(import.meta.url)) await main();`:\n" +
      offenders.join("\n")
  );
});

test("the guard can actually fail — its patterns match where they legitimately live", () => {
  // Positive control: a broken walk or a typo'd pattern makes the test above pass by scanning
  // nothing, which is the exact comfortable-green shape that let six files drift in the first place.
  const files = walk(JOBS_SRC);
  assert.ok(files.length > 20, `walk must reach the job scripts (saw ${files.length})`);

  const writers = files.filter((f) => WRITE_CALL.test(readFileSync(f, "utf8")));
  assert.ok(writers.length > 5, `write-pattern must match real writers (saw ${writers.length})`);

  const guarded = files.filter((f) => HAS_GUARD.test(readFileSync(f, "utf8")));
  assert.ok(guarded.length > 5, `guard-pattern must match real guards (saw ${guarded.length})`);

  // And it must catch the exact shape that was live before this commit.
  assert.ok(WRITE_CALL.test("  await db\n    .insert(scoreSnapshots)"), "must catch the wrapped write");
  assert.ok(!HAS_GUARD.test("seedBillionaires();"), "a bare call must not read as guarded");
});
