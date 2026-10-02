import { test } from "node:test";
import assert from "node:assert/strict";
import { birthYearFromWikidata, resolveBirthYear } from "./wikidata-birth-year";

test("several statements: a century one beside a precise one yields the precise year, in EITHER order", () => {
  const century = { timeValue: "2000-01-01T00:00:00Z", precision: "7" };
  const precise = { timeValue: "1939-01-01T00:00:00Z", precision: "9" };
  assert.equal(resolveBirthYear([century, precise]), 1939);
  assert.equal(resolveBirthYear([precise, century]), 1939);
});

test("several statements that DISAGREE on the year are unknown, not whichever row came first", () => {
  const a = { timeValue: "1956-03-01T00:00:00Z", precision: "11" };
  const b = { timeValue: "1957-03-01T00:00:00Z", precision: "11" };
  assert.equal(resolveBirthYear([a, b]), null);
  assert.equal(resolveBirthYear([b, a]), null);
});

test("agreeing statements and duplicate rows resolve to the one year; none usable is null", () => {
  const d = { timeValue: "1964-01-12T00:00:00Z", precision: "11" };
  assert.equal(resolveBirthYear([d, d, { timeValue: "1964-01-01T00:00:00Z", precision: 9 }]), 1964);
  assert.equal(resolveBirthYear([{ timeValue: "2000-01-01T00:00:00Z", precision: "7" }]), null);
  assert.equal(resolveBirthYear([]), null);
});

test("a CENTURY-precision date is not a year — Herbert Wertheim's live P569 (Q5735877)", () => {
  // Read from Wikidata 2026-09-26: +2000-00-00T00:00:00Z, precision 7. Stored as 2000 before this.
  assert.equal(birthYearFromWikidata("+2000-00-00T00:00:00Z", 7), null);
  assert.equal(birthYearFromWikidata("2000-01-01T00:00:00Z", "7"), null);
});

test("decade and millennium precision are not a year either", () => {
  assert.equal(birthYearFromWikidata("1950-01-01T00:00:00Z", 8), null);
  assert.equal(birthYearFromWikidata("2000-01-01T00:00:00Z", 6), null);
});

test("year, month and day precision return the year — the ordinary case must still work", () => {
  assert.equal(birthYearFromWikidata("1939-01-01T00:00:00Z", 9), 1939);
  assert.equal(birthYearFromWikidata("1964-07-01T00:00:00Z", 10), 1964);
  assert.equal(birthYearFromWikidata("+1930-08-30T00:00:00Z", "11"), 1930);
});

test("a MISSING or junk precision is unknown, never trusted", () => {
  assert.equal(birthYearFromWikidata("1939-01-01T00:00:00Z", undefined), null);
  assert.equal(birthYearFromWikidata("1939-01-01T00:00:00Z", null), null);
  assert.equal(birthYearFromWikidata("1939-01-01T00:00:00Z", "year"), null);
});

test("no date, or an unparseable one, is null", () => {
  assert.equal(birthYearFromWikidata(undefined, 11), null);
  assert.equal(birthYearFromWikidata("", 11), null);
  assert.equal(birthYearFromWikidata("-0044-03-15T00:00:00Z", 11), null);
});
