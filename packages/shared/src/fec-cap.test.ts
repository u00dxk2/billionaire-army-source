import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFecRecordCapped, fecReportedTotal, FEC_PAGE_SIZE } from "./fec-cap";

describe("isFecRecordCapped", () => {
  it("flags a record sitting exactly on the fetcher's page size", () => {
    // The live shape of the defect: 548 of 877 approved persons came back with count === 100
    // because fec.ts requests per_page=100 and never paginates (measured 2026-08-29).
    assert.equal(isFecRecordCapped({ count: 100 }), true);
  });

  it("does NOT flag a record under the page size — the positive control that count is read at all", () => {
    assert.equal(isFecRecordCapped({ count: 99 }), false);
    assert.equal(isFecRecordCapped({ count: 43 }), false);
  });

  it("believes the FEC's own total over the page-size heuristic, in BOTH directions", () => {
    // Reported total larger than what we stored => capped, even below the page size.
    assert.equal(isFecRecordCapped({ count: 60, reportedTotalContributions: 4000 }), true);
    // A person with exactly 100 contributions and an FEC total of 100 is COMPLETE, not capped.
    // Without this the page-size heuristic would publish a cap notice on a whole record — the
    // mirror of the original defect, a hedge on a number that needs none.
    assert.equal(isFecRecordCapped({ count: 100, reportedTotalContributions: 100 }), false);
  });

  it("treats an ABSENT reported total as unknown, never as zero", () => {
    // Every fact stored before 2026-08-29 lacks the field. `undefined > 100` is false, so a naive
    // comparison would silently call every legacy capped record complete — the comfortable-zero
    // shape this repo keeps hitting. Falling back to the page size is what keeps them flagged.
    assert.equal(isFecRecordCapped({ count: 100, reportedTotalContributions: null }), true);
    assert.equal(isFecRecordCapped({ count: 100, reportedTotalContributions: undefined }), true);
  });

  it("returns false rather than throwing on a missing or unusable count", () => {
    assert.equal(isFecRecordCapped(null), false);
    assert.equal(isFecRecordCapped(undefined), false);
    assert.equal(isFecRecordCapped({}), false);
    assert.equal(isFecRecordCapped({ count: NaN }), false);
  });

  it("pins the page size to the value fec.ts actually requests", () => {
    assert.equal(FEC_PAGE_SIZE, 100);
  });
});

describe("fecReportedTotal", () => {
  it("returns the FEC total when we captured one", () => {
    assert.equal(fecReportedTotal({ count: 100, reportedTotalContributions: 4213 }), 4213);
  });

  it("returns null when it was never captured, so the caller must say 'at least'", () => {
    assert.equal(fecReportedTotal({ count: 100 }), null);
    assert.equal(fecReportedTotal({ count: 100, reportedTotalContributions: null }), null);
    assert.equal(fecReportedTotal(null), null);
  });
});
