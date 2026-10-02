import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlausiblyOwnFoundation } from "./foundation-attribution";
import { foundationSearchSurname } from "./name-utils";

// Every REJECT case below was read from production on 2026-08-01 (B-020) — each
// one was live, credited to that person, and feeding their PBS philanthropy
// score. Do not relax a rule without checking these still drop.

test("B-020 — rejects the wrong attachments that were live in prod", () => {
  const live: [string, string][] = [
    ["Kaiser Foundation Hospitals", "George Kaiser"], // $30,650,696,643 — Kaiser Permanente
    ["Ford Foundation", "Tom Ford"], //                  $918,133,779 — a fashion designer
    ["Ford Foundation", "Gerald Ford"], //                same money, second wrong person
    ["James Irvine Foundation", "Hamilton E. James"], // $203,756,889
    ["James Irvine Foundation", "Thomas James"],
    ["James Irvine Foundation", "LeBron James"],
    ["Birthright Israel Foundation", "Ryan Israel"], //  $92,850,953
    ["W K Kellogg Foundation", "Peter Kellogg"], //      $388,373,728
    ["Knight Foundation", "Phil Knight"], //             $191M — John S. & James L. Knight
    ["Howard G Buffett Foundation", "Warren Buffett"], //$503M — his son's
    ["Foundation For Rocky Ford Schools", "Tom Ford"],
    ["Kellogg Community College Foundation", "Peter Kellogg"],
  ];
  for (const [org, person] of live) {
    assert.equal(isPlausiblyOwnFoundation(org, person), false, `should reject: ${org} <- ${person}`);
  }
});

test("B-020 — keeps the genuine personal foundations", () => {
  const genuine: [string, string][] = [
    ["Blavatnik Family Foundation", "Len Blavatnik"], // B-011's example — always was correct
    ["Gates Foundation", "Bill Gates"], //               no first name, still correct
    ["Gates Foundation Trust", "Melinda French Gates"],
    ["Bloomberg Family Foundation Inc", "Michael Bloomberg"],
    ["Simons Foundation Inc", "Jim Simons"],
    ["Sergey Brin Family Foundation", "Sergey Brin"], // full name, not name-initial
    ["Musk Foundation", "Elon Musk"],
    ["The Koum Family Foundation", "Jan Koum"], //       leading "The" is stripped
    ["Samueli Foundation", "Henry Samueli"],
  ];
  for (const [org, person] of genuine) {
    assert.equal(isPlausiblyOwnFoundation(org, person), true, `should keep: ${org} <- ${person}`);
  }
});

test("B-020 — keeps real foundations that a forward walk destroyed (found by the prod preview)", () => {
  // These three were dropped by the first shipped rule and are genuinely theirs.
  // The tokens that broke it — a middle initial, a spousal "And", an
  // abbreviation — all sit BETWEEN the person's first and last name, which is
  // why the surname anchor is read backwards from the charitable word.
  assert.equal(isPlausiblyOwnFoundation("Stephen A Schwarzman Foundation", "Stephen Schwarzman"), true);
  assert.equal(isPlausiblyOwnFoundation("Phillip And Susan Ragon Foundation", "Phillip Ragon"), true);
  assert.equal(isPlausiblyOwnFoundation("Buffett Fam Foundation", "Warren Buffett"), true);
  // Spousal foundation that opens with the OTHER spouse — hers, and the
  // full-name escape is the only thing that keeps it.
  assert.equal(
    isPlausiblyOwnFoundation("Charles And Lynn Schusterman Family Foundation", "Lynn Schusterman"),
    true
  );
  // A generational suffix inside the ORG name (not just the person's) —
  // surfaced by the post-check sweep over stored rows.
  assert.equal(isPlausiblyOwnFoundation("James C Goodnight Jr Foundation", "James Goodnight"), true);
});

test("B-020 — a relative's foundation still does not attach", () => {
  // The open-with-their-own-name condition is what holds these out. If a future
  // change relaxes it to rescue a false negative, these come back with it.
  assert.equal(isPlausiblyOwnFoundation("Howard G Buffett Foundation", "Warren Buffett"), false);
  assert.equal(isPlausiblyOwnFoundation("Anne Kellogg Foundation", "Peter Kellogg"), false);
  assert.equal(isPlausiblyOwnFoundation("Harold Alfond Foundation", "Bill Alfond"), false);
});

test("B-020 — an org with no charitable entity word is never attached", () => {
  assert.equal(isPlausiblyOwnFoundation("Gates Industries Inc", "Bill Gates"), false);
});

test("B-020 — the surname must LEAD, not merely appear (this is what kills the class)", () => {
  // Same surname, same entity word; only the position differs.
  assert.equal(isPlausiblyOwnFoundation("Kellogg Foundation Of Utah", "Peter Kellogg"), true);
  assert.equal(isPlausiblyOwnFoundation("Anne Kellogg Foundation", "Peter Kellogg"), false);
});

test("B-020 — ACCEPTED FALSE NEGATIVE: <Surname> <Word> Foundation is indistinguishable from the wrong kind", () => {
  // "Blavatnik Archive Foundation" is genuinely Len Blavatnik's and we drop it.
  // It is token-for-token the same shape as "James Irvine Foundation", which is
  // NOT Hamilton James's — surname, one unrelated word, entity word. No string
  // rule can separate them, so the asymmetry decides: we lose $761,956 of real
  // giving to avoid crediting $203,756,889 of someone else's, three times over.
  // If this ever needs recovering, the route is a curated fact, not a looser rule.
  assert.equal(isPlausiblyOwnFoundation("Blavatnik Archive Foundation", "Len Blavatnik"), false);
  assert.equal(isPlausiblyOwnFoundation("James Irvine Foundation", "Hamilton E. James"), false);
});

test("the RTB '& family' display suffix is not a surname — generic 'Family Foundation' never attaches", () => {
  // Live 2026-09-30: "Clark Hunt & family" carried three unrelated charities legally named
  // "Family Foundation" (Richmond VA, Longview WA, Austin TX) — 59 such persons in prod.
  assert.equal(isPlausiblyOwnFoundation("Family Foundation", "Clark Hunt & family"), false);
  assert.equal(isPlausiblyOwnFoundation("The Family Foundation", "Barbara Banke & family"), false);
  assert.equal(isPlausiblyOwnFoundation("Family Fund", "Gary Rollins & family"), false);
});

test("the suffix is stripped whatever its spacing or case (Codex r1 #1: a trailing space slipped past)", () => {
  assert.equal(isPlausiblyOwnFoundation("Family Foundation", "Clark Hunt & family "), false);
  assert.equal(isPlausiblyOwnFoundation("Family Foundation", "Clark Hunt &Family"), false);
  assert.equal(isPlausiblyOwnFoundation("Family Foundation", "Clark Hunt  &  FAMILY\t"), false);
  assert.equal(isPlausiblyOwnFoundation("Hunt Family Foundation", "Clark Hunt & family "), true);
});

test("the 990 SEARCH surname changes for '& family' names ONLY — every other query is byte-identical", () => {
  assert.equal(foundationSearchSurname("Clark Hunt & family"), "Hunt");
  assert.equal(foundationSearchSurname("Clark Hunt & family "), "Hunt");
  // Deliberately unchanged from the old `name.split(" ").pop() || ""` (Codex r1 Q1): a moved
  // search can reach the self-heal DELETE of a correct stored fact.
  for (const n of ["James Goodnight Jr.", "John Smith III", "Bill Gates ", "Oprah", "Bill Gates"]) {
    assert.equal(foundationSearchSurname(n), n.split(" ").pop() || "", n);
  }
});

test("an '& family' person still gets their OWN foundation — the suffix is stripped, not the person", () => {
  assert.equal(isPlausiblyOwnFoundation("Hunt Family Foundation", "Clark Hunt & family"), true);
  assert.equal(isPlausiblyOwnFoundation("Rollins Foundation", "Gary Rollins & family"), true);
  assert.equal(isPlausiblyOwnFoundation("Clark Hunt Foundation", "Clark Hunt & family"), true);
});

test("B-020 — documented ceiling: same-surname relatives cannot be separated by name", () => {
  // Both true. Kimbal is a FALSE POSITIVE we knowingly accept; separating them
  // needs trustee-level evidence, not a string rule. Pinned so a future change
  // that appears to 'fix' Kimbal is checked against Bill Gates too.
  assert.equal(isPlausiblyOwnFoundation("Musk Foundation", "Elon Musk"), true);
  assert.equal(isPlausiblyOwnFoundation("Musk Foundation", "Kimbal Musk"), true);
});
