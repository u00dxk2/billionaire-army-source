/**
 * B-045 C2 — the quarantine row holds text with a figure our own record contradicts. It must never
 * be served, fed to a prompt or counted. The 2026-09-18 read-path sweep found 20 person_facts reads
 * that were unfiltered or a `profile_summary` DENYLIST, four of them reaching public HTTP or an LLM
 * prompt. Those are fixed; this test fails the next one of the two shapes that caused them.
 *
 * CEILING, stated: it reads source. It catches (1) a profile_summary denylist anywhere in
 * packages/{api,jobs,shared}/src or scripts/, and (2) a Drizzle `.from(personFacts)` in an API route
 * whose WHERE names no fact key/type filter. It does NOT see raw-SQL reads in the API with no filter,
 * nor internal job reads (scoring is covered by extractPbsSignals' own filter and its test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIRS = ["packages/api/src", "packages/jobs/src", "packages/shared/src", "scripts"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mjs)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
const FILES = DIRS.flatMap((d) => walk(join(ROOT, d)));

/** A line that excludes profile_summary by denylist but not the quarantine key. */
function leakyDenylist(line: string): boolean {
  return /(!=|<>)\s*'profile_summary'/.test(line) || (/NOT IN\s*\([^)]*'profile_summary'/.test(line) && !/summary_quarantine|SUMMARY_QUARANTINE_FACT_KEY/.test(line));
}

/** An API `.from(personFacts)` whose WHERE, within the same statement, filters no key or type. */
function unfilteredApiReads(src: string): number {
  let n = 0;
  for (const m of src.matchAll(/\.from\(personFacts\)/g)) {
    const stmt = src.slice(m.index!, src.indexOf(";", m.index!));
    if (!/personFacts\.fact(Key|Type)|SUMMARY_QUARANTINE_FACT_KEY/.test(stmt)) n++;
  }
  return n;
}

test("the sweep reads a real population", () => {
  assert.ok(FILES.length > 100, `expected the repo's source files, read ${FILES.length}`);
});

test("no profile_summary DENYLIST lets the quarantine key through", () => {
  const hits = FILES.flatMap((f) =>
    readFileSync(f, "utf8").split("\n").map((l, i) => [l, i] as const).filter(([l]) => leakyDenylist(l))
      .map(([, i]) => `${relative(ROOT, f)}:${i + 1}`),
  );
  assert.deepEqual(hits, [], "add summary_quarantine to the exclusion, or use an allowlist");
});

test("no API route reads person_facts without a key or type filter", () => {
  const routes = FILES.filter((f) => f.includes(join("packages", "api", "src")));
  const hits = routes.filter((f) => unfilteredApiReads(readFileSync(f, "utf8")) > 0).map((f) => relative(ROOT, f));
  assert.deepEqual(hits, [], "a route serving every fact would serve the quarantine row");
});

test("POSITIVE CONTROLS: both predicates fire on the shapes that leaked", () => {
  assert.equal(leakyDenylist("WHERE pf.fact_key != 'profile_summary'"), true);
  assert.equal(leakyDenylist("AND pf.fact_key <> 'profile_summary'"), true);
  assert.equal(leakyDenylist("WHERE pf.fact_key NOT IN ('profile_summary', 'summary_quarantine')"), false);
  assert.equal(unfilteredApiReads("db.select().from(personFacts).where(eq(personFacts.personId, id));"), 1);
  assert.equal(unfilteredApiReads("db.select().from(personFacts).where(and(eq(personFacts.personId, id), ne(personFacts.factKey, SUMMARY_QUARANTINE_FACT_KEY)));"), 0);
});
