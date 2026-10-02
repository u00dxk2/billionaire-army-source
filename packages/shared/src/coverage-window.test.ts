import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coverageMisstatement, coverageWindow, planCoverageWindowFix } from "./coverage-window";

describe("coverageWindow", () => {
  it("never returns a BACKWARD window, whatever order the articles arrive in", () => {
    // The literal MacKenzie Scott defect, 2026-09-09: stored "2026-08-20 to 2026-08-11".
    assert.equal(coverageWindow(["2026-08-20", "2026-08-11"]), "2026-08-11 to 2026-08-20");
    assert.equal(coverageWindow(["2026-08-11", "2026-08-20"]), "2026-08-11 to 2026-08-20");
  });

  it("spans the full range rather than two arbitrary positions", () => {
    // The literal Bill Gates defect: six years of coverage published as two days, because the
    // first and last ELEMENTS were adjacent dates while the real span reached back to 2020.
    assert.equal(
      coverageWindow(["2026-08-19", "2020-09-02", "2026-08-21", "2026-08-20"]),
      "2020-09-02 to 2026-08-21",
    );
  });

  it("states a single date alone, never as a range against itself", () => {
    // "2026-08-21 to 2026-08-21" invents a span the evidence does not support.
    assert.equal(coverageWindow(["2026-08-21"]), "2026-08-21");
    assert.equal(coverageWindow(["2026-08-21", "2026-08-21"]), "2026-08-21");
  });

  it("is EMPTY rather than guessing when no date is parseable", () => {
    // Absent, never invented — the render prints "not recorded" for an empty string.
    assert.equal(coverageWindow([]), "");
    assert.equal(coverageWindow([null, undefined, "", "last month", "08/21/2026"]), "");
  });

  it("drops unparseable entries instead of letting one poison the window", () => {
    assert.equal(coverageWindow(["2026-08-11", "not a date", "2026-08-20"]), "2026-08-11 to 2026-08-20");
  });

  it("trims surrounding whitespace, which the stored corpus does contain", () => {
    assert.equal(coverageWindow([" 2026-08-11 ", "2026-08-20"]), "2026-08-11 to 2026-08-20");
  });
});

// Moved verbatim from check-coverage-window.mjs's --selftest when the predicate moved here (B-043).
describe("coverageMisstatement", () => {
  it("reads the live Wertheim string as BACKWARD", () => {
    assert.equal(coverageMisstatement("2026-08-20 to 2026-08-18", ["2026-08-18", "2026-08-20"]), "BACKWARD");
  });
  it("calls a window narrower than its own articles UNDERSTATED", () => {
    assert.equal(coverageMisstatement("2026-08-19 to 2026-08-20", ["2026-08-01", "2026-08-20"]), "UNDERSTATED");
  });
  it("calls one date presented as a range over a real span DEGENERATE", () => {
    assert.equal(coverageMisstatement("2026-08-20 to 2026-08-20", ["2026-08-01", "2026-08-20"]), "DEGENERATE");
  });
  it("NEGATIVE CONTROLS: silent where there is no second endpoint or nothing is wrong", () => {
    assert.equal(coverageMisstatement("2026-08-18 to 2026-08-20", ["2026-08-18", "2026-08-20"]), null);
    assert.equal(coverageMisstatement("2026-08-20 to 2026-08-20", ["2026-08-20"]), null);
    assert.equal(coverageMisstatement("", ["2026-08-01", "2026-08-20"]), null);
    assert.equal(coverageMisstatement("last month", ["2026-08-01", "2026-08-20"]), null);
    assert.equal(coverageMisstatement("2026-08-20 to 2026-08-20", ["2026-08-20", "2026-08-20"]), null);
  });
});

describe("planCoverageWindowFix (B-043 recompute)", () => {
  it("rewrites a BACKWARD window to the articles' own ascending span", () => {
    const plan = planCoverageWindowFix({
      dateRange: "2026-08-20 to 2026-08-11",
      articles: [{ date: "2026-08-20" }, { date: "2026-08-15" }, { date: "2026-08-11" }],
    });
    assert.deepEqual(plan, { kind: "BACKWARD", before: "2026-08-20 to 2026-08-11", after: "2026-08-11 to 2026-08-20" });
  });
  it("widens an UNDERSTATED window to the full span (the Bill Gates shape)", () => {
    const plan = planCoverageWindowFix({
      dateRange: "2026-08-19 to 2026-08-20",
      articles: [{ date: "2026-08-19" }, { date: "2020-09-02" }, { date: "2026-08-21" }, { date: "2026-08-20" }],
    });
    assert.equal(plan?.after, "2020-09-02 to 2026-08-21");
  });
  it("its output is never itself misstated, so a second run plans nothing", () => {
    const fact = { dateRange: "2026-08-20 to 2026-08-20", articles: [{ date: "2026-08-01" }, { date: "2026-08-20" }] };
    const plan = planCoverageWindowFix(fact);
    assert.ok(plan);
    assert.equal(planCoverageWindowFix({ ...fact, dateRange: plan.after }), null);
  });
  it("NEGATIVE CONTROLS: never plans a write for a correct, unjudgeable or non-object fact", () => {
    assert.equal(planCoverageWindowFix({ dateRange: "2026-08-11 to 2026-08-20", articles: [{ date: "2026-08-11" }, { date: "2026-08-20" }] }), null);
    assert.equal(planCoverageWindowFix({ dateRange: "2026-08-20 to 2026-08-11", articles: [{ date: "2026-08-20" }] }), null);
    assert.equal(planCoverageWindowFix("{\"dateRange\":\"2026-08-20 to 2026-08-11\"}"), null);
    assert.equal(planCoverageWindowFix(null), null);
    assert.equal(planCoverageWindowFix([]), null);
  });
});
