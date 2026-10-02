import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dailySeed, dailyOrder } from "./daily-ten-order";

const POOL = Array.from({ length: 300 }, (_, i) => `p${String(i).padStart(3, "0")}`);
const tenFor = (date: string, seed = dailySeed) => dailyOrder(POOL, seed(date)).slice(0, 10).join(",");

/** Every UTC date of a year, "YYYY-MM-DD". */
function datesOf(year: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The seed the route shipped until 2026-09-21, kept ONLY as this file's positive control. */
const charCodeSumSeed = (date: string) => Array.from(date).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

test("the defect: 09-12, 09-21 and 09-30 served the SAME ten under the old seed — and no longer do", () => {
  // Positive control first, so a green below cannot come from a test that could never see the defect.
  assert.equal(tenFor("2026-09-12", charCodeSumSeed), tenFor("2026-09-21", charCodeSumSeed));
  assert.equal(tenFor("2026-09-21", charCodeSumSeed), tenFor("2026-09-30", charCodeSumSeed));
  const fixed = new Set(["2026-09-12", "2026-09-21", "2026-09-30"].map((d) => tenFor(d)));
  assert.equal(fixed.size, 3);
});

test("every day of 2026 gets its own ten (the old seed gave the whole year 19)", () => {
  const days = datesOf(2026);
  assert.equal(days.length, 365);
  assert.equal(new Set(days.map((d) => tenFor(d, charCodeSumSeed))).size, 19, "control: the old seed's collapse");
  assert.equal(new Set(days.map((d) => tenFor(d))).size, 365);
});

test("the same day in a different year is a different ten — the seed reads the whole date", () => {
  // A seed over only "MM-DD" would pass every 2026-only test and repeat the lineup each year.
  assert.notEqual(tenFor("2026-09-21"), tenFor("2027-09-21"));
  assert.notEqual(tenFor("2026-01-01"), tenFor("2027-01-01"));
});

test("the same date always gives the same order", () => {
  assert.deepEqual(dailyOrder(POOL, dailySeed("2026-09-21")), dailyOrder(POOL, dailySeed("2026-09-21")));
});

test("the order is a permutation of the pool and does not mutate it", () => {
  const input = [...POOL];
  const out = dailyOrder(input, dailySeed("2026-09-21"));
  assert.deepEqual(input, POOL, "the caller's array is untouched");
  assert.deepEqual([...out].sort(), [...POOL].sort());
});

test("the route seeds from dailySeed and orders through dailyOrder — no inline copy left behind", () => {
  const ROUTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "routes", "persons.ts"), "utf8");
  assert.match(ROUTE, /import \{ dailySeed, dailyOrder \} from "\.\.\/daily-ten-order\.js";/);
  assert.match(ROUTE, /const seed = dailySeed\(today\);/);
  // B-055 (2026-09-27): the pool is now dailyTenPool's output; the seed and the order are unchanged.
  assert.match(ROUTE, /const dailyIds = dailyOrder\(dailyTenPool\(candidates, scoredSet, receiptSet\), seed\)\.slice\(0, 10\);/);
  assert.doesNotMatch(ROUTE, /charCodeAt\(0\), 0\)/);
  assert.doesNotMatch(ROUTE, /1664525/);
});
