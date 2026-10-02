import { test } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "./auth-error";

const FALLBACK_HINT = "hello@skylarkcreations.com";

test("the live 2026-08-06 defect: a message of '{}' never reaches the user", () => {
  // This is the exact value the signup page rendered into a red box on prod.
  assert.match(authErrorMessage({ message: "{}" }), /wrong on our end/);
  assert.match(authErrorMessage("{}"), /wrong on our end/);
});

test("a real GoTrue 500 body yields the sentence that names the problem", () => {
  // GoTrue puts human text in `msg`; supabase-js may surface neither `message`
  // nor `error_description`, which is how the 8/06 case produced nothing.
  const body = { code: 500, error_code: "unexpected_failure", msg: "Error sending confirmation email" };
  assert.equal(authErrorMessage(body), "Error sending confirmation email");
});

test("a normal message passes straight through (the positive control)", () => {
  // Without this, every assertion above passes for a function that always
  // returns the fallback — which would hide every real auth error instead.
  assert.equal(authErrorMessage({ message: "Invalid login credentials" }), "Invalid login credentials");
  assert.equal(authErrorMessage("User already registered"), "User already registered");
});

test("empty and object-ish junk all fall back rather than rendering raw", () => {
  for (const junk of ["", "   ", "[]", "[object Object]", "null", "undefined", '{"code":500}']) {
    assert.match(authErrorMessage(junk), /wrong on our end/, `should reject: ${junk}`);
  }
  assert.match(authErrorMessage(null), /wrong on our end/);
  assert.match(authErrorMessage(undefined), /wrong on our end/);
  assert.match(authErrorMessage({}), /wrong on our end/);
});

test("the fallback tells the reader it is not their fault, and where to go", () => {
  const m = authErrorMessage({});
  assert.match(m, /isn't you/);
  assert.ok(m.includes(FALLBACK_HINT), "must carry the contact route R-054 opened");
});

test("field precedence prefers the normalised message over the raw one", () => {
  assert.equal(
    authErrorMessage({ message: "Email not confirmed", msg: "raw gotrue text" }),
    "Email not confirmed"
  );
  // ...but falls through when the preferred field is the useless one.
  assert.equal(authErrorMessage({ message: "{}", msg: "Error sending confirmation email" }), "Error sending confirmation email");
});
