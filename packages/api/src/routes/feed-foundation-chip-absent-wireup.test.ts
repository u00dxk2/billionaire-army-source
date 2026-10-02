import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * B-067 — a foundation chip with NO backing fact renders nothing, never the frozen contextData copy.
 *
 * The served chip is rebuilt from the live foundation_990s fact (B-030). But a person with no such
 * fact got NO map entry, and both routes spread the rebuilt chip only when it is `!== undefined` —
 * so the card fell back to the chip frozen at curation time. Once a wrong attribution was deleted
 * (the fetcher's self-heal, or the 59-person '& family' repair), its "$7M in foundation assets"
 * would have kept rendering forever (Codex review round 2, 2026-09-30).
 *
 * A SOURCE check, and it says so: feed.ts imports auth.js, which builds a Supabase client at module
 * scope, so the route cannot be imported here. The BEHAVIOURAL proof is B-067's cache-busted read of
 * an affected card after the repair. Comments are stripped so this file's own prose cannot pass it.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "feed.ts");
const body = readFileSync(ROUTE, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("every READ person gets a null chip before the fact loop, so an absent fact clears the frozen chip", () => {
  const fn = body.slice(body.indexOf("async function loadGivingRatios"), body.indexOf("export const feedRoutes"));
  const seed = fn.indexOf("for (const id of personIds) chips.set(id, null);");
  const early = fn.indexOf("if (personIds.length === 0)");
  const loop = fn.indexOf("for (const r of rows)");
  assert.ok(seed > 0, "loadGivingRatios must seed a null chip for every person it reads");
  assert.ok(early >= 0 && early < seed, "the seed sits after the empty-input early return");
  assert.ok(loop > seed, "the seed must run BEFORE the fact loop, or it would overwrite real chips");
});

test("both routes still apply the rebuilt chip whenever it is defined — null included", () => {
  assert.match(body, /\.\.\.\(freshChip !== undefined \? \{ philanthropy: freshChip \} : \{\}\)/);
  assert.match(body, /\.\.\.\(philanthropyChip !== undefined \? \{ philanthropy: philanthropyChip \} : \{\}\)/);
});
