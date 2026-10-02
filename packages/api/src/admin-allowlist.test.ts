import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdminUserId } from "./admin-allowlist";

// R-042. The fail-closed branch of the admin gate, as a DECISION rather than as
// a deployment. Most cases below are the gate saying NO — a gate you have only
// seen say YES is UNKNOWN, not working.

const DAVID = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";

test("R-042 — an unset allowlist makes NOBODY an admin, not everybody", () => {
  // The whole point of the fail-closed design: a misconfigured deploy must not
  // hand moderation to the world.
  assert.equal(isAdminUserId(DAVID, undefined), false);
  assert.equal(isAdminUserId(DAVID, ""), false);
  assert.equal(isAdminUserId(DAVID, "   "), false);
  assert.equal(isAdminUserId(DAVID, ",,, ,"), false);
});

test("R-042 — a signed-in NON-admin is refused while the allowlist is populated", () => {
  // This is the case the board card asked the owner to create an account for. The
  // account is needed to OBSERVE the 403 end-to-end; the decision behind it is
  // this line, and it does not need one.
  assert.equal(isAdminUserId(STRANGER, DAVID), false);
  assert.equal(isAdminUserId(STRANGER, `${DAVID},${DAVID}`), false);
});

test("R-042 — the listed admin IS admitted (the positive control)", () => {
  // Without this, every assertion above passes for a function that returns
  // false unconditionally.
  assert.equal(isAdminUserId(DAVID, DAVID), true);
  assert.equal(isAdminUserId(DAVID, ` ${DAVID} , ${STRANGER} `), true);
  assert.equal(isAdminUserId(STRANGER, `${DAVID},${STRANGER}`), true);
});

test("R-042 — a missing userId is never admin, even on a populated allowlist", () => {
  assert.equal(isAdminUserId(undefined, DAVID), false);
  assert.equal(isAdminUserId(null, DAVID), false);
  assert.equal(isAdminUserId("", DAVID), false);
  // An empty userId must not match an empty allowlist entry either — which is
  // why the parse filters blanks BEFORE comparing.
  assert.equal(isAdminUserId("", ",,"), false);
});

test("R-042 — matching is exact, not prefix or substring", () => {
  assert.equal(isAdminUserId(DAVID.slice(0, 8), DAVID), false);
  assert.equal(isAdminUserId(DAVID + "x", DAVID), false);
});
