import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPoliticalProseOutdated } from "./political-prose-staleness";

// Phil Ruffin, prod 2026-09-13: summary written before the 2026-09-12 FEC refresh.
const WRITTEN = "2026-08-30T18:00:00.000Z";
const REFRESHED = "2026-09-12T22:10:00.000Z";

describe("isPoliticalProseOutdated", () => {
  test("POSITIVE: the record was refreshed after the prose was written", () => {
    assert.equal(isPoliticalProseOutdated(WRITTEN, REFRESHED), true);
  });

  test("NEGATIVE: a summary written after the refresh describes the current record", () => {
    assert.equal(isPoliticalProseOutdated(REFRESHED, WRITTEN), false);
  });

  test("the same instant is not newer — a caveat needs an actual gap", () => {
    assert.equal(isPoliticalProseOutdated(REFRESHED, REFRESHED), false);
  });

  test("an undatable side never claims staleness", () => {
    assert.equal(isPoliticalProseOutdated(undefined, REFRESHED), false);
    assert.equal(isPoliticalProseOutdated(WRITTEN, undefined), false);
    assert.equal(isPoliticalProseOutdated("not a date", REFRESHED), false);
    assert.equal(isPoliticalProseOutdated(WRITTEN, "not a date"), false);
    assert.equal(isPoliticalProseOutdated(null, null), false);
  });

  test("it reads ONLY dates — no prose argument exists to misread", () => {
    // The counterexamples that killed the figure-matching version (recipient-only prose, a grouped
    // COUNT read as money, "$1 million" read as 1) cannot arise: the prose is not an input.
    assert.equal(isPoliticalProseOutdated.length, 2);
  });
});
