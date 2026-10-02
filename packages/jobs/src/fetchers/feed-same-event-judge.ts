/**
 * B-022 — LLM same-event judge for the GRAY BAND below CROSS_RUN_EVENT_THRESHOLD.
 *
 * WHY THIS IS NOT THE JUDGE THE CODEBASE ALREADY DOCUMENTED. The comment on
 * CROSS_RUN_EVENT_THRESHOLD proposes "an LLM same-event-vs-new-development judge on the
 * ~40 candidates that trip this filter" — a judge over the COLLAPSED set, i.e. pairs the
 * deterministic guard already dropped. That judge answers R-036/B-016: a genuine
 * FOLLOW-UP wrongly suppressed. It cannot close B-022, which is the opposite defect —
 * duplicates wrongly KEPT — and measurement says so: on the 2026-08-03 front door
 * (118 cards / 6,903 pairs) the collapsed set was **0 pairs** while **32 pairs** sat in
 * 0.20..0.364, below the calibration floor. A judge over the collapsed set would have
 * been handed an empty list and changed nothing.
 *
 * So this judge runs BELOW the threshold, on pairs the guard decided to KEEP.
 *
 * DIRECTION OF ERROR — deliberately refute-only, same as Pass B/C. It only ever sees
 * pairs that ship today, so it can only SUBTRACT; silence, a parse miss, or uncertainty
 * keeps both cards and reproduces current behavior exactly. That matters because the
 * band's own top scorer is a FALSE positive: Haslam's $25M Cleveland Clinic and $130M
 * Tennessee gifts score 0.3333 and are two genuinely different gifts. A judge that
 * guessed SAME on doubt would delete a real receipt to remove a repeat — the same
 * asymmetry isPlausiblyOwnFoundation() resolves the same way.
 *
 * Fail-open like its siblings, with an EXPLICIT failedOpen flag: "asked and could not
 * answer" must stay distinguishable from "nothing to check", or the alarm fires on
 * healthy empty days and gets muted (the 2026-07-31 if-ran-with-no-else lesson).
 *
 * KNOWN FALSE-NEGATIVE CLASS, human-labelled 2026-08-03 — a MULTI-STAGE RUNNING STORY.
 * The owner ruled these two the same event; the judge called them DIFFERENT on two separate
 * runs (Jaccard 0.267):
 *   "Buffett Ends Gates Foundation Donations After Two Decades..."      (2026-08-01)
 *   "Buffett discusses Gates Foundation donations, Epstein regret..."   (2026-07-29)
 * and a third card sits in the same story at 2026-07-11 ("reportedly skips ... during
 * Epstein-related review"). The prompt's "a later DEVELOPMENT is NOT the same event" rule
 * is what produces this, and that rule is also what correctly separates the Haslam gifts —
 * so the two pull against each other and the miss is the deliberate cost of the catch.
 *
 * DO NOT prompt-tune at this example. The Haslam separation ($25M Cleveland Clinic vs
 * $130M Tennessee, 0.3333, a FALSE positive outranking two TRUE ones) is what a tune here
 * would risk, and tuning-on-the-motivating-case is the shape that has been wrong five
 * times in this repo. A real fix needs a labelled set with BOTH classes in it, evaluated
 * out-of-sample — see B-016, which carries this as the running-story ceiling.
 *
 * NOTE FOR ANY CLEANUP THAT USES THIS: `dedupe:feed` keeps the EARLIEST card per cluster,
 * which is wrong for a running story — the early card is provisional ("reportedly skips")
 * and the late one is resolved ("Ends ... After Two Decades"). Deleting by that rule would
 * have removed the strongest receipt. Pick the survivor by hand when the cluster is a
 * developing story, and say so.
 */

import type OpenAI from "openai";
import { eventSignature, jaccardScore, CROSS_RUN_EVENT_THRESHOLD } from "./feed-event-dedup";
import { temperatureOpt } from "./openai-model-opts";
import { postLlmCall, usageOf } from "./llm-call-log";
// Native Anthropic branch (2026-09-06). The registry can re-point this seat to a
// claude-* model; this package speaks OpenAI, so without a second NATIVE client
// that override would send a Claude id to api.openai.com. Not a router: the
// OpenAI call below is untouched and the branch is chosen by the model string.
import { createAnthropicJudge, isAnthropicModel, verdictTool } from "../anthropic-judge";

/**
 * Bottom of the band the judge is asked about. Sized from the 2026-08-03 front-door
 * measurement, where the lowest TRUE duplicates sit at 0.250 (Buffett/Gates,
 * Pritzker/AI) — 0.20 clears them with margin while keeping the ask bounded (32 of
 * 6,903 pairs = 0.46%). Lower it and the ask grows quadratically for pairs that share
 * little more than a surname; there is no evidence of true duplicates below 0.25 yet.
 */
export const GRAY_BAND_FLOOR = 0.2;

export type CandidatePair = {
  /** Index into the caller's own list — the caller decides what it identifies. */
  index: number;
  a: string;
  b: string;
  score: number;
};

export type JudgeResult = {
  /** Indices of pairs the judge affirmatively called the SAME event. */
  duplicate: Set<number>;
  reasons: Map<number, string>;
  inTok: number;
  outTok: number;
  /** True once a verdict list was actually parsed. */
  ran: boolean;
  /** True when the judge was ASKED and could not answer — distinct from ran=false. */
  failedOpen: boolean;
};

const SYSTEM_PROMPT = `You are a news-desk duplicate checker. You are given pairs of headlines that a word-overlap filter could not separate, and you decide whether each pair reports the SAME underlying news event.

SAME event = one action by the same actor(s) at the same time, covered twice: two outlets on one announcement, or one story restated in different words.

NOT the same event:
- A later DEVELOPMENT in a running story (a resumption, a reversal, a new ruling, a new stage).
- Two DIFFERENT actions by the same person — different gifts, different recipients, different amounts, different lawsuits.
- A person appearing in two stories that merely share a topic.

Operational test: could both headlines run as separate stories in the same feed without a reader noticing they were told the same thing twice? If yes, they are DIFFERENT.

Default to DIFFERENT. Answer SAME only when you are confident. A wrong SAME deletes a real story; a wrong DIFFERENT only leaves today's behaviour unchanged.

Return JSON: {"verdicts":[{"index":<number>,"verdict":"SAME"|"DIFFERENT","reason":"<short>"}]}`;

/**
 * The Anthropic branch's structured-output contract — the SAME shape the system
 * prompt above asks for, expressed as a forced tool's JSON Schema because
 * Anthropic has no `response_format`. `parseSameVerdicts` reads the result
 * without knowing which branch produced it.
 */
const SAME_EVENT_TOOL = verdictTool({
  name: "record_same_event_verdicts",
  description: "Record one SAME/DIFFERENT verdict per headline pair you were given.",
  envelope: "verdicts",
  key: "index",
  keyType: "integer",
  keyDescription: "The bracketed index of the pair, exactly as it was given to you.",
  verdicts: ["SAME", "DIFFERENT"],
});

/**
 * Pure: which (candidate, published) pairs land in the gray band and should be asked
 * about. Returns at most one entry per candidate — its BEST-scoring published match,
 * because the question is "is this candidate a repeat of something live?", not "rank
 * every near-neighbour." Keeps the ask linear in candidates, not quadratic.
 */
export function grayBandMatches(
  candidateTitles: string[],
  publishedHeadlines: string[],
  floor = GRAY_BAND_FLOOR,
  ceiling = CROSS_RUN_EVENT_THRESHOLD
  // ⚠ B-040 — DO NOT add a maxPerCandidate parameter here without fixing judgeSameEvent's
  // ADDRESSING in the same commit. This function returning at most ONE pair per candidate is
  // what makes `p.index` a unique label, and judgeSameEvent prints exactly that as `[${p.index}]`
  // for the model to echo back. Let one candidate carry two pairs and the prompt prints `[3]`
  // twice; the two verdicts for "3" collide in the parse, one silently wins, and the other pair
  // reads as never-asked — in the seat that exists to tell asked-and-cleared from never-asked.
  // The fix (label by array POSITION, translate to candidate index inside judgeSameEvent) is
  // written out on B-040. Raising K was ALSO refuted as a fix for the 2026-09-05 duplicates:
  // the run logs show Pass D asked about the right pairs and the judge cleared them, so reach
  // was never the defect. There is currently no reason to raise K at all.
): CandidatePair[] {
  const pubSigs = publishedHeadlines.map(eventSignature);
  const out: CandidatePair[] = [];
  candidateTitles.forEach((title, index) => {
    const sig = eventSignature(title);
    let best = -1;
    let bestScore = 0;
    pubSigs.forEach((ps, j) => {
      const s = jaccardScore(sig, ps);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    });
    if (best >= 0 && bestScore >= floor && bestScore < ceiling) {
      out.push({ index, a: title, b: publishedHeadlines[best], score: bestScore });
    }
  });
  return out;
}

/**
 * Pure: map indices returned against a FILTERED subset back onto the caller's original
 * indices. Trivial arithmetic guarding a silent hazard — Pass D (B-023) scores only the
 * cards still standing after Passes B/C/attribution, so every index `grayBandMatches()`
 * hands back is an index into that subset. Applying one of those to the unfiltered list
 * drops a DIFFERENT, innocent card, and nothing downstream would say so: the run log would
 * name the duplicate it meant to drop while the feed lost its neighbour.
 */
export function remapToOriginal(localIndices: Iterable<number>, originals: number[]): number[] {
  const out: number[] = [];
  for (const i of localIndices) {
    const original = originals[i];
    if (original !== undefined) out.push(original);
  }
  return out;
}

/**
 * Pure: pull SAME verdicts out of the model's JSON. Tolerates both a bare array and the
 * documented {verdicts:[...]} envelope, mirroring how Pass B/C read their responses.
 * Anything that is not an explicit SAME is a keep.
 */
export function parseSameVerdicts(content: string): { duplicate: Set<number>; reasons: Map<number, string> } {
  const duplicate = new Set<number>();
  const reasons = new Map<number, string>();
  const parsed = JSON.parse(content);
  const list: unknown = Array.isArray(parsed)
    ? parsed
    : Object.values(parsed).find((v) => Array.isArray(v)) || [];
  for (const v of list as Array<{ index?: unknown; verdict?: unknown; reason?: unknown }>) {
    if (typeof v.index !== "number") continue;
    if (String(v.verdict).toUpperCase() === "SAME") {
      duplicate.add(v.index);
      reasons.set(v.index, typeof v.reason === "string" ? v.reason : "same event");
    }
  }
  return { duplicate, reasons };
}

/**
 * Ask the judge about a bounded set of gray-band pairs. Fail-open.
 *
 * `callSite` is the portfolio LLM-log grouping key. It is a PARAMETER because
 * five callers share this one seat — the curator's B-022 candidate pass and
 * B-023 rewrite pass, dedupe-feed-items, probe-b022-frontdoor and the
 * backtest — and merging their spend into one label would hide which of them
 * costs anything and let harness dollars masquerade as production dollars.
 * The default names the function, so a future caller that forgets is still
 * logged, just coarsely.
 */
export async function judgeSameEvent(
  pairs: CandidatePair[],
  openai: OpenAI,
  model: string,
  callSite = "feed-same-event-judge:unattributed",
  logExtra?: Record<string, unknown>
): Promise<JudgeResult> {
  const result: JudgeResult = {
    duplicate: new Set(),
    reasons: new Map(),
    inTok: 0,
    outTok: 0,
    ran: false,
    failedOpen: false,
  };
  if (pairs.length === 0) return result;

  const body = pairs
    .map((p) => `[${p.index}]\n  A (new): "${p.a}"\n  B (already published): "${p.b}"`)
    .join("\n\n");
  const userPrompt = `Judge these ${pairs.length} headline pairs. For each index, is A the same news event as B?\n\n${body}`;

  // The log row is emitted on EVERY exit from this seat, including the two
  // fail-open paths. A judge that fails open costs the same dollars and, more
  // to the point, a log that only records successes cannot answer "how often
  // does this seat silently stop judging" — which is the failure this seat has.
  const startedAt = Date.now();
  let usage: ReturnType<typeof usageOf> = {};
  let logged = false;
  const log = (taskStatus: string) => {
    if (logged) return;
    logged = true;
    postLlmCall({
      model,
      callSite,
      taskStatus,
      ...usage,
      latencyMs: Date.now() - startedAt,
      extra: { ...logExtra, pairs: pairs.length },
    });
  };

  try {
    let content: string | null | undefined;
    if (isAnthropicModel(model)) {
      // `callSite` IS the registry seat name for every real caller, so the
      // refusal message names the seat the log row will carry.
      const judge = createAnthropicJudge(callSite, model);
      const answer = await judge.judge({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 2000,
        tool: SAME_EVENT_TOOL,
      });
      usage = {
        tokensIn: answer.tokensIn,
        tokensOut: answer.tokensOut,
        cachedInputTokens: answer.cachedInputTokens,
      };
      result.inTok = answer.inTok;
      result.outTok = answer.outTok;
      content = answer.content;
    } else {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
        ...temperatureOpt(model, 0),
      });

      usage = usageOf(response);
      result.inTok = response.usage?.prompt_tokens || 0;
      result.outTok = response.usage?.completion_tokens || 0;

      content = response.choices[0]?.message?.content;
    }
    if (!content) {
      console.warn("  Same-event judge returned no content — failing open (nothing dropped).");
      result.failedOpen = true;
      log("empty_content");
      return result;
    }

    const { duplicate, reasons } = parseSameVerdicts(content);
    result.duplicate = duplicate;
    result.reasons = reasons;
    result.ran = true;
    log("ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  Same-event judge failed (${msg}) — failing open (nothing dropped).`);
    result.failedOpen = true;
    // Reached either from the API call (usage unknown, stays absent — never 0)
    // or from parseSameVerdicts (usage known and already captured).
    log("fail");
  }

  return result;
}
