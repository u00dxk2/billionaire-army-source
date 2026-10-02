import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affiliationsFrom,
  distinctiveTokens,
  employerVerdict,
  isGenericEmployer,
  surnameOf,
} from "./fec-employer-affiliation";

// Adam Forste's stored sec_filings companies, verbatim from prod (2026-09-28).
const FORSTE = [
  "Lineage Growth Properties, Inc.  (LINE)",
  "BG Lineage Holdings, LLC",
  "Marchetti Kevin Patrick",
  "BG Cold, LLC",
  "Bay Grove Capital Group LLC",
];

test("positive control: a true donor's two different employers BOTH read affiliated", () => {
  assert.equal(employerVerdict("BAY GROVE", FORSTE, "Adam Forste"), "affiliated");
  assert.equal(employerVerdict("LINEAGE", FORSTE, "Adam Forste"), "affiliated");
});

test("a specific employer outside the list reads unaffiliated — the only verdict that counts against a record", () => {
  assert.equal(employerVerdict("KAISER PERMANENTE", FORSTE, "Adam Forste"), "unaffiliated");
});

test("RETIRED / SELF-EMPLOYED / INVESTOR / NOT EMPLOYED / blank are NOT JUDGED, never a miss", () => {
  for (const e of ["RETIRED", "Self-Employed", "INVESTOR", "NOT EMPLOYED", "", null, "N/A", "INFORMATION REQUESTED"]) {
    assert.equal(employerVerdict(e, FORSTE, "Adam Forste"), "generic", String(e));
  }
});

test("a person with no affiliation list is NOT JUDGED, even for a specific employer", () => {
  assert.equal(employerVerdict("KAISER PERMANENTE", [], "Charles Butt"), "no-list");
});

test("corporate-form words alone never match: 'XYZ CAPITAL GROUP LLC' does not ride on Bay Grove Capital Group", () => {
  assert.equal(employerVerdict("XYZ CAPITAL GROUP LLC", FORSTE, "Adam Forste"), "unaffiliated");
});

test("surname in the employer is its own verdict, and the person's name in the list cannot create it", () => {
  assert.equal(employerVerdict("BECHTEL CORP", ["Some Other Co"], "Riley P. Bechtel"), "surname");
  // A list entry carrying the surname ("Forste Holdings") must not turn the surname into a company
  // token: stripped, the list is empty, so the record is NOT JUDGED rather than "affiliated".
  assert.equal(employerVerdict("FORSTE LAW OFFICE", ["Forste Holdings"], "Adam Forste"), "no-list");
  // With other list tokens present, a surname-only hit stays "surname", never "affiliated".
  assert.equal(employerVerdict("FORSTE LAW OFFICE", ["Forste Adam Matthew", "Bay Grove"], "Adam Matthew Forste"), "surname");
});

test("distinctiveTokens drops ticker suffixes, short tokens and filler", () => {
  assert.deepEqual(distinctiveTokens("Lineage Growth Properties, Inc.  (LINE)"), ["LINEAGE", "GROWTH"]);
  assert.equal(isGenericEmployer("self employed"), true);
  assert.equal(isGenericEmployer("BAY GROVE"), false);
});

test("affiliationsFrom names each source it used; description contributes only its 'of …' tail", () => {
  const r = affiliationsFrom({
    secCompanies: [{ name: "Block, Inc.  (SQ, BSQKZ)" }],
    description: "American computer scientist, entrepreneur and co-founder of Twitter",
  });
  assert.deepEqual(r.sources, ["sec_filings", "description"]);
  assert.equal(employerVerdict("TWITTER", r.list, "Jack Dorsey"), "affiliated");
  // KNOWN CEILING, pinned: a renamed company (Square → Block) is invisible to token overlap, so a
  // TRUE record reads unaffiliated. This is why no rule may drop on "unaffiliated" alone.
  assert.equal(employerVerdict("SQUARE INC", r.list, "Jack Dorsey"), "unaffiliated");
  assert.deepEqual(affiliationsFrom({ description: "American grocer" }), { list: [], sources: [] });
});

test("REGRESSION (Codex 2026-09-28): the person's FIRST or MIDDLE name never establishes affiliation", () => {
  const list = ["Forste Adam Matthew", "Bay Grove Capital Group LLC"];
  assert.notEqual(employerVerdict("ADAM FORSTE", list, "Adam Matthew Forste"), "affiliated");
  assert.equal(employerVerdict("MATTHEW CONSULTING", list, "Adam Matthew Forste"), "unaffiliated");
});

test("REGRESSION (Codex 2026-09-28): every listed generic employer, punctuated or not, is NOT JUDGED", () => {
  for (const e of ["SELF EMPLOYED/INVESTOR", "SELF-EMPLOYED / INVESTOR", "Information Requested Per Best Efforts", "N.A.", "not-employed", "Home-maker"]) {
    assert.equal(employerVerdict(e, FORSTE, "Adam Forste"), "generic", e);
  }
});

test("wikidata firm labels join the list as their own source; an unlabeled Q-id is not a firm name", () => {
  const r = affiliationsFrom({ wikidataFirms: ["Tiger Global Management", "Q12345"], secCompanies: [{ name: "CARVANA CO.  (CVNA)" }] });
  assert.deepEqual(r.sources, ["wikidata", "sec_filings"]);
  assert.equal(r.list.includes("Q12345"), false);
  assert.equal(employerVerdict("TIGER GLOBAL MANAGEMENT, LLC", r.list, "Scott Shleifer"), "affiliated");
});

test("surnameOf skips a generational suffix", () => {
  assert.equal(surnameOf("Riley P. Bechtel"), "Bechtel");
  assert.equal(surnameOf("Robert Kraft Jr."), "Kraft");
});
