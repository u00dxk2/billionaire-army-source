import { test } from "node:test";
import assert from "node:assert/strict";
import { labelFecMoneyForPrompt } from "./summary-fact-collapse";
import { buildUserPrompt } from "./summary-prompt";

/**
 * COPIED FROM PROD, not invented — the exact `fec_contributions` fact behind MacKenzie Scott's
 * live profile on 2026-08-28, which rendered as "100 Democratic contributions, 52.43 Republican
 * contributions, and 559.16 to PAC/Other". Note `count: 100` sitting beside `DEM: 100`: the
 * collision that made the misread easy is IN the fixture, so keep it byte-faithful.
 */
const SCOTT_FEC_FACT = {
  count: 100,
  dateRange: "2025-11-01 to 2025-12-28",
  totalAmount: 711.5900000000003,
  topRecipients: [
    { name: "WINRED", amount: 347.51 },
    { name: "ACTBLUE", amount: 140 },
  ],
  partyBreakdown: { DEM: 100, REP: 52.43000000000001, "PAC/Other": 559.1600000000001 },
};

const personWith = (factValue: unknown) => ({
  id: "test",
  name: "MacKenzie Scott",
  state: "Washington",
  industry: ["Technology"],
  birthYear: 1970,
  country: "United States",
  facts: [{ factKey: "fec_contributions", factValue, sourceType: "fec" }],
});

test("every party figure is labelled as money, so it cannot read as a contribution count", () => {
  const out = labelFecMoneyForPrompt(SCOTT_FEC_FACT) as Record<string, unknown>;
  assert.equal(out.partyBreakdown, undefined, "the unit-free field must not survive");
  // Keys are the SHARED display labels since B-038 (2026-09-11), not the raw FEC codes: the model
  // was dropping the buckets it could not name. Values are unchanged — labelling is not rounding.
  assert.deepEqual(out.partyBreakdownUsd, {
    Democratic: "$100",
    Republican: "$52.43",
    "PACs & other committees": "$559.16",
  });
  // `labelFecMoneyForPrompt` leaves `count` alone because it is not money — still true, and
  // still all this helper claims. Whether 100 is the PERSON's count is a different question,
  // answered by `labelFecTruncationForPrompt` (see summary-fec-truncation.test.ts). Keeping
  // the assertion here scoped to units is deliberate: it is what let the completeness defect
  // sit behind a green suite for a day.
  assert.equal(out.count, 100, "this helper does not touch count — units only, never completeness");
});

test("the float tail never reaches the model either", () => {
  const out = labelFecMoneyForPrompt(SCOTT_FEC_FACT) as Record<string, unknown>;
  assert.equal(out.totalAmount, undefined);
  assert.equal(out.totalAmountUsd, "$711.59");
  assert.ok(!JSON.stringify(out).includes("711.5900000000003"));
  assert.ok(!JSON.stringify(out).includes("52.43000000000001"));
});

/**
 * THE WIRE-UP TEST — the one that matters. The helper above stays green even if nobody calls it;
 * that is exactly how the 2026-08-26 /today float defect survived a green suite. This asserts the
 * string `buildUserPrompt` actually hands the model.
 */
test("WIRE-UP: the prompt the model receives carries no unit-free money field", () => {
  const prompt = buildUserPrompt(personWith(SCOTT_FEC_FACT) as never);
  assert.ok(prompt.includes("partyBreakdownUsd"), "labelled field must be present in the real prompt");
  assert.ok(!prompt.includes('"partyBreakdown"'), "unit-free field must not reach the model");
  assert.ok(!prompt.includes("711.5900000000003"), "raw float must not reach the model");
  assert.ok(prompt.includes("$52.43"), "the figure that shipped must appear as money");
});

test("a fact carrying no money is returned untouched", () => {
  const untouched = { foo: "bar", count: 3 };
  assert.equal(labelFecMoneyForPrompt(untouched), untouched);
  assert.equal(labelFecMoneyForPrompt(null), null);
  assert.equal(labelFecMoneyForPrompt("string"), "string");
});

/**
 * COPIED FROM PROD — John Sall's fact, and the reason money here is exact rather than routed
 * through `formatCurrency`. Rendered through the display ladder this list reads "$94K, $75,
 * $10, $6K", and on 2026-08-28 the model normalised the odd one out and wrote "$10,000
 * unknown" for a $10 figure. Mixed magnitudes in one list is the shape that triggers it, so
 * the fixture keeps all four.
 */
const SALL_FEC_FACT = {
  count: 100,
  totalAmount: 100218.47,
  partyBreakdown: { DEM: 93720.25, REP: 75, UNK: 10, "PAC/Other": 6413.22 },
};

test("money is exact and unabbreviated, so a small figure beside a large one cannot be normalised", () => {
  const out = labelFecMoneyForPrompt(SALL_FEC_FACT) as Record<string, unknown>;
  assert.deepEqual(out.partyBreakdownUsd, {
    Democratic: "$93,720.25",
    Republican: "$75",
    Unknown: "$10",
    "PACs & other committees": "$6,413.22",
  });
  const json = JSON.stringify(out);
  assert.ok(!json.includes("$94K"), "no abbreviation may reach the model");
  assert.ok(!json.includes("$6K"), "no abbreviation may reach the model");
});

/**
 * B-038 (2026-09-11). The corpus carries SIXTEEN raw keys for about six parties, and the model
 * rendered the ones it could name and silently dropped the rest — `DFL $518.75` missing from Alec
 * Gores' paragraph while the total it states includes it. The model now receives named buckets.
 * The keys change; the MONEY may not.
 */
test("the model receives named party buckets, case-variants folded, with the sum preserved exactly", () => {
  const raw = { DEM: 1000, Dem: 250, REP: 500, UNK: 40, Unknown: 60, DFL: 518.75, NNE: 15 };
  const out = labelFecMoneyForPrompt({ totalAmount: 2383.75, partyBreakdown: raw }) as Record<string, unknown>;
  const buckets = out.partyBreakdownUsd as Record<string, string>;

  assert.deepEqual(buckets, {
    Democratic: "$1,250",
    Republican: "$500",
    "Democratic–Farmer–Labor": "$518.75",
    Unknown: "$100",
    "No party listed": "$15",
  });

  // THE INVARIANT: labelling must never drop, invent or round money.
  const sumIn = Object.values(raw).reduce((a, b) => a + b, 0);
  const sumOut = Object.values(buckets).reduce((a, s) => a + Number(s.replace(/[$,]/g, "")), 0);
  assert.equal(sumOut, sumIn, "the amounts out must total the amounts in");

  // No raw code may survive into the prompt — an unnamed bucket is what got dropped.
  const json = JSON.stringify(buckets);
  for (const code of ["DEM", "Dem", "REP", "UNK", "DFL", "NNE"]) {
    assert.ok(!json.includes(`"${code}"`), `raw code ${code} must not reach the model`);
  }
});
