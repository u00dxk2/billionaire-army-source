import { test } from "node:test";
import assert from "node:assert/strict";
import { isCandidatePair, isShortFormOf, isShortFormPair, classify } from "./person-match";

/**
 * B-033. The ten duplicate pairs measured on prod 2026-08-19 — 1,103 rows served by
 * /api/persons, 13 same-surname short-form pairs, 2 discarded as "& family" artefacts, 10
 * confirmed by an identical birth year. Names and birth years are copied from the live rows.
 *
 * Every one of these was INVISIBLE to both the seeder guard and dedupe:persons before this
 * change, because the candidate test demanded an exact first-token match.
 */
const PROD_DUPLICATES: Array<[string, string, number]> = [
  ["Stan Kroenke", "Stanley Kroenke", 1947],
  ["Dan Gilbert", "Daniel Gilbert", 1962],
  ["Dan Snyder", "Daniel Snyder", 1964],
  ["Josh Kushner", "Joshua Kushner", 1985],
  ["Ken Griffin", "Kenneth C. Griffin", 1968],
  ["Ken Langone", "Kenneth Langone", 1935],
  ["Steve Cohen", "Steven A. Cohen", 1956],
  ["Rob Sands", "Robert Sands", 1958],
  ["Ron Baron", "Ronald S. Baron", 1943],
  ["Vlad Tenev", "Vladimir Tenev", 1987],
];

for (const [a, b, year] of PROD_DUPLICATES) {
  test(`MERGE: ${a} / ${b} (both ${year}) — a real duplicate on prod`, () => {
    assert.equal(isCandidatePair(a, b), true, "not even a candidate pair");
    assert.equal(
      classify({ name: a, birthYear: year }, { name: b, birthYear: year }),
      "MERGE",
    );
  });
}

/**
 * THE COUNTEREXAMPLE, and the reason the birth-year gate is not optional. Josh Harris
 * (1964, Q6289885) and Joshua Harris (1960, Q6288962) are two different men with two
 * different Wikidata entries. They are a candidate pair on names alone — a rule that stopped
 * at name shape would merge them and destroy a correct row.
 *
 * Sixth confirmation of B-021: do not tune a name rule by reasoning about name shapes.
 */
test("EXCLUDE: Josh Harris 1964 / Joshua Harris 1960 are DIFFERENT PEOPLE", () => {
  assert.equal(isCandidatePair("Josh Harris", "Joshua Harris"), true, "should still be a candidate");
  assert.equal(isShortFormPair("Josh Harris", "Joshua Harris"), true);
  assert.equal(
    classify({ name: "Josh Harris", birthYear: 1964 }, { name: "Joshua Harris", birthYear: 1960 }),
    "EXCLUDE",
    "a 4-year gap is NOT close enough for a short-form pair",
  );
});

test("EXCLUDE: a short-form pair with ANY missing birth year — no evidence is not weak evidence", () => {
  assert.equal(
    classify({ name: "Josh Kushner", birthYear: null }, { name: "Joshua Kushner", birthYear: 1985 }),
    "EXCLUDE",
  );
  assert.equal(
    classify({ name: "Josh Kushner", birthYear: null }, { name: "Joshua Kushner", birthYear: null }),
    "EXCLUDE",
  );
});

test("EXCLUDE: even a ONE-year gap on a short-form pair", () => {
  // The gate is equality, not proximity. A short-form pair carries no other evidence, so
  // "nearly the same age" is exactly the reasoning that merges a father and son.
  assert.equal(
    classify({ name: "Rob Sands", birthYear: 1958 }, { name: "Robert Sands", birthYear: 1959 }),
    "EXCLUDE",
  );
});

test("an EXACT first-name pair is unaffected by the new gate", () => {
  // Same-name pairs never took the short-form route, so a missing birth year still merges
  // exactly as it did before — this change must not tighten the path it did not touch.
  assert.equal(
    classify({ name: "Melinda Gates", birthYear: null }, { name: "Melinda Gates", birthYear: null }),
    "MERGE",
  );
});

test("father/son protection still holds and is not weakened", () => {
  assert.equal(
    classify(
      { name: "Ernest Garcia II", birthYear: 1957 },
      { name: "Ernest Garcia III", birthYear: 1985 },
    ),
    "EXCLUDE",
  );
  assert.equal(
    classify({ name: "Ross Perot", birthYear: 1930 }, { name: "Ross Perot, Jr.", birthYear: 1958 }),
    "EXCLUDE",
  );
});

test("isShortFormOf: prefix route — minimum 3 chars, never equal strings", () => {
  assert.equal(isShortFormOf("josh", "joshua"), true);
  assert.equal(isShortFormOf("joshua", "josh"), true, "order must not matter");
  assert.equal(isShortFormOf("vlad", "vladimir"), true);
  assert.equal(isShortFormOf("josh", "josh"), false, "identical is not a short form");
  // Too short to be evidence of anything.
  assert.equal(isShortFormOf("jo", "john"), false);
  // A prefix that is a different name entirely still only becomes a merge with equal birth
  // years, which is what stops this being dangerous.
  assert.equal(isShortFormOf("ann", "anna"), true);
});

// These four assertions were the OPPOSITE way round until 2026-08-23, on the reasoning that
// bill/william and bob/robert "do not appear in the index." Scanning the live index refuted
// it: Bill Ackman AND William Ackman are both present, same birth year 1966, along with
// James/Jim Kennedy, James/Jim Coulter, Richard B./Rick Cohen and Ted/Theodore Leonsis.
// A test asserting a false thing is worse than no test — it makes the gap look considered.
test("isShortFormOf: substitution route — the non-prefix nicknames really in this index", () => {
  assert.equal(isShortFormOf("bill", "william"), true);
  assert.equal(isShortFormOf("william", "bill"), true, "order must not matter");
  assert.equal(isShortFormOf("bob", "robert"), true);
  assert.equal(isShortFormOf("jim", "james"), true);
  assert.equal(isShortFormOf("ted", "theodore"), true);
  assert.equal(isShortFormOf("rick", "richard"), true);
  // Unrelated names are still unrelated — the table is a lookup, not a fuzzy match.
  assert.equal(isShortFormOf("bill", "robert"), false);
  assert.equal(isShortFormOf("ted", "james"), false);
});

// The live pairs this change exists for. Candidacy only — every one of them still has to
// clear the EXACT birth-year gate in classify() to become a merge, which is the next test.
test("the five index pairs the prefix rule could not reach are now candidates", () => {
  assert.equal(isCandidatePair("Bill Ackman", "William Ackman"), true);
  assert.equal(isCandidatePair("James C. Kennedy", "Jim Kennedy"), true);
  assert.equal(isCandidatePair("James Coulter", "Jim Coulter"), true);
  assert.equal(isCandidatePair("Richard B. Cohen", "Rick Cohen & family"), true);
  assert.equal(isCandidatePair("Ted Leonsis", "Theodore Leonsis"), true);
});

test("widening candidacy did NOT widen the merge verdict — the birth-year gate still rules", () => {
  // Four of the five agree exactly, which is the whole of the evidence that they are one man.
  assert.equal(
    classify({ name: "Bill Ackman", birthYear: 1966 }, { name: "William Ackman", birthYear: 1966 }),
    "MERGE"
  );
  // Leonsis disagrees by one year, so it stays EXCLUDE and routes to human review — exactly
  // as a one-year gap does on the prefix route. A substitution nickname is not stronger
  // evidence than a truncation; it is the same weak evidence reached a different way.
  assert.equal(
    classify({ name: "Ted Leonsis", birthYear: 1957 }, { name: "Theodore Leonsis", birthYear: 1956 }),
    "EXCLUDE"
  );
  // And the table cannot merge two different men who happen to share a surname and a year
  // without ALSO matching a nickname entry.
  assert.equal(isCandidatePair("Bill Ackman", "Robert Ackman"), false);
});

test("a shared surname alone is still not a pair", () => {
  assert.equal(isCandidatePair("Josh Kushner", "Jared Kushner"), false);
  assert.equal(isCandidatePair("Kushner", "Joshua Kushner"), false);
});

test("different surnames are never a pair, however similar the first names", () => {
  assert.equal(isCandidatePair("Dan Gilbert", "Daniel Snyder"), false);
  // The two "& family" rows that a naive surname split mis-paired on 2026-08-19.
  assert.equal(isCandidatePair("Rob Walton & family", "Robert Steers & family"), false);
});
