import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { isFecRecordImpossible, isImplausibleBirthYear, windowTwoDigitYear, withholdPoliticalProse, MIN_CONTRIBUTOR_AGE } from "./fec-attribution";

const NOW = new Date("2026-08-30T00:00:00Z");

describe("isFecRecordImpossible", () => {
  it("flags the live case that found B-037", () => {
    // Adam Forste: born 1978, record opens 1979-07-23. A one-year-old did not contribute.
    assert.equal(isFecRecordImpossible("1979-07-23 to 2025-09-04", 1978, NOW), true);
  });

  it("does NOT flag an ordinary record — the control that it discriminates", () => {
    // Without this the function could return true always and the first test would still pass.
    assert.equal(isFecRecordImpossible("2011-09-30 to 2024-10-30", 1970, NOW), false);
    assert.equal(isFecRecordImpossible("1995-04-21 to 2024-08-01", 1953, NOW), false);
  });

  it("shows the section whenever it cannot tell — doubt does NOT hide here", () => {
    // Inverted from this repo's usual drop-on-doubt rule ON PURPOSE: a true output HIDES a real
    // person's real record, so an uncertain input must render.
    assert.equal(isFecRecordImpossible("1979-07-23 to 2025-09-04", null, NOW), false);
    assert.equal(isFecRecordImpossible("1979-07-23 to 2025-09-04", undefined, NOW), false);
    assert.equal(isFecRecordImpossible(null, 1978, NOW), false);
    assert.equal(isFecRecordImpossible("", 1978, NOW), false);
    assert.equal(isFecRecordImpossible("not a range", 1978, NOW), false);
  });

  it("refuses a junk birth year rather than reading it as an FEC verdict", () => {
    // 5 of the first 16 prod hits had birth years of 2027 / 2028 / 2028 / 2000 against 1980s-90s
    // contributions. That is a broken `persons.birth_year`, a DIFFERENT defect, and letting it
    // hide the political section would hide the wrong page for the wrong reason.
    assert.equal(isFecRecordImpossible("1980-01-01 to 2020-01-01", 2027, NOW), false);
    assert.equal(isFecRecordImpossible("2007-01-01 to 2020-01-01", 2028, NOW), false);
    assert.equal(isFecRecordImpossible("1992-01-01 to 2020-01-01", 1700, NOW), false);
  });

  it("refuses a birth year that makes the person a MINOR TODAY, not just a future one", () => {
    // The future-year test alone was too narrow and it WITHHELD A TRUE RECORD on prod: George
    // Joseph's stored birth_year is 2021 (really 1921), which is not in the future but makes him 5.
    // A 5-year-old is not an indexed billionaire, so that row is broken rather than probative.
    // NOW is 2026, so anything after 2008 is a minor today.
    assert.equal(isFecRecordImpossible("2025-01-01 to 2025-06-01", 2021, NOW), false);
    assert.equal(isFecRecordImpossible("2010-01-01 to 2020-01-01", 2009, NOW), false);
    // …and the year that makes them EXACTLY 18 today is still usable evidence.
    assert.equal(isFecRecordImpossible("2010-01-01 to 2020-01-01", 2008, NOW), true);
  });

  it("refuses a junk contribution year too", () => {
    assert.equal(isFecRecordImpossible("1799-01-01 to 2020-01-01", 1950, NOW), false);
    assert.equal(isFecRecordImpossible("3025-01-01 to 3030-01-01", 1950, NOW), false);
  });

  it("puts the boundary exactly at the legal age, in both directions", () => {
    // Born 1980 → turns 18 in 1998. The comparison is on YEARS, so 1998 is the first shown year.
    assert.equal(isFecRecordImpossible("1998-01-01 to 2020-01-01", 1980, NOW), false); // exactly 18 → shown
    assert.equal(isFecRecordImpossible("1999-01-01 to 2020-01-01", 1980, NOW), false); // 19 → shown
    assert.equal(isFecRecordImpossible("1997-01-01 to 2020-01-01", 1980, NOW), true);  // 17 → hidden
    assert.equal(isFecRecordImpossible("1996-01-01 to 2020-01-01", 1980, NOW), true);  // 16 → hidden
    assert.equal(MIN_CONTRIBUTOR_AGE, 18);
  });
});

// ---------------------------------------------------------------------------
// isImplausibleBirthYear — extracted 2026-09-04 so B-039's population checker
// (`scripts/check-birth-years.mjs`) reads the SAME rule the render refuses on,
// rather than the second copy that has already cost this repo a wrong number
// once (`fd83f65`: 16 reported where the page withheld 13).
// ---------------------------------------------------------------------------

const AT = new Date("2026-09-04T00:00:00Z");

test("isImplausibleBirthYear: absent or non-finite is implausible, not innocent", () => {
  assert.equal(isImplausibleBirthYear(null, AT), true);
  assert.equal(isImplausibleBirthYear(undefined, AT), true);
  assert.equal(isImplausibleBirthYear(Number.NaN, AT), true);
});

test("isImplausibleBirthYear: the four live prod shapes, by year", () => {
  // Future years and transposed ones alike — all four were real rows on 2026-09-04.
  assert.equal(isImplausibleBirthYear(2028, AT), true); // Alan Gerry, Sidney Kimmel
  assert.equal(isImplausibleBirthYear(2027, AT), true); // Wilma Tisch
  assert.equal(isImplausibleBirthYear(2024, AT), true); // Gloria Joseph
  assert.equal(isImplausibleBirthYear(2021, AT), true); // George Joseph, really 1921
  assert.equal(isImplausibleBirthYear(1849, AT), true);
  assert.equal(isImplausibleBirthYear(1850, AT), false);
  assert.equal(isImplausibleBirthYear(1930, AT), false);
});

test("isImplausibleBirthYear: the boundary is MINOR TODAY, not the current year", () => {
  // 2008 makes an 18-year-old in 2026 — usable. 2009 makes a 17-year-old — refused.
  assert.equal(isImplausibleBirthYear(2008, AT), false);
  assert.equal(isImplausibleBirthYear(2009, AT), true);
});

test("the extraction did not change isFecRecordImpossible — one rule, both callers", () => {
  // Every year the predicate refuses must make the FEC test return FALSE (show it), whatever the
  // date range says. This is the de-fork assertion: if someone re-inlines a narrower junk check
  // inside isFecRecordImpossible, these two stop agreeing and this test is what says so.
  for (const year of [null, undefined, Number.NaN, 2028, 2027, 2024, 2021, 2009, 1849]) {
    assert.equal(isImplausibleBirthYear(year as number | null | undefined, AT), true);
    assert.equal(isFecRecordImpossible("1980-01-01 to 2024-01-01", year as number | null | undefined, AT), false);
  }
  // And a usable year still adjudicates normally in both directions.
  assert.equal(isImplausibleBirthYear(1970, AT), false);
  assert.equal(isFecRecordImpossible("1980-01-01 to 2024-01-01", 1970, AT), true);
  assert.equal(isFecRecordImpossible("1990-01-01 to 2024-01-01", 1970, AT), false);
});

test("windowTwoDigitYear: the five live century shifts it was written for", () => {
  // Each is the two-digit year RTB serves, and the year the person was actually born.
  assert.equal(windowTwoDigitYear(28, AT), 1928); // Sidney Kimmel, Alan Gerry — stored 2028
  assert.equal(windowTwoDigitYear(27, AT), 1927); // Wilma Tisch — stored 2027
  assert.equal(windowTwoDigitYear(24, AT), 1924); // Gloria Joseph — stored 2024
  assert.equal(windowTwoDigitYear(21, AT), 1921); // George Joseph — stored 2021
});

test("windowTwoDigitYear: the ordinary window is untouched", () => {
  assert.equal(windowTwoDigitYear(71, AT), 1971);
  assert.equal(windowTwoDigitYear(31, AT), 1931);
  assert.equal(windowTwoDigitYear(99, AT), 1999);
});

test("windowTwoDigitYear: a 2000s year that is actually possible stays in the 2000s", () => {
  // Someone born in 2005 is 21 in 2026 — young for this index, but not impossible, and correcting
  // them to 1905 would invent a 121-year-old. The predicate is the boundary, not a hunch.
  assert.equal(windowTwoDigitYear(5, AT), 2005);
  assert.equal(windowTwoDigitYear(8, AT), 2008);
  // 2009 makes a 17-year-old — refused, so it is read as 1909.
  assert.equal(windowTwoDigitYear(9, AT), 1909);
});

test("windowTwoDigitYear: the correction never lands outside the window it came from", () => {
  // Every possible two-digit input maps to a year that the predicate accepts.
  for (let y = 0; y <= 99; y++) {
    const out = windowTwoDigitYear(y, AT);
    assert.equal(isImplausibleBirthYear(out, AT), false, `two-digit ${y} produced ${out}`);
  }
});

// ---------------------------------------------------------------------------
// withholdPoliticalProse — B-037's PROSE leg.
//
// Every input below is one an adversarial round actually BROKE a previous design on. They are
// kept even though the current design makes most of them trivially safe: they are the record of
// why it is blunt, and they are what goes red if anyone re-introduces partial removal.
// ---------------------------------------------------------------------------
describe("withholdPoliticalProse", () => {
  // The literal served summary of card ac844ce9, read from prod 2026-09-10.
  const WERTHEIM =
    "Investor and Ferrari collector Herbert Wertheim bought Ferrari's one-off Luce EV, known as " +
    "Chassis 0, for $40 million at auction; Ferrari said the proceeds would support education " +
    "projects through its foundation. Wertheim, an estimated $3.8 billion billionaire, also " +
    "bought a one-off Ferrari Daytona SP3 for $26 million the prior year; available records " +
    "list $1.8 million in political donations.";

  it("THE LIVE CARD — the summary is withheld whole", () => {
    assert.equal(withholdPoliticalProse(WERTHEIM), "");
  });

  it("matches the CHIP form as well as the spelled-out one", () => {
    assert.equal(withholdPoliticalProse("He is worth $3.8B. Records list $1.8M in political donations."), "");
    assert.equal(withholdPoliticalProse("Records list $1.8 million in federal political contributions."), "");
    assert.equal(withholdPoliticalProse("He made $2,500 in political giving."), "");
  });

  // --- the nine reproduced defects, every one now structurally impossible -------------------
  const ADVERSARIAL_REPRODUCTIONS: Array<[string, string]> = [
    ["R1 thousands separator became $50", "She donated $50,000 to charity and gave $1.8 million in political donations."],
    ["R1 only the first claim removed", "Records list $1.8 million in political donations. He gave $2 million in political contributions."],
    ["R1 decimal read as a sentence end", "He gave $1.8 million in political donations and $2.5 million to charity. He supports schools."],
    ["R1 dangling verb before the period", "He bought a $26 million car and gave $1.8 million in political donations."],
    ["R2 qualifier re-attached to the wrong figure", "She donated $50,000 to charity and gave $1.8 million in political donations, mostly to Republicans."],
    ["R2 unpunctuated ending split the decimal", "He gave $1.8 million in political donations"],
    ["R2 abbreviation read as a cut point", "He met a U.S. donor who gave $1.8 million in political donations."],
    ["R3 dependent FOLLOWING sentence re-attached", "He donated $50,000 to charity. Records list $1.8 million in political donations. Most of that money went to Republicans."],
    ["R3 'Sen.' and 'i.e.' split the spans", "He is an investor. He met Sen. Smith, who gave $1.8 million in political donations, i.e. mostly to Republicans."],
    ["R4 intervening modifier", "Records list $1.8 million in total political donations."],
    ["R4 reversed word order", "His political donations total $1.8 million."],
    ["R4 modifier chain", "He made $1.8 million in reported federal political contributions."],
    ["R4 'of' instead of 'in'", "A total of $1.8 million of political spending is on record."],
    ["R5 non-adjacent noun phrase", "Records list $1.8 million in political campaign contributions."],
    ["R5 long attribution phrase before the amount", "His political donations, according to available federal records, total $1.8 million."],
    ["R5 campaign contributions without the word political", "He made $1.8 million in campaign contributions."],
    ["R6 abbreviation inside the gap", "He made $1.8 million in U.S. political donations."],
    ["R6 recipient-last word order", "He gave $1.8 million in donations to political campaigns."],
    ["R6 recipient-last, candidates", "He gave $1.8 million in contributions to federal candidates."],
  ];

  for (const [label, input] of ADVERSARIAL_REPRODUCTIONS) {
    it(`withholds everything — ${label}`, () => {
      const out = withholdPoliticalProse(input);
      assert.equal(out, "", `must withhold the whole summary, got: ${JSON.stringify(out)}`);
    });
  }

  // --- the other direction: untouched text must come back UNTOUCHED ------------------------
  it("leaves a CHARITABLE giving figure alone — only political claims are withheld", () => {
    const s = "She has given $50 million in charitable donations through her foundation.";
    assert.equal(withholdPoliticalProse(s), s);
  });

  it("BYTE-IDENTICAL on text with nothing to withhold, exotic whitespace included", () => {
    // R3 caught the previous design normalising a non-breaking space and a double space INSIDE
    // sentences it was not even editing. Nothing is reassembled now, so this is exact.
    const nbsp = "She gave $50,000\u00a0to charity.  She  funds schools.\tShe is an investor.";
    assert.equal(withholdPoliticalProse(nbsp), nbsp);
    const s = "Jane Doe is worth $3.8 billion and bought a $26 million car for $1.8 million profit.";
    assert.equal(withholdPoliticalProse(s), s);
    const t = "Herbert Wertheim bought a Ferrari. He is a U.S. optometrist worth $3.0B.";
    assert.equal(withholdPoliticalProse(t), t);
  });

  it("the WIDER matcher does not start eating charitable or unrelated figures", () => {
    // Round 4 widened this in both word orders; these are the controls that keep it honest.
    for (const s of [
      "She has given $50 million in total charitable donations through her foundation.",
      "His charitable donations total $50 million.",
      "His political views are well known. He gave $50 million to charity.",
      "He is worth $3.8 billion in total.",
      "The foundation reported $9.7 million in total grants paid.",
    ]) {
      assert.equal(withholdPoliticalProse(s), s, `must not withhold: ${s}`);
    }
  });

  it("ACCEPTED FALSE POSITIVES — pinned so they are a decision, not a surprise", () => {
    // A sentence that MENTIONS political donations without asserting a figure, carrying an
    // unrelated amount, is withheld. Telling it apart needs to parse which amount is attributed
    // to what — the analysis whose failures filled five adversarial rounds. The cost is a
    // paragraph on a card belonging to one of the ~12 already-withheld people; the cost of the
    // other error is a false political claim about a named living person. Not comparable.
    assert.equal(withholdPoliticalProse("His political donations are unknown, but he gave $50 million to charity."), "");
    assert.equal(withholdPoliticalProse("His political donations are unknown, and his net worth is $3.8 billion."), "");
  });

  it("a SEPARATE sentence about charity is not swept in — the gap stops at a sentence end", () => {
    // The tempered gap is what keeps the false-positive set as small as it is.
    const s = "His political views are well known. He gave $50 million to charity.";
    assert.equal(withholdPoliticalProse(s), s);
  });

  it("a political mention with NO figure is not a claim — nothing is withheld", () => {
    // The withhold is about an unsupported NUMBER, not about the topic.
    const s = "He is politically active and has supported Republican candidates.";
    assert.equal(withholdPoliticalProse(s), s);
  });

  it("handles empty and non-string input", () => {
    assert.equal(withholdPoliticalProse(""), "");
    assert.equal(withholdPoliticalProse(null as unknown as string), null);
  });
});
