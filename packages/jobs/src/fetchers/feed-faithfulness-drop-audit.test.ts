import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditFaithfulnessDrop,
  extractMoneyFigures,
  figuresMatch,
} from "./feed-faithfulness-drop-audit";

// ---------------------------------------------------------------------------
// The five real 2026-08-08 drops. Reasons are copied from the scheduled run's log;
// receipts are what probe-passc-context.ts read back out of prod for each subject.
// These are the regression corpus: if this detector ever stops flagging them, it has
// stopped being able to detect the event it was built for.
// ---------------------------------------------------------------------------
const LIVE_2026_08_08 = [
  {
    who: "Melinda French Gates",
    reason:
      "$293K in political donations and $152.5B in foundation assets are unsupported in the article/source context for this card",
    receipts: "net worth ~$29.0B; $293K in political donations; $152.5B in foundation assets",
  },
  {
    who: "Brian Armstrong",
    reason:
      "$76,000 in political donations and $59M in foundation assets are unsupported in the article/source context for this card",
    receipts: "net worth ~$12.9B; $76K in political donations; $59M in foundation assets",
  },
  {
    who: "Roger Penske",
    reason:
      "$4.8 million in political donations and $116M in foundation assets are unsupported in the article/source context for this card",
    receipts: "net worth ~$7.7B; $4.8M in political donations; $116M in foundation assets",
  },
  {
    who: "Ankur Jain",
    reason:
      "$229,000 in political donations and $67M in foundation assets are unsupported in the article/source context for this card",
    receipts: "net worth ~$3.4B; $229K in political donations; $67M in foundation assets",
  },
  {
    who: "Mark Cuban",
    reason: "$7 million in foundation assets is unsupported in the article/source context for this card",
    receipts: "net worth ~$3.0B; $7K in political donations; $7M in foundation assets",
  },
];

for (const c of LIVE_2026_08_08) {
  test(`the 2026-08-08 wipeout: ${c.who}'s drop is flagged suspect`, () => {
    const r = auditFaithfulnessDrop(c.reason, c.receipts);
    assert.equal(r.suspect, true, `${c.who} should be flagged — the figure was in its own receipts`);
    assert.ok(r.matched.length > 0);
  });
}

test("byte-equality catches 4 of 5; numeric catches 5 of 5 — measured, not assumed", () => {
  // MEASURED WHEN THIS TEST FIRST RAN, and it corrected the P1 retro in BOTH directions.
  // The retro guessed a verbatim match would catch today's event outright; a later reading
  // guessed it would catch only the one byte-identical figure. Both were wrong, because a
  // drop reason usually cites TWO figures and the M-band ones ("$59M", "$116M", "$67M") pass
  // through the generator unexpanded while the K-band ones ("$76K" -> "$76,000") do not.
  // So verbatim catches any drop that happens to cite an M-band figure — 4 of 5 here — and
  // misses Mark Cuban, whose only cited figure was expanded to "$7 million".
  //
  // The lesson this pins is not the ratio, it is that ONE case is enough: a detector that
  // silently misses a fifth of a wipeout reports a smaller outage than actually happened.
  const verbatimHits = LIVE_2026_08_08.filter((c) =>
    extractMoneyFigures(c.reason).some((f) => c.receipts.includes(f.raw))
  );
  assert.equal(verbatimHits.length, 4, "verbatim matching catches the M-band citations only");
  assert.ok(!verbatimHits.some((c) => c.who === "Mark Cuban"), "Cuban is the one verbatim misses");

  // ...while the numeric detector catches all five, Cuban included.
  const numericHits = LIVE_2026_08_08.filter((c) => auditFaithfulnessDrop(c.reason, c.receipts).suspect);
  assert.equal(numericHits.length, 5);
});

// ---------------------------------------------------------------------------
// The silent direction. A detector that only ever fires is not a detector.
// ---------------------------------------------------------------------------
test("a genuinely invented figure is NOT flagged", () => {
  const r = auditFaithfulnessDrop(
    "$2.4M donation to the campaign is not in the source",
    "net worth ~$3.0B; $7K in political donations; $7M in foundation assets"
  );
  assert.equal(r.suspect, false);
  assert.deepEqual(r.matched, []);
});

test("a non-numeric drop reason is NOT flagged — this detector only speaks about figures", () => {
  // A real 2026-08-08 dry-run drop: the card asserted a ROLE, not a number.
  const r = auditFaithfulnessDrop(
    "now serving as NASA administrator not supported by source/context",
    "net worth ~$1.0B"
  );
  assert.equal(r.suspect, false);
});

test("empty receipts cannot produce a match — a card given no context can only have invented", () => {
  assert.equal(auditFaithfulnessDrop("$5M in foundation assets unsupported", "(none)").suspect, false);
});

// ---------------------------------------------------------------------------
// Parsing + tolerance
// ---------------------------------------------------------------------------
test("money parsing spans every notation the curator and the generator actually emit", () => {
  const vals = (s: string) => extractMoneyFigures(s).map((f) => f.value);
  assert.deepEqual(vals("$76K"), [76_000]);
  assert.deepEqual(vals("$76,000"), [76_000]);
  assert.deepEqual(vals("$4.8M"), [4_800_000]);
  assert.deepEqual(vals("$4.8 million"), [4_800_000]);
  assert.deepEqual(vals("$152.5B"), [152_500_000_000]);
  assert.deepEqual(vals("~$29.0B"), [29_000_000_000]);
  assert.deepEqual(vals("$1,234"), [1_234]);
});

test("tolerance absorbs the formatter's own rounding but not a different number", () => {
  assert.equal(figuresMatch(4_800_000, 4_800_000), true);
  assert.equal(figuresMatch(4_800_000, 4_790_000), true, "within the 1-decimal rounding band");
  assert.equal(figuresMatch(4_800_000, 5_800_000), false, "a genuinely different figure");
  // 76,400 formats to "$76K" with the K band's zero decimals, so these are the SAME
  // published figure and must match. Asserting false here was my error, not the code's.
  assert.equal(figuresMatch(76_000, 76_400), true, "both print as $76K — same figure after rounding");
  assert.equal(figuresMatch(76_000, 84_000), false, "$84K is a different published figure");
});

test("a figure appearing only in the receipts does not by itself flag a drop", () => {
  // The judge must have CITED it. Receipts alone are not evidence of a bad drop.
  const r = auditFaithfulnessDrop("headline names a different person", "$293K in political donations");
  assert.equal(r.suspect, false);
});
