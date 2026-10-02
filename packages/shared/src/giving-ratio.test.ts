import { test } from "node:test";
import assert from "node:assert/strict";
import { givingRatio, formatGivingPercent, parseNetWorth } from "./giving-ratio";

// The four live persons this shipped against (measured 2026-08-05 against the
// prod feed). Pinned so a parser change that breaks a real card fails here.
const LIVE = [
  { who: "Soros", nw: "~$8.3B", giving: 969696970, want: 11.7 },
  { who: "Bloomberg", nw: "~$55.5B", giving: 3700000000, want: 6.7 },
  { who: "Buffett", nw: "~$82.5B", giving: 3000000000, want: 3.6 },
  { who: "Zuckerberg", nw: "~$69.8B", giving: 636363636, want: 0.9 },
];

test("computes the ratio for every person it shipped against", () => {
  for (const c of LIVE) {
    const r = givingRatio(c.nw, { annualGiving: c.giving });
    assert.ok(r, `${c.who} should produce a ratio`);
    assert.equal(Number(r.percent.toFixed(1)), c.want, c.who);
  }
});

// THE SAFETY PROPERTY. ~90% of cards have no curated giving fact, and a
// rendered "0%" there would be a false claim that a named living person gives
// nothing — B-026's defect class pointed at a person. Absent, never zero.
test("returns null rather than 0 whenever it cannot state the ratio truthfully", () => {
  assert.equal(givingRatio("~$8.3B", undefined), null, "no giving fact at all");
  assert.equal(givingRatio("~$8.3B", {}), null, "giving fact with no annualGiving");
  assert.equal(givingRatio("~$8.3B", { annualGiving: 0 }), null, "explicit zero giving");
  assert.equal(givingRatio("~$8.3B", { annualGiving: "not a number" }), null, "unparseable giving");
  assert.equal(givingRatio(undefined, { annualGiving: 1e9 }), null, "no net worth");
  assert.equal(givingRatio("unparseable", { annualGiving: 1e9 }), null, "unparseable net worth");
  assert.equal(givingRatio("$0", { annualGiving: 1e9 }), null, "zero net worth (no divide-by-zero)");
});

test("parses the net-worth shapes the facts actually carry", () => {
  // Compared with a relative tolerance, not strict equality: 8.3 * 1e9 is
  // 8300000000.000001 in float. Irrelevant at ~1e-16 of the value, but a strict
  // assert makes the suite fail on arithmetic that is working fine.
  const close = (got: number | null, want: number) =>
    assert.ok(got != null && Math.abs(got - want) / want < 1e-9, `${got} !~= ${want}`);

  close(parseNetWorth("~$1.14T"), 1.14e12);
  close(parseNetWorth("~$8.3B"), 8.3e9);
  close(parseNetWorth("$539M"), 539e6);
  close(parseNetWorth({ value: "$3B" }), 3e9);
  assert.equal(parseNetWorth(null), null);
});

test("formats at one decimal, because the comparison IS the story", () => {
  assert.equal(formatGivingPercent(11.66), "11.7%");
  assert.equal(formatGivingPercent(0.91), "0.9%");
  // Rounding to whole numbers above 10% turned Soros's 11.66% into "12%" and
  // collapsed the gap against Bloomberg's 6.7% that the line exists to show.
  assert.equal(formatGivingPercent(47.3), "47.3%");
  // A sub-0.1% ratio rendered as "0.0%" reads as zero, which is the same false
  // claim the null branch exists to prevent.
  assert.equal(formatGivingPercent(0.017), "<0.1%");
});
