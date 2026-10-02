import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldPostLlmLog,
  llmLogEndpoint,
  buildLlmLogBody,
  usageOf,
  postLlmCall,
  flushLlmLogs,
  pendingLlmLogCount,
} from "./llm-call-log";

// ── the writer gate ─────────────────────────────────────────────────────────
// The POSITIVE CONTROL for this whole file: a config that SHOULD write must be
// shown to write, or every assertion below is satisfied by a function that
// never does anything.
test("a configured sink posts (positive control)", () => {
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_URL: "http://localhost:9/sink" }), true);
});

test("no LLM_CALL_LOG_URL means no post — logging is off by default", () => {
  assert.equal(shouldPostLlmLog({}), false);
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_URL: "" }), false);
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_URL: "   " }), false);
  // A PIN alone never enables logging: there is no default destination.
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_PIN: "x" }), false);
});

test("under a test runner nothing posts, even with a sink configured", () => {
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_URL: "http://x", NODE_TEST_CONTEXT: "child-v8" }), false);
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_URL: "http://x", VITEST: "true" }), false);
});

test("LLM_CALL_LOG_DISABLED is the kill switch and beats the URL", () => {
  assert.equal(shouldPostLlmLog({ LLM_CALL_LOG_URL: "http://x", LLM_CALL_LOG_DISABLED: "1" }), false);
});

test("endpoint has no default and reads LLM_CALL_LOG_URL", () => {
  assert.equal(llmLogEndpoint({}), null);
  assert.equal(llmLogEndpoint({ LLM_CALL_LOG_URL: "http://localhost:3000/x" }), "http://localhost:3000/x");
});

// ── the body shape ──────────────────────────────────────────────────────────
test("body carries the four required fields with the project slug", () => {
  const b = JSON.parse(buildLlmLogBody({ model: "gpt-5.6-terra", callSite: "seat", taskStatus: "ok" }, "PIN"));
  assert.equal(b.project, "billionaire-army");
  assert.equal(b.model, "gpt-5.6-terra");
  assert.equal(b.callSite, "seat");
  assert.equal(b.taskStatus, "ok");
  assert.equal(b.pin, "PIN");
});

test("no PIN configured means no pin field in the body", () => {
  const b = JSON.parse(buildLlmLogBody({ model: "m", callSite: "s", taskStatus: "ok" }));
  assert.equal("pin" in b, false);
});

// "absent" and "zero" are DIFFERENT claims: absent stays NULL ("not reported"),
// zero asserts we looked and found none.
test("unreported numeric fields are OMITTED, never sent as 0", () => {
  const b = JSON.parse(buildLlmLogBody({ model: "m", callSite: "s", taskStatus: "ok" }, "PIN"));
  assert.equal("tokensIn" in b, false);
  assert.equal("tokensOut" in b, false);
  assert.equal("cachedInputTokens" in b, false);
  assert.equal("latencyMs" in b, false);
  assert.equal("extra" in b, false);
});

test("a real zero survives — 0 tokens out is sent as 0", () => {
  const b = JSON.parse(buildLlmLogBody({ model: "m", callSite: "s", taskStatus: "ok", tokensOut: 0 }, "PIN"));
  assert.equal(b.tokensOut, 0);
});

test("extra rides through for the harness flag", () => {
  const b = JSON.parse(
    buildLlmLogBody({ model: "m", callSite: "s", taskStatus: "ok", extra: { harness: true } }, "PIN")
  );
  assert.deepEqual(b.extra, { harness: true });
});

// ── usage extraction ────────────────────────────────────────────────────────
test("usageOf reads OpenAI's three billed classes", () => {
  const u = usageOf({
    usage: { prompt_tokens: 4250, completion_tokens: 318, prompt_tokens_details: { cached_tokens: 3200 } },
  });
  assert.deepEqual(u, { tokensIn: 4250, tokensOut: 318, cachedInputTokens: 3200 });
});

test("a response with no usage reports NOTHING, not zeros", () => {
  assert.deepEqual(usageOf({}), {});
  assert.deepEqual(usageOf(null), {});
  assert.deepEqual(usageOf({ usage: {} }), { tokensIn: undefined, tokensOut: undefined, cachedInputTokens: undefined });
});

test("a missing cached-tokens detail is undefined, not 0", () => {
  const u = usageOf({ usage: { prompt_tokens: 10, completion_tokens: 2 } });
  assert.equal(u.cachedInputTokens, undefined);
});

// ── queue + flush ───────────────────────────────────────────────────────────
// These jobs end with process.exit(), which kills in-flight fetches silently.
// If the queue does not actually hold a promise, flushLlmLogs() is decoration.
test("a gated-off post queues nothing and flush is a no-op", async () => {
  postLlmCall({ model: "m", callSite: "s", taskStatus: "ok" }, {});
  assert.equal(pendingLlmLogCount(), 0);
  await flushLlmLogs();
});

test("an enabled post is TRACKED until flushed (the process.exit hazard)", async () => {
  const realFetch = globalThis.fetch;
  let sawUrl = "";
  let sawBody = "";
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    sawUrl = String(url);
    sawBody = init.body;
    await gate;
    return { ok: true };
  }) as unknown as typeof fetch;
  try {
    postLlmCall(
      { model: "gpt-5.4-mini", callSite: "seat", taskStatus: "ok", tokensIn: 5 },
      { LLM_CALL_LOG_URL: "http://localhost:9/sink", LLM_CALL_LOG_PIN: "PIN" }
    );
    assert.equal(pendingLlmLogCount(), 1, "post must be queued, or flush cannot protect it");
    release();
    await flushLlmLogs();
    assert.equal(pendingLlmLogCount(), 0, "flush must drain the queue");
    assert.equal(sawUrl, "http://localhost:9/sink");
    assert.equal(JSON.parse(sawBody).callSite, "seat");
    assert.equal(JSON.parse(sawBody).pin, "PIN");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Fail-soft is the entire contract: a sink outage reproduces prior behaviour.
test("a throwing sink never throws at the caller and still drains", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("sink down");
  }) as unknown as typeof fetch;
  try {
    postLlmCall({ model: "m", callSite: "s", taskStatus: "ok" }, { LLM_CALL_LOG_URL: "http://localhost:9/sink" });
    await flushLlmLogs();
    assert.equal(pendingLlmLogCount(), 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
