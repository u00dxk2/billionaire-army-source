import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diversifyByKind,
  distinctKindsInWindow,
  DEFAULT_KIND_SOFT_CAP,
} from "./feed-kind-diversity";
import { candidateKind, kindMix, formatKindMix } from "./feed-relevance-rank";
import type { CandidateKind } from "./feed-relevance-rank";

// R-048, 2026-09-07. The defect these guard: five curator runs published 7 cards, all
// `philanthropy`, while every on-axis gate read green. The reorder below is what stops
// the shortlist arriving as one kind; the reads are what make the next run's mix legible.

// ── candidateKind ────────────────────────────────────────────────────────────────

test("candidateKind reads the four groups off real-shaped headlines", () => {
  assert.equal(
    candidateKind("MacKenzie Scott donates $100 million to erase medical debt"),
    "giving"
  );
  assert.equal(
    candidateKind("Megadonor pours $50 million into super PAC ahead of midterms"),
    "political"
  );
  assert.equal(candidateKind("Musk is now the richest person on earth again"), "wealth");
  assert.equal(
    candidateKind("Regulators open antitrust probe into the takeover"),
    "power"
  );
});

// The honest limit, pinned so nobody reports the null as "off-axis".
test("candidateKind returns null when no positive signal matches — unclassified, NOT off-axis", () => {
  assert.equal(candidateKind("Billionaire spotted courtside at the playoff game"), null);
  assert.equal(candidateKind(""), null);
});

// THE MEASURED CASE, pinned as a regression. Under the summed 2x-title weighting this
// function first shipped with, these exact strings classified as GIVING: one political
// title hit (6) lost to four giving body hits (12). Bodies are long and titles short, so
// summing across both let incidental body vocabulary decide the kind — and it biased
// toward `giving`, the majority class this read exists to detect. Title-first fixes it.
test("the TITLE decides whenever it carries signal — a giving-heavy body cannot overrule it", () => {
  assert.equal(
    candidateKind("Super PAC filing names the donor", "a charitable foundation grant"),
    "political"
  );
});

test("the body is consulted ONLY when the title is silent", () => {
  assert.equal(candidateKind("A quiet Tuesday in Seattle", "he donated to charity"), "giving");
  // …and a title with signal ignores the body entirely.
  assert.equal(candidateKind("Antitrust probe opens", "he donated to charity"), "power");
});

test("candidateKind is winner-takes-all and reports the DOMINANT reading, not the only one", () => {
  // Genuinely both: a political-giving story. It resolves to one kind by design —
  // this is a documented limit, not a bug, and the test exists so it stays visible.
  const k = candidateKind("Donor's charitable foundation also bankrolled a super PAC");
  assert.ok(k === "giving" || k === "political", `expected one of the two kinds, got ${k}`);
});

// ── kindMix: the sum-check is the whole point ────────────────────────────────────

test("kindMix parts ALWAYS sum to the denominator — a broken classifier cannot read as zeros", () => {
  const items = [
    { title: "Gates donates to a charitable foundation" },
    { title: "Megadonor funds a super PAC" },
    { title: "Courtside at the playoff game" }, // unclassified
    { title: "" }, // unclassified
  ];
  const mix = kindMix(items);
  const sum = Object.values(mix.counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, mix.total);
  assert.equal(mix.total, 4);
  assert.equal(mix.counts.unclassified, 2);
});

test("kindMix reports every kind including zeros, so an absent kind is visible", () => {
  const mix = kindMix([{ title: "Bezos donates to charity" }]);
  assert.equal(mix.counts.giving, 1);
  assert.equal(mix.counts.political, 0);
  assert.equal(mix.counts.wealth, 0);
  assert.equal(mix.counts.power, 0);
});

test("formatKindMix always carries its denominator", () => {
  const s = formatKindMix(kindMix([{ title: "Bezos donates to charity" }]));
  assert.match(s, /giving 1/);
  assert.match(s, /of 1/);
  assert.equal(formatKindMix(kindMix([])), "none (of 0)");
});

// ── diversifyByKind ──────────────────────────────────────────────────────────────

interface Row {
  id: string;
  kind: CandidateKind | null;
}
const kindOf = (r: Row) => r.kind;
const ids = (rows: Row[]) => rows.map((r) => r.id).join(",");

test("THE REGRESSION — a monocultural head is broken up so other kinds reach the window", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "g3", kind: "giving" },
    { id: "g4", kind: "giving" },
    { id: "g5", kind: "giving" },
    { id: "p1", kind: "political" },
  ];
  const out = diversifyByKind(rows, kindOf, 3);
  // The first three giving survive; the surplus goes behind the political story.
  assert.equal(ids(out), "g1,g2,g3,p1,g4,g5");
});

test("NOTHING IS DROPPED — the output is a permutation of the input, always", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "g3", kind: "giving" },
    { id: "g4", kind: "giving" },
    { id: "w1", kind: "wealth" },
    { id: "u1", kind: null },
  ];
  const out = diversifyByKind(rows, kindOf, 2);
  assert.equal(out.length, rows.length);
  assert.deepEqual([...ids(out).split(",")].sort(), [...ids(rows).split(",")].sort());
});

test("relative order WITHIN a kind is preserved — this is a demotion, not a shuffle", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "g3", kind: "giving" },
    { id: "g4", kind: "giving" },
  ];
  const out = diversifyByKind(rows, kindOf, 1);
  assert.equal(ids(out), "g1,g2,g3,g4");
});

test("unclassified candidates are NEVER demoted — a blind spot must not become a ranking", () => {
  const rows: Row[] = [
    { id: "u1", kind: null },
    { id: "u2", kind: null },
    { id: "u3", kind: null },
    { id: "u4", kind: null },
  ];
  assert.equal(ids(diversifyByKind(rows, kindOf, 1)), "u1,u2,u3,u4");
});

// ── The regression the unit tests missed and a prod dry run caught ───────────────
//
// 2026-09-07. The first implementation appended demoted items to the end of the WHOLE
// list, so with an unclassified MAJORITY it pushed on-axis candidates behind every
// off-axis one: measured 2/14 on-axis in the shortlist against 11/11 and 12/12 on the
// scheduled runs. Every test above passed, because none had a realistic pool shape.
// These three assert the invariant directly rather than a hand-picked ordering.

/** The live-shaped pool: classified in the minority, as GDELT actually delivers. */
function realisticPool(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 17; i++) rows.push({ id: `g${i}`, kind: "giving" });
  for (let i = 0; i < 32; i++) rows.push({ id: `w${i}`, kind: "wealth" });
  for (let i = 0; i < 28; i++) rows.push({ id: `p${i}`, kind: "power" });
  for (let i = 0; i < 94; i++) rows.push({ id: `u${i}`, kind: null });
  // Interleave so classified and unclassified are genuinely mixed, as a real sort leaves them.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ((a.i * 7919) % 171) - ((b.i * 7919) % 171))
    .map((x) => x.r);
}

test("THE PROD REGRESSION — the classified/unclassified shape of every prefix is preserved", () => {
  const rows = realisticPool();
  const out = diversifyByKind(rows, kindOf, 3);
  // This is the property that makes an on-axis collapse impossible by construction:
  // at EVERY prefix length, the count of classified items is unchanged.
  for (let n = 1; n <= rows.length; n++) {
    const before = rows.slice(0, n).filter((r) => r.kind !== null).length;
    const after = out.slice(0, n).filter((r) => r.kind !== null).length;
    assert.equal(after, before, `prefix ${n}: classified count changed ${before} -> ${after}`);
  }
});

test("THE PROD REGRESSION — unclassified items never change position at all", () => {
  const rows = realisticPool();
  const out = diversifyByKind(rows, kindOf, 3);
  rows.forEach((r, i) => {
    if (r.kind === null) assert.equal(out[i].id, r.id, `unclassified moved at index ${i}`);
  });
});

test("it still does its job on a realistic pool — the head stops being one kind", () => {
  const rows = realisticPool();
  // Force a monocultural head among the classified slots.
  const head = rows.filter((r) => r.kind !== null).slice(0, 12).map((r) => r.id);
  assert.ok(head.length === 12);
  const out = diversifyByKind(rows, kindOf, 2);
  const outHeadKinds = new Set(
    out.filter((r) => r.kind !== null).slice(0, 6).map((r) => r.kind)
  );
  // With a cap of 2, the first six classified slots cannot be a single kind.
  assert.ok(outHeadKinds.size >= 2, `expected >=2 kinds in the classified head, got ${outHeadKinds.size}`);
});

test("a mixed list already under the cap is returned untouched", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "p1", kind: "political" },
    { id: "w1", kind: "wealth" },
  ];
  assert.equal(ids(diversifyByKind(rows, kindOf, 3)), "g1,p1,w1");
});

// The revert path, pinned so it cannot rot: the env override sets 0 and the prior
// ordering must come back EXACTLY. A revert nobody tested is not a revert.
test("softCap 0 or negative disables the reorder entirely — the documented revert path", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "g3", kind: "giving" },
    { id: "p1", kind: "political" },
  ];
  assert.equal(ids(diversifyByKind(rows, kindOf, 0)), ids(rows));
  assert.equal(ids(diversifyByKind(rows, kindOf, -1)), ids(rows));
});

test("the input array is not mutated", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "p1", kind: "political" },
  ];
  const before = ids(rows);
  diversifyByKind(rows, kindOf, 1);
  assert.equal(ids(rows), before);
});

test("the default soft cap is a real number a caller can rely on", () => {
  assert.ok(Number.isInteger(DEFAULT_KIND_SOFT_CAP) && DEFAULT_KIND_SOFT_CAP >= 1);
});

// ── distinctKindsInWindow: the before/after instrument ───────────────────────────

test("distinctKindsInWindow counts KINDS in the window, and the reorder raises it", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "g3", kind: "giving" },
    { id: "g4", kind: "giving" },
    { id: "p1", kind: "political" },
    { id: "w1", kind: "wealth" },
  ];
  assert.equal(distinctKindsInWindow(rows, kindOf, 4), 1);
  const out = diversifyByKind(rows, kindOf, 2);
  assert.equal(distinctKindsInWindow(out, kindOf, 4), 3);
});

// The negative case — the one that keeps the log line honest. If the POOL is
// monocultural there is nothing to reorder, and the run must not read as a fix.
test("a genuinely monocultural POOL shows a zero delta — a supply finding, not a selection one", () => {
  const rows: Row[] = [
    { id: "g1", kind: "giving" },
    { id: "g2", kind: "giving" },
    { id: "g3", kind: "giving" },
  ];
  const before = distinctKindsInWindow(rows, kindOf, 20);
  const after = distinctKindsInWindow(diversifyByKind(rows, kindOf, 1), kindOf, 20);
  assert.equal(before, 1);
  assert.equal(after, before);
});
