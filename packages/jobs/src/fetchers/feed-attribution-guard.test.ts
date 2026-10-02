import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeForNameMatch,
  nameInText,
  findAttributionMismatch,
  type IndexedPerson,
} from "./feed-attribution-guard";

// Names and headlines below are the real 2026-07-02 curator run — the two
// shipped misattributions this guard exists to catch, plus the shipped-correct
// cards it must not touch.
const persons: IndexedPerson[] = [
  { id: "sheldon", name: "Sheldon Adelson" },
  { id: "miriam", name: "Miriam Adelson" },
  { id: "bezos", name: "Jeff Bezos" },
  { id: "scott", name: "MacKenzie Scott" },
  { id: "bloomberg", name: "Michael Bloomberg" },
  { id: "knight", name: "Phil Knight" },
  { id: "melinda", name: "Melinda French Gates" },
];

test("normalize strips possessives and hyphens to word boundaries", () => {
  assert.equal(
    normalizeForNameMatch("Phil Knight-backed, MacKenzie Scott's giving!"),
    " phil knight backed mackenzie scott s giving "
  );
});

test("nameInText matches full names through possessives and hyphens", () => {
  assert.ok(nameInText("MacKenzie Scott", normalizeForNameMatch("MacKenzie Scott's giving surged")));
  assert.ok(nameInText("Phil Knight", normalizeForNameMatch("Phil Knight-backed scholarships")));
  assert.ok(!nameInText("Sheldon Adelson", normalizeForNameMatch("Miriam Adelson's newspaper")));
  assert.ok(!nameInText("", " anything "));
});

test("catches the Adelson misattribution (headline names the other Adelson)", () => {
  assert.equal(
    findAttributionMismatch(
      "Miriam Adelson's newspaper criticizes Trump, highlighting her political influence",
      "sheldon",
      "Sheldon Adelson",
      persons
    ),
    "Miriam Adelson"
  );
});

test("catches the Scott/Bezos misattribution (subject shifted by the rewrite)", () => {
  assert.equal(
    findAttributionMismatch(
      "MacKenzie Scott's giving accounted for a large share of U.S. megagifts last year",
      "bezos",
      "Jeff Bezos",
      persons
    ),
    "MacKenzie Scott"
  );
});

test("passes a card whose attached person is named in the headline", () => {
  assert.equal(
    findAttributionMismatch(
      "Elon Musk's fortune drops below trillionaire status after a tech sell-off",
      "musk",
      "Elon Musk",
      persons
    ),
    null
  );
});

test("passes org-name headlines with no other person named (Bloomberg Philanthropies)", () => {
  assert.equal(
    findAttributionMismatch(
      "Bloomberg Philanthropies backs clean-energy transition investment",
      "bloomberg",
      "Michael Bloomberg",
      persons
    ),
    null
  );
});

test("passes when the attached person is named alongside another indexed person", () => {
  assert.equal(
    findAttributionMismatch(
      "MacKenzie Scott and Jeff Bezos' foundations both reported record grants",
      "bezos",
      "Jeff Bezos",
      persons
    ),
    null
  );
});

test("passes a short-form name headline rather than guessing (Melinda Gates)", () => {
  // "Melinda Gates" is not the indexed row ("Melinda French Gates") and is no
  // other person's full name — conservative pass, never a drop.
  assert.equal(
    findAttributionMismatch("Melinda Gates announces new pledge", "melinda", "Melinda French Gates", persons),
    null
  );
});

test("never flags on a single-token indexed name", () => {
  const withMononym: IndexedPerson[] = [...persons, { id: "cher", name: "Cher" }];
  assert.equal(
    findAttributionMismatch("Cher attends gala hosted by foundation", "bezos", "Jeff Bezos", withMononym),
    null
  );
});
