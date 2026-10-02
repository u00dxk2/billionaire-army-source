import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonBody } from "./json-body.js";

// The regression this exists for: nine client call sites POST /api/users/sync
// with `Content-Type: application/json` and NO body. Fastify's stock parser
// 400s on that during parsing — before preHandler — so the user row was never
// created and every follow-up authenticated write (comment, vote, rating,
// proposal) then violated the user_id foreign key with a 500.
test("an EMPTY body parses to {} rather than throwing (the /users/sync regression)", () => {
  assert.deepEqual(parseJsonBody(""), {});
});

test("a whitespace-only body also counts as empty", () => {
  assert.deepEqual(parseJsonBody("   "), {});
  assert.deepEqual(parseJsonBody("\n"), {});
  assert.deepEqual(parseJsonBody("\r\n\t "), {});
});

test("a normal JSON body still parses to its value", () => {
  assert.deepEqual(parseJsonBody('{"body":"hello"}'), { body: "hello" });
  assert.deepEqual(parseJsonBody('{"hidden":true}'), { hidden: true });
  assert.deepEqual(parseJsonBody("[1,2,3]"), [1, 2, 3]);
});

test("MALFORMED JSON still throws, so the caller can surface a 400", () => {
  // Tolerating empty must not become tolerating garbage — a truncated or
  // corrupt body is a real client error and has to stay a 400, not become {}.
  assert.throws(() => parseJsonBody("{"));
  assert.throws(() => parseJsonBody('{"body":}'));
  assert.throws(() => parseJsonBody("not json at all"));
});

test("the literal string 'null' is not treated as empty", () => {
  // `null` is valid JSON and distinct from an absent body; a route that
  // zod-parses it should get null and reject it, not silently receive {}.
  assert.equal(parseJsonBody("null"), null);
});
