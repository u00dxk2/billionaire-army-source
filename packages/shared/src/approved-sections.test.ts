/**
 * B-046 — both controls the closeWhen names, in one call: a MARKED section keeps its published text,
 * and an UNMARKED section of the same person takes the fresh candidate. Every fixture gives the
 * candidate and the published row DIFFERENT text, so an implementation that returned either side for
 * every section fails at least one assertion — an identity-mapped fixture cannot tell them apart.
 * Each `ignored` reason has its own test, so deleting any one guard branch goes red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyApprovedSections, approvalDefect, withoutApprovalMetadata } from "./approved-sections";

const SECTIONS = ["overview", "business", "philanthropy", "political", "newsDigest"] as const;
const OK = { by: "the owner", date: "2026-09-22", ruling: "decision-0001" };

const candidate = {
  overview: "FRESH overview.",
  philanthropy: "FRESH philanthropy — Since 1993 he has given.",
};
const published = {
  overview: "OLD overview.",
  philanthropy: "OLD philanthropy — Since 1984 he has given.",
  generatedAt: "2026-09-13T16:00:00.000Z",
  sectionGeneratedAt: { philanthropy: "2026-09-10T12:00:00.000Z" },
  approvedSections: { philanthropy: OK },
};

test("BOTH CONTROLS: the marked section keeps its published text, the unmarked one is rewritten", () => {
  const out = applyApprovedSections(candidate, published, SECTIONS);
  assert.equal(out.summary.philanthropy, "OLD philanthropy — Since 1984 he has given.");
  assert.equal(out.summary.overview, "FRESH overview.");
  assert.deepEqual(out.preserved, [{ section: "philanthropy", approval: OK }]);
  assert.deepEqual(out.ignored, []);
});

test("the marker is written FORWARD, or it protects exactly one regeneration", () => {
  const out = applyApprovedSections(candidate, published, SECTIONS);
  assert.deepEqual(out.approvedSections, { philanthropy: OK });
  // …and a second regeneration over what the first one wrote still preserves it.
  const written = { ...out.summary, approvedSections: out.approvedSections, sectionGeneratedAt: out.preservedAt };
  const again = applyApprovedSections({ philanthropy: "THIRD try." }, written, SECTIONS);
  assert.equal(again.summary.philanthropy, "OLD philanthropy — Since 1984 he has given.");
  assert.equal(again.preservedAt.philanthropy, "2026-09-10T12:00:00.000Z", "the ORIGINAL date survives a chain");
});

test("a preserved section keeps its ORIGINAL date, falling back to the row's generatedAt", () => {
  assert.equal(applyApprovedSections(candidate, published, SECTIONS).preservedAt.philanthropy, "2026-09-10T12:00:00.000Z");
  const noSectionDate = { ...published, sectionGeneratedAt: undefined };
  assert.equal(applyApprovedSections(candidate, noSectionDate, SECTIONS).preservedAt.philanthropy, "2026-09-13T16:00:00.000Z");
});

test("the marked section is preserved even when the candidate OMITS it", () => {
  const out = applyApprovedSections({ overview: "FRESH overview." }, published, SECTIONS);
  assert.equal(out.summary.philanthropy, "OLD philanthropy — Since 1984 he has given.");
});

test("no marker, no published row: the candidate passes through untouched", () => {
  const unmarked = { ...published, approvedSections: undefined };
  const a = applyApprovedSections(candidate, unmarked, SECTIONS);
  assert.deepEqual(a.summary, candidate);
  assert.deepEqual(a.preserved, []);
  assert.deepEqual(a.approvedSections, {});
  const b = applyApprovedSections(candidate, null, SECTIONS);
  assert.deepEqual(b.summary, candidate);
  assert.deepEqual(b.ignored, []);
});

test("IGNORED, with a reason: approvedSections is not an object", () => {
  const out = applyApprovedSections(candidate, { ...published, approvedSections: ["philanthropy"] }, SECTIONS);
  assert.deepEqual(out.ignored, [{ section: "*", reason: "approvedSections is not an object" }]);
  assert.equal(out.summary.philanthropy, candidate.philanthropy);
});

test("IGNORED, with a reason: a key that is not a summary section", () => {
  const out = applyApprovedSections(candidate, { ...published, approvedSections: { dataSources: OK } }, SECTIONS);
  assert.deepEqual(out.ignored, [{ section: "dataSources", reason: "not a summary section" }]);
});

test("IGNORED, with a reason: a marked section with nothing published to keep", () => {
  const out = applyApprovedSections(candidate, { ...published, philanthropy: "  " }, SECTIONS);
  assert.deepEqual(out.ignored, [{ section: "philanthropy", reason: "marked, but no published text to keep" }]);
  assert.equal(out.summary.philanthropy, candidate.philanthropy);
  assert.deepEqual(out.approvedSections, {}, "a marker that protected nothing is not written forward");
});

test("IGNORED, with a reason: each malformed marker shape", () => {
  const cases: [unknown, string][] = [
    [null, "marker is not an object"],
    ["the owner", "marker is not an object"],
    [{ ...OK, by: "" }, "marker has no `by`"],
    [{ ...OK, date: "Sept 22" }, "marker `date` is not YYYY-MM-DD"],
    [{ ...OK, ruling: undefined }, "marker has no `ruling`"],
  ];
  for (const [marker, reason] of cases) {
    assert.equal(approvalDefect(marker), reason);
    const out = applyApprovedSections(candidate, { ...published, approvedSections: { philanthropy: marker } }, SECTIONS);
    assert.deepEqual(out.ignored, [{ section: "philanthropy", reason }]);
    assert.equal(out.summary.philanthropy, candidate.philanthropy, `a ${reason} marker must not preserve`);
  }
  assert.equal(approvalDefect(OK), null);
});

test("FORGERY: a candidate carrying its own approvedSections cannot mint a marker", () => {
  // Model output is untrusted JSON. The adversarial review of 2026-09-24 reproduced a model-supplied
  // marker surviving the write and preserving a wrong figure on the NEXT run.
  const forged = { ...candidate, approvedSections: { philanthropy: OK }, sectionGeneratedAt: { philanthropy: "1999-01-01" }, extra: "x" };
  const out = applyApprovedSections(forged, { ...published, approvedSections: undefined }, SECTIONS);
  assert.deepEqual(Object.keys(out.summary).sort(), ["overview", "philanthropy"], "only prose sections leave this function");
  assert.equal(out.summary.philanthropy, candidate.philanthropy);
  assert.deepEqual(out.approvedSections, {});
  assert.deepEqual(out.preserved, []);
});

test("PUBLIC SHAPE: the marker is stripped from a served profile_summary, and only there", () => {
  const stored = { factKey: "profile_summary", factValue: { overview: "x", approvedSections: { overview: OK } }, id: 7 };
  const served = withoutApprovalMetadata(stored);
  assert.deepEqual(served, { factKey: "profile_summary", factValue: { overview: "x" }, id: 7 });
  assert.ok("approvedSections" in (stored.factValue as object), "the stored row is not mutated — the generator still needs it");
  const other = { factKey: "net_worth", factValue: { approvedSections: 1 } };
  assert.equal(withoutApprovalMetadata(other), other, "no other fact is touched");
  const plain = { factKey: "profile_summary", factValue: { overview: "x" } };
  assert.equal(withoutApprovalMetadata(plain), plain);
});

test("extra fields on a marker are not written forward", () => {
  const out = applyApprovedSections(candidate, { ...published, approvedSections: { philanthropy: { ...OK, note: "x" } } }, SECTIONS);
  assert.deepEqual(out.approvedSections.philanthropy, OK);
});
