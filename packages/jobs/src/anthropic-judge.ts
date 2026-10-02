/**
 * NATIVE Anthropic path for this repo's JUDGE seats.
 *
 * WHY THIS EXISTS. `model-seats.json` + `resolveSeat()` make every seat
 * re-pointable by a `SEAT_<NAME>_MODEL` environment variable. Until this file
 * landed, that promise was FALSE for the judge seats: this package speaks only
 * to the OpenAI SDK (`packages/jobs/package.json` listed `openai` and no
 * `@anthropic-ai/sdk`), so setting
 * `SEAT_FEED_CURATOR_PASSC_FAITHFULNESS_VERIFIER_MODEL=claude-sonnet-5` would
 * have sent a Claude model id to `api.openai.com` and 404'd every call — on an
 * ENFORCING gate, silently, into a fail-open catch. A judge belongs on a
 * DIFFERENT model family from the writer it grades; when this file landed the
 * judges sat on `gpt-5.6-terra`, the same model as Pass A. This
 * file is the thing that has to exist before that can be fixed by config.
 *
 * WHAT THIS IS NOT. It is not a
 * provider abstraction, a gateway, or an adapter over both SDKs. There is no
 * common client interface: each judge call site keeps its exact
 * `openai.chat.completions.create(...)` and gains ONE sibling branch that calls
 * the Anthropic Messages API natively, with the same prompt text, the same
 * `max_tokens`, and an output contract the caller's EXISTING parser reads
 * unchanged. Vendor selection is the resolved model string's prefix and nothing
 * else.
 *
 * STRUCTURED OUTPUT. The OpenAI branch uses `response_format:
 * {type:"json_object"}`. Anthropic has no `response_format`; the documented
 * native equivalent is tool use — the same JSON Schema as the tool's
 * `input_schema`, `strict: true` so the arguments validate exactly, and
 * `tool_choice: {type:"tool", name}` forcing that one tool. The tool's `input`
 * is then re-serialised to a JSON string, so every caller's existing
 * `JSON.parse` + "find the first array value" parser is byte-for-byte the same
 * code on both branches. A schema-valid answer is therefore GUARANTEED on this
 * branch and merely REQUESTED on the OpenAI one — which is a strictly better
 * contract, not a different one.
 *
 * NO SAMPLING PARAMS, NO THINKING. `temperature` is REMOVED on Claude Sonnet 5
 * (and every Opus 4.7+ model): sending it is a 400, so `temperatureOpt()` is
 * simply not consulted on this branch. Thinking is disabled explicitly: a judge
 * returning a fixed verdict list has nothing to reason about at length, it
 * keeps the seat cheap, and it removes any interaction between adaptive
 * thinking and a FORCED `tool_choice`.
 *
 * FAIL LOUD, NEVER SWAP SILENTLY. If a seat resolves to a `claude-*` model and
 * `ANTHROPIC_API_KEY` is absent, `createAnthropicJudge()` THROWS, naming the
 * seat, its override variable and the missing key. It does not fall back to
 * OpenAI. An invisible model swap is the exact failure the registry exists to
 * prevent, and a judge quietly grading on a model nobody chose is worse than a
 * judge that stops. What happens NEXT is each call site's existing behaviour,
 * unchanged by this file: all four of this repo's judge call sites are
 * fail-OPEN (the throw lands in their `catch`, `failedOpen` is set, the run
 * logs a `fail` row and drops NOTHING). So a missing key on an ENFORCING gate
 * degrades to "publishes everything", never to "deletes everything".
 */

import Anthropic from "@anthropic-ai/sdk";
import { deriveEnvName } from "./model-seats";

/**
 * Vendor detection — the resolved model STRING's prefix, nothing else. No
 * lookup table to drift, no per-seat vendor field to disagree with the model
 * it sits beside. Everything that is not a `claude-` model takes the existing
 * OpenAI path untouched.
 */
export function isAnthropicModel(model: string): boolean {
  return typeof model === "string" && model.startsWith("claude-");
}

/**
 * Anthropic models this path deliberately REFUSES rather than 400s on.
 * Claude Fable / Claude Mythos reject BOTH of the two things every judge call
 * here does — forced `tool_choice` (`type: "tool"` / `"any"`) and an explicit
 * `thinking: {type:"disabled"}` — so an override naming one would fail on every
 * single call with a raw API error inside a fail-open catch, i.e. a judge that
 * silently stops judging. Refusing up front says why.
 */
const UNSUPPORTED_MODEL_PREFIXES = ["claude-fable-", "claude-mythos-"] as const;

/** A forced-tool spec: the JSON Schema the judge's answer must satisfy. */
export type VerdictToolSpec = {
  name: string;
  description: string;
  strict: true;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

/**
 * Build the forced-tool schema for a refute-only verdict list.
 *
 * Every judge seat in this repo answers the same SHAPE — an array of
 * `{<key>, verdict, reason}` — under one of two keys (`index` for the card
 * judges, `section` for the profile-summary auditor) and one of two verdict
 * vocabularies (KEEP/REJECT, SAME/DIFFERENT). The envelope key is free because
 * every caller's parser finds the first ARRAY value in the object rather than
 * naming a field; it is still spelled to match each seat's prompt text so the
 * model sees one consistent instruction.
 *
 * `strict: true` requires `additionalProperties: false` and a full `required`
 * list at EVERY level — hence the shape below, which is deliberately not
 * generated dynamically beyond these knobs.
 */
export function verdictTool(opts: {
  name: string;
  description: string;
  envelope: string;
  key: "index" | "section";
  keyType: "integer" | "string";
  keyDescription: string;
  verdicts: readonly string[];
}): VerdictToolSpec {
  return {
    name: opts.name,
    description: opts.description,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        [opts.envelope]: {
          type: "array",
          description: `One entry per item you were given, echoing the ${opts.key} exactly.`,
          items: {
            type: "object",
            properties: {
              [opts.key]: { type: opts.keyType, description: opts.keyDescription },
              verdict: { type: "string", enum: [...opts.verdicts] },
              reason: { type: "string", description: "Short phrase." },
            },
            required: [opts.key, "verdict", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: [opts.envelope],
      additionalProperties: false,
    },
  };
}

/** Token classes as the portfolio LLM log wants them. Absent = not reported. */
export type AnthropicJudgeUsage = {
  tokensIn?: number;
  tokensOut?: number;
  cachedInputTokens?: number;
  /**
   * Cache WRITES. Deliberately NOT folded into `cachedInputTokens`: a cache
   * write bills ~1.25x and a cache read ~0.1x, so merging them mis-prices the
   * seat in both directions. Callers put it on the log row's `extra`.
   */
  cacheCreationInputTokens?: number;
};

export type AnthropicJudgeResult = AnthropicJudgeUsage & {
  /**
   * The forced tool's arguments, re-serialised. `null` when the model returned
   * no tool call at all (or refused) — which every caller already treats as
   * "empty content", i.e. fail open.
   */
  content: string | null;
  /** Mirrors of `tokensIn`/`tokensOut` as plain numbers for the callers' cost lines. */
  inTok: number;
  outTok: number;
};

/**
 * Pure: pull the billed token classes out of an Anthropic `Message`.
 *
 * ⚠ The two providers count the prompt DIFFERENTLY and the log field's contract
 * is OpenAI's. `LlmCallRow.cachedInputTokens` is documented as "the cached
 * slice of prompt_tokens (prompt_tokens INCLUDES it)". Anthropic's
 * `input_tokens` EXCLUDES both cache classes, so reporting it raw as `tokensIn`
 * beside a non-zero `cache_read_input_tokens` would under-report the prompt and
 * then subtract the cached slice from a number that never contained it. The sum
 * below restores the field's meaning. Missing fields stay MISSING — a provider
 * that did not report a class must not render as a confident zero (KP-78).
 */
export function anthropicUsageOf(response: unknown): AnthropicJudgeUsage {
  const u = (response as { usage?: Record<string, unknown> } | null | undefined)?.usage;
  if (!u) return {};
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const input = num(u.input_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  const out: AnthropicJudgeUsage = {};
  if (input !== undefined) out.tokensIn = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
  const output = num(u.output_tokens);
  if (output !== undefined) out.tokensOut = output;
  if (cacheRead !== undefined) out.cachedInputTokens = cacheRead;
  if (cacheWrite !== undefined) out.cacheCreationInputTokens = cacheWrite;
  return out;
}

/**
 * The one call this module makes. Narrow on purpose: it is a test seam, not a
 * provider abstraction — the production implementation is a two-line wrapper
 * around the real SDK client and nothing else in this repo implements it.
 */
export type AnthropicClientLike = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
};

export type AnthropicJudge = {
  readonly model: string;
  readonly seat: string;
  judge(args: {
    system: string;
    user: string;
    maxTokens: number;
    tool: VerdictToolSpec;
  }): Promise<AnthropicJudgeResult>;
};

/**
 * Build the judge client for one seat, or THROW saying exactly what to set.
 *
 * @param seat  the registry seat name — the same string the call log is tagged
 *              with, so the refusal names something greppable in three places.
 * @param model the ALREADY-RESOLVED model (from `resolveSeat(seat).model`);
 *              this function never resolves a seat itself, so it cannot
 *              disagree with what the call site logged.
 * @param opts.overrideVar  the variable the caller's model actually CAME from,
 *              when that is not the seat's own `SEAT_<NAME>_MODEL` — the shadow
 *              A/B callers read `CURATOR_SHADOW_*_MODEL`, and a refusal telling
 *              them to unset a variable they never set is a wrong instruction.
 * @param opts.client  test seam. Injecting one skips the key check, because the
 *              injected client carries its own credentials or none.
 * @throws when the model is not an Anthropic model, when it is an Anthropic
 *         model this path cannot drive, or when `ANTHROPIC_API_KEY` is unset.
 */
export function createAnthropicJudge(
  seat: string,
  model: string,
  opts: {
    env?: Record<string, string | undefined>;
    client?: AnthropicClientLike;
    overrideVar?: string;
  } = {}
): AnthropicJudge {
  const env = opts.env ?? process.env;
  const client = opts.client;
  const overrideVar = opts.overrideVar ?? deriveEnvName(seat);
  if (!isAnthropicModel(model)) {
    throw new Error(
      `anthropic-judge: seat "${seat}" resolved to "${model}", which is not an Anthropic model. ` +
        `This path is only for models whose id starts with "claude-"; everything else takes the OpenAI branch.`
    );
  }
  const unsupported = UNSUPPORTED_MODEL_PREFIXES.find((p) => model.startsWith(p));
  if (unsupported) {
    throw new Error(
      `anthropic-judge: seat "${seat}" resolved to "${model}", which this path cannot drive. ` +
        `The ${unsupported}* family rejects forced tool_choice AND an explicit thinking:{type:"disabled"} — ` +
        `both of which every judge call here sends. Point ${overrideVar} at claude-sonnet-5 (or another ` +
        `claude-opus-*/claude-sonnet-*/claude-haiku-* model) instead.`
    );
  }
  const apiKey = typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : "";
  if (!apiKey && !client) {
    throw new Error(
      `anthropic-judge: seat "${seat}" resolved to the Anthropic model "${model}" but ANTHROPIC_API_KEY is not set ` +
        `in this job's environment. Set ANTHROPIC_API_KEY (for example from .env, or a CI secret for scheduled runs), ` +
        `or unset ${overrideVar} to send this seat back to its checked-in ` +
        `model-seats.json default. Refusing to fall back to OpenAI: a judge silently grading on a model nobody ` +
        `chose is the failure the model registry exists to prevent.`
    );
  }

  const sdk: AnthropicClientLike =
    client ??
    (() => {
      const real = new Anthropic({ apiKey });
      return { messages: { create: (params) => real.messages.create(params) } };
    })();

  return {
    model,
    seat,
    async judge({ system, user, maxTokens, tool }) {
      const message = await sdk.messages.create({
        model,
        max_tokens: maxTokens,
        // A verdict list is not a reasoning task, and disabling thinking keeps
        // the forced tool_choice below unambiguous. Accepted on Sonnet 5 and on
        // Opus 5 at the default effort; the Fable/Mythos families that 400 on it
        // are refused above rather than reaching this line.
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: user }],
        tools: [tool],
        // The whole structured-output mechanism: the model MUST call this tool,
        // so the answer arrives as schema-valid arguments rather than as prose
        // we hope is JSON.
        tool_choice: { type: "tool", name: tool.name },
        // No `temperature`: removed on Sonnet 5 / Opus 4.7+ (400 if sent).
      });

      const usage = anthropicUsageOf(message);
      const toolUse = message.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === tool.name
      );
      if (!toolUse) {
        // Distinguishable in the run log from "returned an unparseable answer":
        // a refusal is a policy stop, not a transport failure, and both leave
        // the caller on its existing empty-content fail-open path.
        if (message.stop_reason === "refusal") {
          console.warn(
            `  ${seat}: ${model} refused the request (stop_reason=refusal) — no verdicts returned.`
          );
        }
        return { ...usage, content: null, inTok: usage.tokensIn ?? 0, outTok: usage.tokensOut ?? 0 };
      }
      return {
        ...usage,
        content: JSON.stringify(toolUse.input),
        inTok: usage.tokensIn ?? 0,
        outTok: usage.tokensOut ?? 0,
      };
    },
  };
}
