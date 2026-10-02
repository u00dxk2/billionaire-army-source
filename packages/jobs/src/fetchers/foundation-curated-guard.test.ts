import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CURATED_990_METHOD, curated990PersonIdsFrom, isCurated990Fact } from "./foundation-curated-guard";

test("B-068: a manual_curated foundation fact is curated; the fetcher's own rows are not", () => {
  assert.equal(CURATED_990_METHOD, "manual_curated");
  assert.equal(isCurated990Fact({ estimationMethod: "manual_curated" }), true);
  assert.equal(isCurated990Fact({ estimationMethod: "proPublica_990" }), false);
  assert.equal(isCurated990Fact({ estimationMethod: null }), false);
  assert.equal(isCurated990Fact(undefined), false);
});

test("B-068: the kept set holds exactly the persons with a curated row", () => {
  const ids = curated990PersonIdsFrom([
    { personId: "a", estimationMethod: "manual_curated" },
    { personId: "b", estimationMethod: "proPublica_990" },
    { personId: "c", estimationMethod: null },
  ]);
  assert.deepEqual([...ids], ["a"]);
});

// Wire-up. The pure check proves nothing if the loop stops consulting it: the fetcher then
// deletes a curated row on its next run. Comments are stripped so prose cannot satisfy this.
test("B-068: propublica-990.ts skips a curated person BEFORE either delete of foundation_990s", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "propublica-990.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.match(src, /const curated990PersonIds = curated990PersonIdsFrom\(/);

  const loop = src.indexOf("for (const person of allPersons) {");
  assert.ok(loop > 0, "person loop not found");
  const body = src.slice(loop);
  const guard = body.indexOf("if (curated990PersonIds.has(person.id)) {");
  const skip = guard >= 0 ? body.indexOf("continue;", guard) : -1;
  const search = body.indexOf("foundationSearchSurname(");
  const firstDelete = body.indexOf(".delete(personFacts)");
  assert.ok(firstDelete > 0 && search > 0, "loop landmarks not found");
  assert.ok(guard >= 0, "the person loop no longer consults curated990PersonIds");
  assert.ok(skip > guard && skip < search && skip < firstDelete, "the curated skip must `continue` before the search and before any delete");
});

// Codex review of 805d491: the skip above reads the curated set once, at run start, so it cannot
// see a row curated mid-run. The DELETE itself must refuse curated rows in its own WHERE.
test("B-068: every foundation_990s delete in propublica-990.ts excludes curated rows in its WHERE", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "propublica-990.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.match(
    src,
    /const notCurated990 = or\(isNull\(personFacts\.estimationMethod\), ne\(personFacts\.estimationMethod, CURATED_990_METHOD\)\);/,
  );
  const deletes = src.split(".delete(personFacts)").slice(1);
  assert.equal(deletes.length, 2, "expected exactly the two known delete sites");
  for (const after of deletes) {
    const whereClause = after.slice(0, after.indexOf(");") + 2);
    assert.match(whereClause, /eq\(personFacts\.factKey, "foundation_990s"\), notCurated990\)/);
  }
});
