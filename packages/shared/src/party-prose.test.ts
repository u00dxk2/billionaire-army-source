import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readPartyProse, politicalProseDropsBucket } from "./party-prose";

/**
 * THE FOUNDING CASE, copied from prod (Alec Gores, 783dc9cf, measured 2026-09-08). The stored
 * buckets sum EXACTLY to the stored total; the prose renders three of four and drops DFL, so the
 * paragraph's own parts fall $518.75 short of the total it states one sentence earlier.
 */
const GORES_PROSE =
  "Federal Election Commission records show 93 contributions totaling $583,862.50. " +
  "Contributions attributed to Democrats totaled $214,043.75, while Republican contributions " +
  "totaled $155,900; $213,400 was categorized as unknown.";
const GORES_BREAKDOWN = { DEM: 214043.75, DFL: 518.75, REP: 155900, Unknown: 213400 };
const GORES_TOTAL = 583862.5;

describe("readPartyProse — the founding case", () => {
  test("the dropped bucket is caught, named and priced", () => {
    const r = readPartyProse(GORES_PROSE, GORES_BREAKDOWN, GORES_TOTAL);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DFL", amount: 518.75 }]);
    assert.equal(r.gap, 518.75);
  });

  test("stating the missing bucket makes it clean — the positive control on the predicate", () => {
    const fixed = GORES_PROSE.replace("$213,400 was categorized as unknown.", "$213,400 was categorized as unknown, and $518.75 went to Democratic–Farmer–Labor.");
    const r = readPartyProse(fixed, GORES_BREAKDOWN, GORES_TOTAL);
    assert.equal(r.verdict, "clean");
    assert.equal(r.gap, 0);
  });
});

describe("readPartyProse — the three ways it declines to judge", () => {
  test("prose that never states the total makes no arithmetic claim", () => {
    const prose = "Federal records show contributions to Democratic and Republican committees.";
    assert.equal(readPartyProse(prose, GORES_BREAKDOWN, GORES_TOTAL).verdict, "no-total-cited");
  });

  test("the total with NO bucket at all is thin, never a drop", () => {
    const prose = "Federal records show 93 contributions totaling $583,862.50 across several parties.";
    const r = readPartyProse(prose, GORES_BREAKDOWN, GORES_TOTAL);
    assert.equal(r.verdict, "thin");
    assert.equal(politicalProseDropsBucket(prose, GORES_BREAKDOWN, GORES_TOTAL), false);
  });

  test("a single non-zero bucket cannot be dropped", () => {
    const prose = "Federal records show contributions totaling $100.";
    assert.equal(readPartyProse(prose, { DEM: 100, REP: 0 }, 100).verdict, "too-few-buckets");
  });

  test("missing inputs read as no-data, never as a drop", () => {
    assert.equal(readPartyProse(null, GORES_BREAKDOWN, GORES_TOTAL).verdict, "no-data");
    assert.equal(readPartyProse(GORES_PROSE, null, GORES_TOTAL).verdict, "no-data");
    assert.equal(readPartyProse(GORES_PROSE, GORES_BREAKDOWN, null).verdict, "no-data");
    assert.equal(politicalProseDropsBucket("   ", GORES_BREAKDOWN, GORES_TOTAL), false);
  });
});

describe("amount matching is bounded on both sides", () => {
  /**
   * The substring trap, both directions: a bare `includes` would read "$15,000" as stating a
   * $5,000 bucket and "$5,000.50" as stating $5,000 — either one reports a dropped bucket as
   * stated, which is the false-clean this predicate exists to prevent.
   */
  test("a larger amount does not satisfy a smaller bucket", () => {
    const prose = "Records show contributions totaling $20,000, of which $15,000 went to Republicans.";
    const r = readPartyProse(prose, { REP: 15000, DEM: 5000 }, 20000);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 5000 }]);
  });

  test("a cents tail does not satisfy the whole-dollar bucket", () => {
    const prose = "Records show contributions totaling $10,000.50, of which $5,000.50 went to Republicans.";
    const r = readPartyProse(prose, { REP: 5000.5, DEM: 5000 }, 10000.5);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 5000 }]);
  });

  test("cents are matched as the prose writes them", () => {
    const prose = "Records show $1,234.56 total: $1,000 to Democrats and $234.56 to Republicans.";
    assert.equal(readPartyProse(prose, { DEM: 1000, REP: 234.56 }, 1234.56).verdict, "clean");
  });
});

/**
 * THE THREE FALSE-WITHHOLD CASES the adversarial review reproduced on 2026-09-11, before this
 * predicate ever reached a reader. Each one hid a paragraph that accounted for every dollar. They
 * are pinned by name because the asymmetry here is INVERTED from this repo's usual drop-on-doubt
 * rule: a false TRUE deletes a true paragraph from a live profile, so doubt keeps the paragraph.
 */
describe("false withholds — reproduced by the 2026-09-11 adversarial review", () => {
  test("1: correct REGENERATED prose states the merged amount the generator was handed", () => {
    // The write-path half hands the model merged buckets, so correct new prose says "$1,250 to
    // Democrats" while the stored fact still carries DEM 1000 + Dem 250. Demanding the raw parts
    // would hide exactly the paragraphs the regeneration fixes.
    const prose = "Records show contributions totaling $1,750: $1,250 to Democrats and $500 to Republicans.";
    const r = readPartyProse(prose, { DEM: 1000, Dem: 250, REP: 500 }, 1750);
    assert.equal(r.verdict, "clean");
    assert.equal(r.gap, 0);
  });

  test("1b: prose stating the RAW parts is still clean — today's corpus must not go dark either", () => {
    const prose = "Records show $1,750 total: $1,000 and $250 to Democratic committees, $500 to Republicans.";
    assert.equal(readPartyProse(prose, { DEM: 1000, Dem: 250, REP: 500 }, 1750).verdict, "clean");
  });

  test("1c: a group with one member stated and one omitted is still a drop", () => {
    // The accepting rule must not become "any member counts" — that would let a real omission pass.
    const prose = "Records show $1,750 total: $1,000 to Democrats and $500 to Republicans.";
    const r = readPartyProse(prose, { DEM: 1000, Dem: 250, REP: 500 }, 1750);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 1250 }]);
  });

  test("2: equivalent money spellings account for the dollar", () => {
    const cents = "Total $1,734: $1,234.00 to Democrats and $500 to Republicans.";
    assert.equal(readPartyProse(cents, { DEM: 1234, REP: 500 }, 1734).verdict, "clean");

    const ungrouped = "Total $1,734: $1234 to Democrats and $500 to Republicans.";
    assert.equal(readPartyProse(ungrouped, { DEM: 1234, REP: 500 }, 1734).verdict, "clean");

    const nbsp = "Total $1 734: $1 234 to Democrats and $500 to Republicans.";
    assert.equal(readPartyProse(nbsp, { DEM: 1234, REP: 500 }, 1734).verdict, "clean");
  });

  test("2b: the bounded match still holds — a bigger figure never satisfies a smaller bucket", () => {
    const prose = "Total $16,234: $15,000 to Republicans and nothing else stated.";
    const r = readPartyProse(prose, { REP: 15000, DEM: 1234 }, 16234);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 1234 }]);
  });

  test("4: a figure is spent once — one $1,000 cannot satisfy two $1,000 buckets", () => {
    const prose = "Total $2,500: $1,000 to Democrats and $500 to Republicans.";
    const r = readPartyProse(prose, { DEM: 1000, Dem: 1000, REP: 500 }, 2500);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 2000 }]);
  });

  test("5: a smaller figure is not found inside a larger grouped one", () => {
    const prose = "Total $100,100: $100,000 to Republicans.";
    const r = readPartyProse(prose, { DEM: 100, REP: 100000 }, 100100);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 100 }]);
  });

  test("6: a REFUND nets against its own party before judging, as the generator's input does", () => {
    // {DEM:1000, Dem:-250} reaches the model as Democratic $750. Filtering refunds before merging
    // made this predicate demand $1,000 and withhold the correct paragraph.
    const prose = "Total $1,250: $750 to Democrats and $500 to Republicans.";
    assert.equal(readPartyProse(prose, { DEM: 1000, Dem: -250, REP: 500 }, 1250).verdict, "clean");
  });

  test("7: an omission is still caught when a refund makes a bucket equal the total", () => {
    const prose = "Net total $100: $30 to Republicans and $20 to independents, with $50 in unknown refunds.";
    const r = readPartyProse(prose, { DEM: 100, REP: 30, IND: 20, Unknown: -50 }, 100);
    assert.equal(r.verdict, "drops-bucket");
    assert.deepEqual(r.missing, [{ code: "DEM", amount: 100 }]);
  });

  test("3: a bucket equal to the total cannot be read as a stated breakdown", () => {
    // A refund can make another bucket negative, so a positive bucket can equal the total. The one
    // occurrence of that figure is equally the total and the bucket; counting it as a stated bucket
    // turned prose stating NO breakdown into "states one, omits the rest".
    const prose = "Federal records show net contributions totaling $100 across several parties.";
    const r = readPartyProse(prose, { DEM: 100, REP: 50, Unknown: -50 }, 100);
    assert.notEqual(r.verdict, "drops-bucket");
    assert.equal(politicalProseDropsBucket(prose, { DEM: 100, REP: 50, Unknown: -50 }, 100), false);
  });
});

/**
 * THE SEVERE SHAPE, copied from prod (David Golub, 8324a3a3, measured 2026-09-11): the prose states
 * partisan amounts covering under half the record and omits $380,190.92 of unattributed money, so
 * the stated parts read as the whole story. This is the case that justifies withholding rather than
 * annotating — and it must be caught by the same rule as the $518.75 one, with no threshold between
 * them, because a threshold would have to be calibrated on a band whose ends interleave.
 */
test("the severe shape is the same verdict as the small one — no threshold in between", () => {
  const prose = "Federal records show contributions totaling $699,570.70, with $250,000 to Democrats and $69,379.78 to Republicans.";
  const r = readPartyProse(prose, { DEM: 250000, REP: 69379.78, UNK: 3000, Unknown: 377190.92 }, 699570.7);
  assert.equal(r.verdict, "drops-bucket");
  assert.equal(r.gap, 380190.92);
});
