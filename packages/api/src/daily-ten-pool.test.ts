import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyTenPool, type DailyTenCandidate } from "./daily-ten-pool";

// 12 living people who clear the floor, plus deceased people who ALSO clear it — the case that
// reached /today (Jim Simons, d. 2024, card 7 on 2026-09-21).
const living: DailyTenCandidate[] = Array.from({ length: 12 }, (_, i) => ({ id: `live-${i}`, deathYear: null }));
const dead: DailyTenCandidate[] = [
  { id: "simons", deathYear: 2024 },
  { id: "cox-anthony", deathYear: 2007 },
];
const all = [...living, ...dead];
const everyone = new Set(all.map((c) => c.id));

test("a deceased person who clears the floor is NOT in the pool", () => {
  const pool = dailyTenPool(all, everyone, everyone);
  assert.equal(pool.includes("simons"), false);
  assert.equal(pool.includes("cox-anthony"), false);
  assert.deepEqual(pool, living.map((c) => c.id));
});

test("the fewer-than-10 fallback excludes the deceased too", () => {
  // Only 3 people clear the floor, so the pool falls back to the index — which must stay living.
  const few = new Set(["live-0", "live-1", "simons"]);
  const pool = dailyTenPool(all, few, few);
  assert.equal(pool.includes("simons"), false);
  assert.equal(pool.includes("cox-anthony"), false);
  assert.deepEqual(pool, living.map((c) => c.id));
});

test("the floor still applies: a living person without a score or a receipt is out", () => {
  const scored = new Set(everyone);
  scored.delete("live-0");
  const receipt = new Set(everyone);
  receipt.delete("live-1");
  const pool = dailyTenPool(all, scored, receipt);
  assert.equal(pool.includes("live-0"), false);
  assert.equal(pool.includes("live-1"), false);
  assert.equal(pool.length, 10);
});
