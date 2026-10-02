/**
 * B-051 — the WIRE-UP of the vote-ordering guard. The rule itself (`voteCastAt`'s clamp) is unit-
 * tested in @ba/shared; the ordering is enforced by SQL, which a unit test cannot exercise without a
 * database. The BEHAVIOURAL proof is therefore `npm run verify:vote-order`, which reproduces the
 * reordering against the real API with a throwaway user: pre-fix it exits RED (measured on prod
 * 2026-09-18 — the older verdict won, stored direction -1, stale request 201).
 *
 * These assertions fail when the guard is REMOVED or inverted in source. Ceiling, stated: they read
 * source. A green here with a red probe means the guard is written and not working.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "votes.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("the route stamps the vote with the SHARED clamp, never a local copy", () => {
  assert.match(SRC, /import\s*\{[^}]*voteCastAt[^}]*\}\s*from\s*"@ba\/shared"/);
  assert.match(SRC, /const castAt = voteCastAt\(body\.castAt, Date\.now\(\)\)/);
});

test("the upsert overwrites ONLY a vote that is no newer than this one", () => {
  assert.match(SRC, /setWhere: lte\(votes\.createdAt, castAt\)/, "without this the older verdict wins whenever it commits last");
  // Round 3: a raw Date interpolated into a sql template skips the timestamp column's encoder and
  // reaches the driver as a Date, throwing on EVERY vote write — a guard that 500s is not a guard.
  assert.doesNotMatch(SRC, /sql`[^`]*\$\{castAt\}[^`]*`/, "the stamp must be bound through a column-aware operator, never a raw template parameter");
  assert.match(SRC, /set: \{ direction, createdAt: castAt \}/, "the stored stamp must advance, or the next vote compares against a stale one");
  assert.match(SRC, /values\(\{[\s\S]*?createdAt: castAt,[\s\S]*?\}\)/, "the INSERT carries the stamp too: a first vote whose stamp was server-now could not be ordered against the voter's next one");
});

test("a superseded write is NOT reported as saved", () => {
  assert.match(SRC, /if \(!vote\) \{\s*return reply\.status\(409\)/, "a stale write reported 201 is the same lie B-050 retired");
});
