import { test } from "node:test";
import assert from "node:assert/strict";
import {
  politicalDominatesGiving,
  POLITICAL_DOMINANCE_RATIO,
  directGivingDominatesGrants,
  DIRECT_GIVING_DOMINANCE_RATIO,
  readPhilanthropyFacts,
} from "./receipt-hook";
import { foundationTotals } from "./foundation-endowment";

test("the live case that found this — Reyes, 2026-09-04's daily ten", () => {
  // $30.0M political against $23K of foundation grants, ~1,300x. The card led with the $23K.
  assert.equal(politicalDominatesGiving(23_000, 30_000_000), true);
});

test("the nine cards that must stay silent — same day, same ten", () => {
  // Kathy Britton: $275K given, $433K political — 1.6x. Same size, no story, no contrast line.
  assert.equal(politicalDominatesGiving(275_000, 433_000), false);
  // Mark Davis: $457K given, $6K political — giving is the larger number.
  assert.equal(politicalDominatesGiving(457_000, 6_000), false);
  // Catherine Malone: $30M given, $4K political.
  assert.equal(politicalDominatesGiving(30_000_000, 4_000), false);
  // Alice Schwartz: $2M given, $4K political.
  assert.equal(politicalDominatesGiving(2_000_000, 4_000), false);
});

test("ABSENT IS NEVER ZERO, in both directions", () => {
  // No political record must not read as "gives generously by comparison".
  assert.equal(politicalDominatesGiving(23_000, 0), false);
  assert.equal(politicalDominatesGiving(23_000, null), false);
  assert.equal(politicalDominatesGiving(23_000, undefined), false);
  // No giving figure must not read as an infinite ratio — the plain political hook covers that
  // person, and inventing a contrast against a number we do not hold is a claim.
  assert.equal(politicalDominatesGiving(0, 30_000_000), false);
  assert.equal(politicalDominatesGiving(null, 30_000_000), false);
  assert.equal(politicalDominatesGiving(undefined, 30_000_000), false);
  // Neither side.
  assert.equal(politicalDominatesGiving(0, 0), false);
  assert.equal(politicalDominatesGiving(Number.NaN, 30_000_000), false);
  assert.equal(politicalDominatesGiving(23_000, Number.NaN), false);
});

test("the boundary sits exactly at the ratio, in both directions", () => {
  assert.equal(politicalDominatesGiving(1_000, 1_000 * POLITICAL_DOMINANCE_RATIO), true);
  assert.equal(politicalDominatesGiving(1_000, 1_000 * POLITICAL_DOMINANCE_RATIO - 1), false);
});

test("negative inputs are refused rather than arithmetically compared", () => {
  // A negative stored total is a broken row, not a person who un-gave money. It must not satisfy
  // the ratio by being small — `-1 * 10 = -10`, which any positive political total exceeds.
  assert.equal(politicalDominatesGiving(-1, 100), false);
  assert.equal(politicalDominatesGiving(100, -1), false);
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * readPhilanthropyFacts — BEHAVIOURAL, over every fact ordering.
 *
 * The defect these cover is order-dependent, and the route's nine source-shape assertions all
 * passed while it was live (adversarial review, 2026-09-14). Shape tests read the code; these run it.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

// THE REAL COLLAPSE, not a double. A hand-summing test double is itself a fork of the one thing
// B-030 exists to prevent — and the fork guard caught exactly that when this file first used one
// (2026-09-14). Injecting the real function also makes these tests say something about the
// composition rather than about a stub.
const totals = foundationTotals;

const FOUNDATION = {
  factKey: "foundation_990s",
  factType: "philanthropy",
  factValue: { foundations: [{ totalAssets: 9e9, grantsPaid: 14501841217 }] },
};
const PLEDGE = {
  factKey: "giving_pledge",
  factType: "philanthropy",
  factValue: { source: "The Giving Pledge", signatory: true, pledgeName: "X" },
};
const DIRECT = {
  factKey: "total_giving",
  factType: "philanthropy",
  factValue: { cumulativeGiving: 7e9, periodLabel: "since 2015", source: "CZI (ProPublica)" },
};

/** Every ordering of the given facts. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

test("THE 88-PERSON DEFECT: a pledge fact can never zero out a foundation record, in ANY order", () => {
  const orders = permutations([FOUNDATION, PLEDGE]);
  assert.equal(orders.length, 2);
  for (const order of orders) {
    const r = readPhilanthropyFacts(order, totals);
    assert.equal(r.givingRaw, 14501841217, `order [${order.map((f) => f.factKey)}] lost the 990 grants`);
    assert.equal(r.foundationsCount, 1);
    assert.equal(r.givingPledge, true, "the pledge is still recorded — it just no longer clobbers");
  }
});

test("all three philanthropy shapes together are order-independent — all 6 permutations agree", () => {
  const readings = permutations([FOUNDATION, PLEDGE, DIRECT]).map((o) => readPhilanthropyFacts(o, totals));
  assert.equal(readings.length, 6);
  for (const r of readings) {
    assert.equal(r.givingRaw, 14501841217);
    assert.equal(r.assetsRaw, 9e9);
    assert.equal(r.givingPledge, true);
    assert.deepEqual(r.directGiving, { amount: 7e9, period: "since 2015", source: "CZI (ProPublica)", annual: null });
  }
});

test("Zuckerberg's shape: direct giving present, no foundation — the ladder can reach a receipt", () => {
  const r = readPhilanthropyFacts([PLEDGE, DIRECT], totals);
  assert.equal(r.givingRaw, 0, "no foundation record to report");
  assert.equal(r.givingPledge, true);
  assert.equal(r.directGiving?.amount, 7e9, "the curated receipt is what outranks the promise");
});

test("a curated row whose periodLabel is NOT a period is refused, not interpolated", () => {
  // Live rows: Bloomberg "$21B+ lifetime", Knight "≥$2.7B to OHSU".
  for (const periodLabel of ["$21B+ lifetime", "≥$2.7B to OHSU", "lifetime", "", "since 20"]) {
    const r = readPhilanthropyFacts(
      [{ ...DIRECT, factValue: { ...DIRECT.factValue, periodLabel } }],
      totals,
    );
    assert.equal(r.directGiving, null, `"${periodLabel}" must not reach a card`);
  }
});

test("a curated amount that is not a real finite number is refused", () => {
  for (const cumulativeGiving of [true, "7000000000", "Infinity", Infinity, NaN, null, [7e9], 0, -7e9, 0.0001, 999999]) {
    const r = readPhilanthropyFacts(
      [{ ...DIRECT, factValue: { ...DIRECT.factValue, cumulativeGiving } }],
      totals,
    );
    assert.equal(r.directGiving, null, `${JSON.stringify(cumulativeGiving)} must not reach a card`);
  }
});

test("a curated row with no source states nothing", () => {
  const r = readPhilanthropyFacts([{ ...DIRECT, factValue: { ...DIRECT.factValue, source: "  " } }], totals);
  assert.equal(r.directGiving, null);
});

test("no philanthropy facts at all reads as absent, never zero-with-confidence", () => {
  const r = readPhilanthropyFacts([], totals);
  assert.deepEqual(r, { givingRaw: 0, assetsRaw: 0, foundationsCount: 0, directGiving: null, givingPledge: false });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * directGivingDominatesGrants — the 990 grant line loses the /today lead ONLY to a curated figure
 * that dwarfs it on the same annual basis. The live shapes below are the prod rows read 2026-09-21
 * (raw grant sums per person; the annualized figure is what the curated fetcher stores).
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** A person's two philanthropy facts, shaped the way the fetchers write them. */
function givingFacts(grantsPaid: number, curated: { cumulativeGiving: number; annualGiving: number; periodLabel: string; source: string }) {
  return [
    { factKey: "foundation_990s", factType: "philanthropy", factValue: { foundations: [{ totalAssets: 1e6, grantsPaid }] } },
    { factKey: "total_giving", factType: "philanthropy", factValue: curated },
  ];
}

test("the live cases that found this — Buffett and Soros now lead with their sourced giving", () => {
  const cases = [
    { who: "Warren Buffett", grants: 2_276, curated: { cumulativeGiving: 60e9, annualGiving: 3e9, periodLabel: "since 2006", source: "CNBC" } },
    // Soros's period as his cited source states it (1984), not the 1993 the row carried until 2026-09-21.
    { who: "George Soros", grants: 1_629_392, curated: { cumulativeGiving: 32e9, annualGiving: 761_904_762, periodLabel: "since 1984", source: "Open Society Foundations" } },
  ];
  for (const c of cases) {
    const r = readPhilanthropyFacts(givingFacts(c.grants, c.curated), totals);
    assert.equal(r.givingRaw, c.grants, `${c.who}: the 990 grants are still read`);
    assert.ok(r.directGiving, `${c.who}: the curated receipt is renderable`);
    assert.equal(directGivingDominatesGrants(r.givingRaw, r.directGiving.annual), true, `${c.who} must lead with the curated figure`);
  }
});

test("Bloomberg stays on his 990 — $3.7B a year against $1.42B of grants is 2.6x, not a story", () => {
  // His live label ("$21B+ lifetime") is refused today; this pins the day B-048 gives it a period.
  const r = readPhilanthropyFacts(
    givingFacts(1_423_438_717, { cumulativeGiving: 21e9, annualGiving: 3.7e9, periodLabel: "since 2006", source: "CNBC" }),
    totals,
  );
  assert.equal(directGivingDominatesGrants(r.givingRaw, r.directGiving?.annual), false);
});

test("Scott cannot lead — her cited source names no start year, so her row carries no period to state", () => {
  // Her figure dwarfs the three generic "Scott Foundation" rows (B-021), but a margin is not a source.
  const r = readPhilanthropyFacts(
    givingFacts(4_515_507, { cumulativeGiving: 26e9, annualGiving: 3_714_285_714, periodLabel: "via Yield Giving", source: "Yield Giving" }),
    totals,
  );
  assert.equal(r.directGiving, null);
});

test("Knight cannot lead yet — his label is not a period, so there is no renderable receipt to promote", () => {
  // His annualized figure dwarfs his ~$1.30M of grants, but "≥$2.7B to OHSU" is refused upstream, and
  // the wording for a lower bound is B-048's open question. He ships second, deliberately.
  const r = readPhilanthropyFacts(
    givingFacts(1_300_571, { cumulativeGiving: 2.7e9, annualGiving: 150e6, periodLabel: "≥$2.7B to OHSU", source: "OPB / OHSU" }),
    totals,
  );
  assert.equal(r.directGiving, null);
});

test("the annualized figure is carried for comparison, and refused when it is not a real positive number", () => {
  const base = { cumulativeGiving: 7e9, periodLabel: "since 2015", source: "CZI (ProPublica)" };
  const read = (annualGiving: unknown) =>
    readPhilanthropyFacts([{ ...DIRECT, factValue: { ...base, annualGiving } }], totals).directGiving?.annual;
  assert.equal(read(636_363_636), 636_363_636);
  for (const bad of [undefined, null, 0, -5e8, Infinity, "abc", NaN, true, "5e9", [5e9]]) {
    assert.equal(read(bad), null, `${String(bad)} must not become a comparable annual figure`);
  }
});

test("ABSENT IS NEVER ZERO for the curated comparison, in both directions", () => {
  // No grants: the ladder already reaches the curated tier, so this predicate has nothing to overturn.
  assert.equal(directGivingDominatesGrants(0, 3e9), false);
  assert.equal(directGivingDominatesGrants(null, 3e9), false);
  assert.equal(directGivingDominatesGrants(undefined, 3e9), false);
  // No annualized figure: nothing to compare, so the auditable 990 keeps the lead.
  assert.equal(directGivingDominatesGrants(2_276, null), false);
  assert.equal(directGivingDominatesGrants(2_276, undefined), false);
  assert.equal(directGivingDominatesGrants(2_276, 0), false);
  assert.equal(directGivingDominatesGrants(Number.NaN, 3e9), false);
  assert.equal(directGivingDominatesGrants(2_276, Number.NaN), false);
  assert.equal(directGivingDominatesGrants(2_276, Infinity), false);
});

test("the curated boundary sits exactly at the ratio, and negatives are refused", () => {
  assert.equal(directGivingDominatesGrants(1_000, 1_000 * DIRECT_GIVING_DOMINANCE_RATIO), true);
  assert.equal(directGivingDominatesGrants(1_000, 1_000 * DIRECT_GIVING_DOMINANCE_RATIO - 1), false);
  assert.equal(directGivingDominatesGrants(-1, 3e9), false);
  assert.equal(directGivingDominatesGrants(1_000, -3e9), false);
});
