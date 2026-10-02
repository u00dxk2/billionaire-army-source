import { test } from "node:test";
import assert from "node:assert/strict";
import { orderLeaderboard, isGradedEntry } from "./leaderboard-order";

const e = (name: string, pbs: string | null) => ({ person: { name }, pbs });
const names = (xs: { person: { name: string } }[]) => xs.map((x) => x.person.name);

// Two not-graded people whose WITHHELD scores would have ranked them — the API serves null.
const board = [e("Zoe Notgraded", null), e("Gates", "94.56"), e("Aaron Notgraded", null), e("Low", "3.10"), e("Mid", "40.00")];

test("best first: graded by score descending, then the not graded by name", () => {
  assert.deepEqual(names(orderLeaderboard(board, "desc")), ["Gates", "Mid", "Low", "Aaron Notgraded", "Zoe Notgraded"]);
});

test("WORST first never leads with the not graded — they stay after the ranked set", () => {
  // The defect this pins: Number(null) is 0, so a plain ascending sort put every person we hold
  // no giving data on at the top of "worst first", above the lowest real score.
  assert.deepEqual(names(orderLeaderboard(board, "asc")), ["Low", "Mid", "Gates", "Aaron Notgraded", "Zoe Notgraded"]);
});

test("a filter that leaves only not-graded people still lists them, by name", () => {
  assert.deepEqual(names(orderLeaderboard([e("Zoe", null), e("Aaron", null)], "asc")), ["Aaron", "Zoe"]);
});

test("a null, empty or unparseable score is never treated as a zero score", () => {
  assert.equal(isGradedEntry(e("x", null)), false);
  assert.equal(isGradedEntry(e("x", "abc")), false);
  assert.equal(isGradedEntry(e("x", "0")), true); // a stored, served 0 is a real score
});

test("the input is not mutated", () => {
  const input = [...board];
  orderLeaderboard(input, "asc");
  assert.deepEqual(names(input), names(board));
});
