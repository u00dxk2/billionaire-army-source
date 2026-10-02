import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { servedScore } from "./grade-status.js";

/**
 * NOT GRADED at the serving boundary (2026-10-02). `servedScore` is the decision; the wire-up
 * tests below pin that every route that READS a stored score passes it through that decision,
 * because a route nobody remembered is exactly how a letter survives on one surface.
 */

test("a not-graded person is served no score, whatever is stored", () => {
  const s = servedScore("p1", "13.40", new Set(["someone-else"]));
  assert.equal(s.value, null);
  assert.equal(s.gradeStatus, "not_graded");
});

test("a graded person is served the stored score unchanged", () => {
  const stored = { pbs: "61.20", features: { philanthropy: 0.9 } };
  const s = servedScore("p1", stored, new Set(["p1"]));
  assert.equal(s.value, stored);
  assert.equal(s.gradeStatus, "graded");
});

test("a graded person with no stored score yet serves null but stays graded", () => {
  const s = servedScore("p1", undefined, new Set(["p1"]));
  assert.equal(s.value, null);
  assert.equal(s.gradeStatus, "graded");
});

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), "routes");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("every route file that reads a stored score imports the gate", () => {
  const readers = readdirSync(ROUTES)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => /scoreSnapshots\.pbs|score_snapshots/.test(code(readFileSync(join(ROUTES, f), "utf8"))));
  // Denominator first: if this drops, the scan stopped finding the routes, not the routes got safe.
  assert.deepEqual(readers.sort(), ["feed.ts", "goals.ts", "persons.ts"]);
  for (const f of readers) {
    const body = code(readFileSync(join(ROUTES, f), "utf8"));
    assert.ok(/import\s*\{[^}]*\bservedScore\b[^}]*\}\s*from\s*["']\.\.\/grade-status\.js["']/.test(body), `${f} must import servedScore`);
  }
});

test("persons.ts serves every score through the gate — list, detail, leaderboard, daily ten", () => {
  const body = code(readFileSync(join(ROUTES, "persons.ts"), "utf8"));
  // Four routes serve a score; each must decide it with servedScore, never pass the stored one.
  assert.equal([...body.matchAll(/servedScore\s*\(/g)].length, 4);
  assert.ok(!/pbs:\s*scoreMap\.get\(/.test(body), "a route still serves the stored score straight from scoreMap");
  assert.ok(!/score:\s*latestScore\[0\]/.test(body), "the detail route still serves the stored score object");
  assert.ok(!/return\s*\{\s*data:\s*results\s*\}/.test(body), "the leaderboard still returns the stored rows unchanged");
});

test("feed.ts decides the live score through the gate on BOTH routes and withholds stated scores", () => {
  const body = code(readFileSync(join(ROUTES, "feed.ts"), "utf8"));
  assert.equal([...body.matchAll(/live\s*=\s*[^;]*servedScore\s*\(/g)].length, 2, "both routes must gate `live`");
  // CARD-WIDE, not primary-only: a card tagging [graded, not-graded] must lose its chip too.
  // Codex r1 #2 — the first version gated `live` on the primary person alone.
  assert.equal(
    [...body.matchAll(/live\s*=\s*[^;]*!anyNotGraded[^;]*servedScore\s*\(/g)].length,
    2,
    "both routes must drop the chip when ANY tagged person is not graded",
  );
  // The CALL (`cond ? withholdScoreProse : id`), not the import — one import would satisfy a bare count.
  assert.equal([...body.matchAll(/anyNotGraded\s*\?\s*withholdScoreProse\s*:/g)].length, 2, "both routes must withhold a named score");
  assert.equal([...body.matchAll(/scoreWithheld:/g)].length, 2, "both routes must tell the card why");
  assert.equal([...body.matchAll(/gradeStatus:\s*[^,]*anyNotGraded\s*\?\s*"not_graded"/g)].length, 2, "both routes must serve the card's grade status");
});

test("the leaderboard never orders the not-graded by the score it withholds", () => {
  const body = code(readFileSync(join(ROUTES, "persons.ts"), "utf8"));
  const lb = body.slice(body.indexOf('app.get("/leaderboard"'), body.indexOf('app.get("/daily-ten"'));
  assert.ok(lb.length > 200, "the leaderboard route was not found — the slice is the denominator");
  // Codex r1 #3: a bare desc(pbs) after the evidence flag still ranked the not-graded across pages.
  assert.ok(!/desc\(scoreSnapshots\.pbs\)/.test(lb), "the score must not sort not-graded rows");
  // Direction too: `asc` here would list the not-graded ABOVE the ranked set (Codex r2 #5).
  assert.ok(/sql`\$\{hasGivingFact\} desc`/.test(lb), "graded rows must come first");
  assert.ok(/case when \$\{hasGivingFact\} then \$\{scoreSnapshots\.pbs\} end desc nulls last/.test(lb));
  assert.ok(/features:\s*s\.value == null \? null/.test(lb), "a withheld score must take its features with it");
});

test("goals.ts gates the score it serves on goal matches", () => {
  const body = code(readFileSync(join(ROUTES, "goals.ts"), "utf8"));
  assert.ok(/servedScore\s*\(/.test(body));
  assert.ok(!/data:\s*scored\b/.test(body), "goal matches must serve the gated rows, not the raw ones");
});
