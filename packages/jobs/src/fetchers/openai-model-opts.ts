// gpt-5.6 family (sol/terra/luna, GA 2026-07-09) 400s (`unsupported_value`) on any
// explicit `temperature` != 1, its default. Every curator/summary call pins a
// non-default temperature for determinism or voice — a bare model-string swap to
// 5.6 breaks them. Omit the param for 5.6 models; older models keep their pinned
// value unchanged (behavior-preserving for every call site's current default).
//
// 2026-09-26 wave 0 (skylark-site docs/model-audit-2026-09-26.md): gpt-6-* (sol, luna, astra,
// future) 400 on ANY explicit temperature too, and an OMITTED reasoning effort on gpt-6 = medium,
// which spent whole token budgets reasoning (empty output) in the audit. Every OpenAI call in this
// package spreads temperatureOpt, so on gpt-6 it carries the fleet default effort `low` instead of
// a temperature — no gpt-6 request leaves here without an effort. gpt-5.6 / older: unchanged.
export function isGpt6Model(model: string): boolean {
  return /^gpt-6/.test(model);
}
export function temperatureOpt(
  model: string,
  value: number
): { temperature: number } | { reasoning_effort: "low" } | Record<string, never> {
  if (isGpt6Model(model)) return { reasoning_effort: "low" };
  return model.startsWith("gpt-5.6") ? {} : { temperature: value };
}

// Vendored (not imported — the GH Actions checkout only has this repo, per the
// "vendor, don't cross-repo import" gotcha) subset of skylark-site's canonical
// cc-llm-pricing.ts, just the models this project calls. $/Mtok. Keep in sync by
// hand if either table changes. Fixes a pre-existing bug: the old cost logger used
// one hardcoded blended rate ($0.25/$2.00, close to nothing we actually call) across
// all 3 passes regardless of their real per-role model — under-reporting spend since
// before the W-005 Pass-A re-tier even existed.
//
// SYNCED 2026-08-02 against skylark-site/src/lib/cc-llm-pricing.ts (B-019). A
// hand-synced table never receives an upstream change: terra and luna were repriced
// 2026-07-30 and this copy carried the old rates for three days, making every cost
// figure logged in that window ~22% high. The date above is the sync receipt — if it
// is old and a reprice has happened, this table is wrong and nothing will say so.
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  // gpt-6 short-context list rates, read live at developers.openai.com/api/docs/pricing
  // 2026-09-26; no dated snapshot. >272K input bills sol $4/$15, luna $0.20/$0.75.
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  // Anthropic. Present because the judge seats gained a NATIVE Anthropic path
  // 2026-09-06 and are meant to be re-pointed here (a judge belongs in a
  // different model family from the writer it grades — model-registry-standard
  // § 8). The row goes in BEFORE the override, not after: a model the table
  // cannot price costs $0.0000 in every comparison it appears in, which is
  // exactly how a re-tier reads as free. Rate from skylark-site's
  // cc-llm-pricing.ts as of 2026-09-06 ($2/$10 per Mtok).
  "claude-sonnet-5": { input: 2, output: 10 },
};

// Returns null — NOT 0 — for a model absent from the table. A cost instrument whose
// failure mode is "free" is worse than no instrument: a model swap to an untabled id
// would silently report $0.0000 and read as a win. null forces the caller to say
// "unknown". (KP-78: the instrument must be able to fail out loud.)
export function estimateCostUsd(model: string, inTok: number, outTok: number): number | null {
  const rate = PRICING[model];
  if (!rate) {
    console.warn(`  ⚠ unpriced model "${model}" — cost not estimable; add it to PRICING in openai-model-opts.ts`);
    return null;
  }
  return (inTok * rate.input + outTok * rate.output) / 1e6;
}

// ponytail: one formatter rather than a null-check at each of the four print sites.
export function fmtCostUsd(cost: number | null): string {
  return cost === null ? "unknown" : `$${cost.toFixed(4)}`;
}
