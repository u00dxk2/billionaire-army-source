import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveEnvName, resolveSeat, seatNames } from "./model-seats";

const REGISTRY = JSON.parse(
  readFileSync(new URL("../../../model-seats.json", import.meta.url), "utf8")
) as {
  schemaVersion: number;
  lane: string;
  seats: { seat: string; model: string; envOverride: string; legacyEnv: string | null }[];
};

test("deriveEnvName collapses every non-alphanumeric run to one underscore", () => {
  assert.equal(deriveEnvName("rag:chat"), "SEAT_RAG_CHAT_MODEL");
  assert.equal(deriveEnvName("pipeline:userPrompt"), "SEAT_PIPELINE_USERPROMPT_MODEL");
  assert.equal(deriveEnvName("feed curator, first pass"), "SEAT_FEED_CURATOR_FIRST_PASS_MODEL");
  // Leading/trailing separators are trimmed, so ":rag" and "rag" agree.
  assert.equal(deriveEnvName(":rag:"), "SEAT_RAG_MODEL");
});

test("every envOverride in model-seats.json is the DERIVED name, not a hand-typed one", () => {
  // A hand-typed override is a seat nobody can re-point: the variable set in
  // Doppler and the variable the resolver reads stop being the same string.
  for (const entry of REGISTRY.seats) {
    assert.equal(entry.envOverride, deriveEnvName(entry.seat), `envOverride drift on seat ${entry.seat}`);
  }
});

test("seat names are unique and non-empty — the name IS the call-log grouping key", () => {
  const names = seatNames();
  assert.equal(names.length, REGISTRY.seats.length);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.ok(n.trim().length > 0);
});

test("precedence: SEAT_<NAME>_MODEL, then legacyEnv, then the checked-in default", () => {
  const seat = "feed-curator:passA-generator";
  assert.deepEqual(resolveSeat(seat, {}), { model: "gpt-5.6-terra", source: "file" });
  // The legacy variable the curate-feed workflow still sets must keep winning,
  // or adoption would silently change what the daily 06:17 MT run calls.
  assert.deepEqual(resolveSeat(seat, { CURATOR_MODEL: "gpt-5.4-mini" }), {
    model: "gpt-5.4-mini",
    source: "legacyEnv",
  });
  assert.deepEqual(
    resolveSeat(seat, { CURATOR_MODEL: "gpt-5.4-mini", SEAT_FEED_CURATOR_PASSA_GENERATOR_MODEL: "gpt-5.6-sol" }),
    { model: "gpt-5.6-sol", source: "env" }
  );
});

test("an override set to whitespace is UNSET, never a model named \"\"", () => {
  // Doppler and GitHub Actions both store empty strings happily.
  assert.deepEqual(
    resolveSeat("feed-curator:passA-generator", { SEAT_FEED_CURATOR_PASSA_GENERATOR_MODEL: "   ", CURATOR_MODEL: "" }),
    { model: "gpt-5.6-terra", source: "file" }
  );
});

test("an unknown seat THROWS — a typo'd name must never resolve to a default", () => {
  assert.throws(() => resolveSeat("feed-curator:passZ-imaginary", {}), /unknown seat/);
});

test("the two same-event judge passes are separate seats sharing one legacy env", () => {
  const b022 = REGISTRY.seats.find((s) => s.seat === "feed-curator:b022-candidate-same-event-judge");
  const b023 = REGISTRY.seats.find((s) => s.seat === "feed-curator:b023-rewrite-same-event-judge");
  assert.ok(b022 && b023);
  assert.equal(b022.legacyEnv, "CURATOR_VERIFIER_MODEL");
  assert.equal(b023.legacyEnv, "CURATOR_VERIFIER_MODEL");
  assert.notEqual(b022.envOverride, b023.envOverride);
  // Same legacy env, so one override still moves both the old way; distinct
  // SEAT_ names, so they can now be moved apart.
  assert.deepEqual(resolveSeat(b022.seat, { CURATOR_VERIFIER_MODEL: "gpt-5.4-mini" }).model, "gpt-5.4-mini");
  assert.deepEqual(resolveSeat(b023.seat, { CURATOR_VERIFIER_MODEL: "gpt-5.4-mini" }).model, "gpt-5.4-mini");
});
