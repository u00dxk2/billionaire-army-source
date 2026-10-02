import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  anthropicUsageOf,
  createAnthropicJudge,
  isAnthropicModel,
  verdictTool,
  type AnthropicClientLike,
} from "./anthropic-judge";
import { judgeSameEvent, parseSameVerdicts } from "./fetchers/feed-same-event-judge";
import type OpenAI from "openai";

const TOOL = verdictTool({
  name: "record_same_event_verdicts",
  description: "Record one SAME/DIFFERENT verdict per headline pair you were given.",
  envelope: "verdicts",
  key: "index",
  keyType: "integer",
  keyDescription: "The bracketed index of the pair.",
  verdicts: ["SAME", "DIFFERENT"],
});

/** A stand-in Anthropic client that records the params it was handed. */
function stubClient(
  content: Anthropic.Message["content"],
  usage?: Record<string, unknown>,
  stopReason: Anthropic.Message["stop_reason"] = "tool_use"
): { client: AnthropicClientLike; seen: Record<string, unknown>[] } {
  const seen: Record<string, unknown>[] = [];
  const client: AnthropicClientLike = {
    messages: {
      create: async (params) => {
        seen.push(params as unknown as Record<string, unknown>);
        return {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: usage ?? { input_tokens: 11, output_tokens: 7 },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, seen };
}

function toolUseBlock(input: unknown, name = TOOL.name): Anthropic.Message["content"] {
  return [{ type: "tool_use", id: "toolu_1", name, input }] as unknown as Anthropic.Message["content"];
}

test("vendor detection is the model string's prefix, nothing else", () => {
  assert.equal(isAnthropicModel("claude-sonnet-5"), true);
  assert.equal(isAnthropicModel("claude-opus-5"), true);
  assert.equal(isAnthropicModel("gpt-5.6-terra"), false);
  assert.equal(isAnthropicModel("gpt-5.4-mini"), false);
  // Not a substring match — a model merely CONTAINING "claude" is not Anthropic's.
  assert.equal(isAnthropicModel("gpt-claude-lookalike"), false);
});

// The whole point of the build: an override to a claude-* model with no key must
// STOP, loudly, naming what to fix — never quietly issue the call to OpenAI.
test("a claude-* model with no ANTHROPIC_API_KEY throws naming seat, override var and key", () => {
  assert.throws(
    () =>
      createAnthropicJudge("feed-curator:passC-faithfulness-verifier", "claude-sonnet-5", {
        env: { OPENAI_API_KEY: "sk-openai-present" },
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /feed-curator:passC-faithfulness-verifier/);
      assert.match(msg, /SEAT_FEED_CURATOR_PASSC_FAITHFULNESS_VERIFIER_MODEL/);
      assert.match(msg, /ANTHROPIC_API_KEY/);
      assert.match(msg, /claude-sonnet-5/);
      // The refusal must say it is NOT silently using the OpenAI key sitting
      // right there in the same environment.
      assert.match(msg, /Refusing to fall back to OpenAI/);
      return true;
    }
  );
});

test("a whitespace-only ANTHROPIC_API_KEY is unset, not a key", () => {
  assert.throws(
    () =>
      createAnthropicJudge("dedupe-feed-items:same-event-judge", "claude-sonnet-5", {
        env: { ANTHROPIC_API_KEY: "   " },
      }),
    /ANTHROPIC_API_KEY is not set/
  );
});

test("a shadow-A/B caller is told to unset the variable it actually read", () => {
  assert.throws(
    () =>
      createAnthropicJudge("feed-curator:passB-relevance-verifier", "claude-sonnet-5", {
        env: {},
        overrideVar: "CURATOR_SHADOW_VERIFIER_MODEL",
      }),
    /CURATOR_SHADOW_VERIFIER_MODEL/
  );
});

// Fable/Mythos reject BOTH forced tool_choice and thinking:{disabled}. Refusing up
// front beats 400-ing on every call inside a fail-open catch (a judge that
// silently stops judging).
test("a claude model this path cannot drive is refused before any call", () => {
  assert.throws(
    () =>
      createAnthropicJudge("feed-curator:passB-relevance-verifier", "claude-fable-5-1", {
        env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      }),
    /cannot drive/
  );
});

test("a non-Anthropic model never reaches this path", () => {
  assert.throws(
    () =>
      createAnthropicJudge("feed-curator:passB-relevance-verifier", "gpt-5.6-terra", {
        env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      }),
    /not an Anthropic model/
  );
});

// The output contract: what comes back must be readable by the EXISTING parser,
// unchanged, or the two branches are not the same seat.
test("a mocked Anthropic verdict parses to the same shape as the OpenAI path", async () => {
  const { client } = stubClient(
    toolUseBlock({
      verdicts: [
        { index: 0, verdict: "SAME", reason: "one announcement, two outlets" },
        { index: 1, verdict: "DIFFERENT", reason: "different gifts" },
      ],
    })
  );
  const judge = createAnthropicJudge("feed-curator:b022-candidate-same-event-judge", "claude-sonnet-5", {
    env: {},
    client,
  });
  const answer = await judge.judge({ system: "sys", user: "usr", maxTokens: 2000, tool: TOOL });
  assert.equal(typeof answer.content, "string");

  const parsed = parseSameVerdicts(answer.content as string);
  assert.deepEqual([...parsed.duplicate], [0]);
  assert.equal(parsed.reasons.get(0), "one announcement, two outlets");
});

test("the request forces the tool, disables thinking, and sends no temperature", async () => {
  const { client, seen } = stubClient(toolUseBlock({ verdicts: [] }));
  const judge = createAnthropicJudge("feed-curator:b023-rewrite-same-event-judge", "claude-sonnet-5", {
    env: {},
    client,
  });
  await judge.judge({ system: "sys", user: "usr", maxTokens: 2000, tool: TOOL });
  const params = seen[0];
  assert.equal(params.model, "claude-sonnet-5");
  assert.equal(params.max_tokens, 2000);
  assert.deepEqual(params.tool_choice, { type: "tool", name: TOOL.name });
  assert.deepEqual(params.thinking, { type: "disabled" });
  // Sonnet 5 / Opus 4.7+ REMOVED sampling params — sending temperature is a 400.
  assert.equal("temperature" in params, false);
  assert.equal("response_format" in params, false);
});

test("no tool_use block means empty content — the callers' existing fail-open path", async () => {
  const { client } = stubClient(
    [{ type: "text", text: "I would rather explain in prose." }] as unknown as Anthropic.Message["content"],
    undefined,
    "end_turn"
  );
  const judge = createAnthropicJudge("profile-summary:faithfulness-verifier", "claude-sonnet-5", {
    env: {},
    client,
  });
  const answer = await judge.judge({ system: "sys", user: "usr", maxTokens: 800, tool: TOOL });
  assert.equal(answer.content, null);
});

// Anthropic's input_tokens EXCLUDES both cache classes; the log field's contract
// (LlmCallRow.cachedInputTokens) is OpenAI's, where prompt_tokens INCLUDES them.
test("usage maps to the log's OpenAI-shaped fields without under-reporting the prompt", () => {
  assert.deepEqual(
    anthropicUsageOf({
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 50,
      },
    }),
    { tokensIn: 550, tokensOut: 20, cachedInputTokens: 400, cacheCreationInputTokens: 50 }
  );
});

test("a class the provider did not report stays ABSENT, never a confident zero", () => {
  assert.deepEqual(anthropicUsageOf({ usage: { input_tokens: 9, output_tokens: 3 } }), {
    tokensIn: 9,
    tokensOut: 3,
  });
  assert.deepEqual(anthropicUsageOf({}), {});
  assert.deepEqual(anthropicUsageOf(null), {});
});

// strict:true requires additionalProperties:false and a full `required` list at
// EVERY level, or the API rejects the tool.
test("the forced-tool schema is strict-valid at every level", () => {
  assert.equal(TOOL.strict, true);
  assert.equal(TOOL.input_schema.additionalProperties, false);
  assert.deepEqual(TOOL.input_schema.required, ["verdicts"]);
  const items = (TOOL.input_schema.properties.verdicts as { items: Record<string, unknown> }).items;
  assert.equal(items.additionalProperties, false);
  assert.deepEqual(items.required, ["index", "verdict", "reason"]);
  assert.deepEqual((items.properties as Record<string, { enum?: string[] }>).verdict.enum, [
    "SAME",
    "DIFFERENT",
  ]);
});

// --- the branch AT the call site, not just the module ---

const PAIRS = [{ index: 0, a: "A headline", b: "B headline", score: 0.3 }];

/** Minimal OpenAI stand-in: enough of chat.completions.create to be called. */
function stubOpenAI(content: string): { openai: OpenAI; calls: number } {
  const box = { calls: 0 };
  const openai = {
    chat: {
      completions: {
        create: async () => {
          box.calls += 1;
          return {
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          };
        },
      },
    },
  } as unknown as OpenAI;
  return { openai, get calls() { return box.calls; } };
}

test("an OpenAI model still takes the OpenAI path, untouched", async () => {
  const stub = stubOpenAI(JSON.stringify({ verdicts: [{ index: 0, verdict: "SAME", reason: "r" }] }));
  const out = await judgeSameEvent(
    PAIRS,
    stub.openai,
    "gpt-5.6-terra",
    "feed-curator:b022-candidate-same-event-judge"
  );
  assert.equal(stub.calls, 1);
  assert.equal(out.ran, true);
  assert.equal(out.failedOpen, false);
  assert.deepEqual([...out.duplicate], [0]);
  assert.equal(out.inTok, 12);
});

// The behaviour a reader of an ENFORCING gate has to be able to trust: a claude
// seat with no key does NOT quietly bill OpenAI, and it does NOT delete anything.
test("a claude seat with no key never calls OpenAI, and fails OPEN (nothing dropped)", async () => {
  const stub = stubOpenAI(JSON.stringify({ verdicts: [{ index: 0, verdict: "SAME", reason: "r" }] }));
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const out = await judgeSameEvent(
      PAIRS,
      stub.openai,
      "claude-sonnet-5",
      "feed-curator:b023-rewrite-same-event-judge"
    );
    assert.equal(stub.calls, 0, "the OpenAI client must not be called for a claude seat");
    assert.equal(out.ran, false);
    assert.equal(out.failedOpen, true, "asked-and-could-not-answer must stay distinguishable");
    assert.equal(out.duplicate.size, 0, "a failed judge deletes nothing");
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("the section-keyed variant keys by section name, not index", () => {
  const sectionTool = verdictTool({
    name: "record_section_faithfulness_verdicts",
    description: "d",
    envelope: "sections",
    key: "section",
    keyType: "string",
    keyDescription: "k",
    verdicts: ["KEEP", "REJECT"],
  });
  assert.deepEqual(sectionTool.input_schema.required, ["sections"]);
  const items = (sectionTool.input_schema.properties.sections as { items: Record<string, unknown> })
    .items;
  assert.deepEqual(items.required, ["section", "verdict", "reason"]);
  assert.deepEqual((items.properties as Record<string, { type?: string }>).section.type, "string");
});
