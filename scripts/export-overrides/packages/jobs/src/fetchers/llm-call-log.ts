/**
 * Optional LLM-call log: posts one row per vendor model call to an HTTP sink
 * you run yourself, so per-seat cost and failure rates can be read later.
 *
 * OFF BY DEFAULT. Nothing is sent unless `LLM_CALL_LOG_URL` is set to the
 * endpoint that should receive the rows. There is no built-in destination.
 * `LLM_CALL_LOG_PIN` is optional; when set it is included in the body as
 * `pin`, for sinks that authenticate that way. `LLM_CALL_LOG_DISABLED=1`
 * turns logging off even when the URL is set.
 *
 * What a row contains: the project slug, model id, a stable call-site label,
 * a task status, token counts and latency when the provider reported them,
 * and an optional `extra` object. No prompt or response text is sent.
 *
 * FAIL-SOFT IS THE WHOLE CONTRACT. Observability never fails a product call:
 * every post is fire-and-forget with its own abort timeout, and every failure
 * path swallows. A logging outage must reproduce the unlogged behaviour exactly.
 *
 * WHY `flushLlmLogs()` EXISTS AND WHY OMITTING IT IS SILENT. These are batch
 * jobs, not a server. `feed-curator.ts` ends `main()` with `process.exit(...)`
 * and `profile-summary.ts` with `process.exit(0)` — a hard exit KILLS every
 * in-flight fetch with no error anywhere. Every entrypoint that logs MUST
 * `await flushLlmLogs()` immediately before it exits, and the flush is bounded
 * so a hung sink can never hold a job open.
 *
 * SEAT NAMING. `callSite` is the grouping key, so it is one stable label per
 * model seat, never per file. Shared helpers take the label from their caller
 * so production spend and test-harness spend never merge into one number;
 * harness calls carry `extra.harness: true`.
 */

/** Bound on one post. A batch job must never wait on a wedged sink. */
const POST_TIMEOUT_MS = 8000;

export type LlmCallRow = {
  /** Model id AS BILLED by the provider. */
  model: string;
  /** Stable per-seat grouping label. */
  callSite: string;
  /** "ok" | "fail" | "empty_content" | ... — /^[a-z0-9_-]{1,32}$/i. */
  taskStatus: string;
  tokensIn?: number;
  tokensOut?: number;
  /**
   * OpenAI: the cached slice of prompt_tokens (prompt_tokens INCLUDES it).
   * Omit rather than send 0 when the provider did not report it — absent means
   * "not reported" and stays NULL; 0 claims we looked and found none.
   */
  cachedInputTokens?: number;
  latencyMs?: number;
  extra?: Record<string, unknown>;
};

type Env = Record<string, string | undefined>;

/** The configured sink, or null when logging is not configured. */
export function llmLogEndpoint(env: Env = process.env): string | null {
  const url = env.LLM_CALL_LOG_URL?.trim();
  return url ? url : null;
}

/**
 * Logging runs only when a sink is configured, the kill switch is unset, and
 * no test runner is active. The test-runner guard keeps a local `npm test`
 * from posting fixture rows to a real sink: `NODE_TEST_CONTEXT` is set by
 * node:test (which `npm test` runs via `tsx --test`), `VITEST` by vitest.
 */
export function shouldPostLlmLog(env: Env = process.env): boolean {
  if (env.LLM_CALL_LOG_DISABLED) return false;
  if (env.NODE_TEST_CONTEXT || env.VITEST) return false;
  return llmLogEndpoint(env) !== null;
}

/**
 * Pure: the exact JSON the sink receives. Separated from the fetch so the
 * field shape is testable without a network call.
 * Undefined numeric fields are OMITTED, never coerced to 0.
 */
export function buildLlmLogBody(row: LlmCallRow, pin?: string): string {
  const body: Record<string, unknown> = {
    project: "billionaire-army",
    model: row.model,
    callSite: row.callSite,
    taskStatus: row.taskStatus,
  };
  if (pin) body.pin = pin;
  if (row.tokensIn !== undefined) body.tokensIn = row.tokensIn;
  if (row.tokensOut !== undefined) body.tokensOut = row.tokensOut;
  if (row.cachedInputTokens !== undefined) body.cachedInputTokens = row.cachedInputTokens;
  if (row.latencyMs !== undefined) body.latencyMs = row.latencyMs;
  if (row.extra) body.extra = row.extra;
  return JSON.stringify(body);
}

/**
 * Pure: pull the billed token classes out of an OpenAI chat-completions
 * response. Returns undefined per field when the provider did not report it,
 * so "not reported" never renders as a confident zero.
 *
 * `usage` is typed loosely on purpose — `prompt_tokens_details` is present on
 * the wire but has drifted across SDK majors, and a compile break here would
 * take the product call down with it.
 */
export function usageOf(response: unknown): {
  tokensIn?: number;
  tokensOut?: number;
  cachedInputTokens?: number;
} {
  const u = (response as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u) return {};
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const details = u.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
  return {
    tokensIn: num(u.prompt_tokens),
    tokensOut: num(u.completion_tokens),
    cachedInputTokens: num(details?.cached_tokens),
  };
}

const pending = new Set<Promise<void>>();

/** How many posts are still in flight. Test seam / diagnostics only. */
export function pendingLlmLogCount(): number {
  return pending.size;
}

/**
 * Queue one row. Never throws, never awaits, never blocks the caller.
 * Call `flushLlmLogs()` before the process exits or the row is lost.
 */
export function postLlmCall(row: LlmCallRow, env: Env = process.env): void {
  if (!shouldPostLlmLog(env)) return;
  const url = llmLogEndpoint(env);
  if (!url) return;
  let body: string;
  try {
    body = buildLlmLogBody(row, env.LLM_CALL_LOG_PIN || undefined);
  } catch {
    return; // an unserializable `extra` must not take the run down
  }
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      pending.delete(p);
    });
  pending.add(p);
}

/**
 * Await every queued post. MUST be called before `process.exit` in any
 * entrypoint that logs. Never throws; bounded by each post's own abort
 * timeout, so the worst case is POST_TIMEOUT_MS.
 */
export async function flushLlmLogs(): Promise<void> {
  if (pending.size === 0) return;
  await Promise.allSettled([...pending]);
}
