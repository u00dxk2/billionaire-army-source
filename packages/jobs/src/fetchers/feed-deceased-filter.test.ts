import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeceased } from "./feed-deceased-filter";

test("flags a person with a death year on file", () => {
  assert.equal(isDeceased({ name: "Sheldon Adelson", deathYear: 2021 }), true);
});

test("passes a living person (no death year)", () => {
  assert.equal(isDeceased({ name: "Elon Musk", deathYear: null }), false);
});

test("passes an undefined person (caller's not-found guard runs first in practice)", () => {
  assert.equal(isDeceased(undefined), false);
});
