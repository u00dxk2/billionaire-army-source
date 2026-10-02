import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { users } from "@ba/db";
import type { Db } from "@ba/db";
import { ensureUserRow } from "./ensure-user-row.js";

// A fake that records the drizzle chain insert(table).values(v).onConflictDoNothing(cfg).
function fakeDb(fail?: Error) {
  const calls: { table: unknown; values: unknown; conflict: unknown }[] = [];
  const db = {
    insert(table: unknown) {
      return {
        values(values: unknown) {
          return {
            async onConflictDoNothing(conflict: unknown) {
              calls.push({ table, values, conflict });
              if (fail) throw fail;
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Db, calls };
}

test("R-043 — a signed-in user gets a users row, keyed on the auth id", async () => {
  const { db, calls } = fakeDb();
  await ensureUserRow(db, { id: "u-1", email: "ada@example.com" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, users);
  assert.deepEqual(calls[0].values, { id: "u-1", email: "ada@example.com", displayName: "ada" });
});

test("R-043 — the insert is idempotent: it DOES NOTHING on a primary-key conflict", async () => {
  // Without this, the second authenticated request of every existing user 500s
  // on a duplicate key — the guarantee would break every write it exists to fix.
  const { db, calls } = fakeDb();
  await ensureUserRow(db, { id: "u-1", email: "ada@example.com" });
  assert.deepEqual(calls[0].conflict, { target: users.id });
});

test("R-043 — a user with no email inserts nothing (users.email is NOT NULL)", async () => {
  const { db, calls } = fakeDb();
  await ensureUserRow(db, { id: "u-2", email: null });
  await ensureUserRow(db, { id: "u-3" });
  assert.equal(calls.length, 0);
});

test("R-043 — a database failure is NOT swallowed", async () => {
  // Swallowing it would let the request proceed into the foreign-key 500 this
  // guarantee exists to remove, with the real cause hidden.
  const { db } = fakeDb(new Error("connection refused"));
  await assert.rejects(ensureUserRow(db, { id: "u-1", email: "ada@example.com" }), /connection refused/);
});

test("R-043 — authenticate() actually calls the guarantee, after the token is verified", () => {
  // The helper being correct proves nothing if nothing invokes it (KP-93: a
  // falsifier must revert the WIRE-UP, not just the helper). auth.ts cannot be
  // imported here, so read its source.
  // Matched as a LIVE statement at the start of a line: a substring search passed
  // with the call commented out (`// await ensureUserRow(`), red-armed 2026-09-16.
  const src = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  const guard = src.indexOf('reply.status(401).send({ error: "Invalid token" })');
  const call = src.search(/^\s*await ensureUserRow\(/m);
  assert.ok(guard > 0, "the invalid-token guard moved; re-check this ordering by hand");
  assert.ok(call > guard, "authenticate() must call ensureUserRow AFTER rejecting an invalid token");
});
