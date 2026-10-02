/**
 * Feed Curator (per-role models — every model string now lives in
 * `model-seats.json` at the repo root and is read through `resolveSeat()`;
 * CURATOR_MODEL / CURATOR_VERIFIER_MODEL / CURATOR_FAITHFULNESS_MODEL survive as
 * each seat's `legacyEnv` and still win, so the scheduled GH Actions run keeps
 * setting Pass A to gpt-5.6-terra exactly as it has since the 2026-07-10
 * model-audit wave. What changed 2026-09-06 is that the FILE now says terra too,
 * instead of claiming gpt-5.4-mini while production ran something else.)
 *
 * Reads raw news articles from person_facts (GDELT + NewsAPI), enriches them with
 * platform context data (PBS scores, FEC, 990s, net worth), and curates polished
 * feed items with the platform's editorial voice.
 *
 * The feed voice is "friendly engineer" — warm, grounded, gently skeptical.
 * Facts only, no opinions. Context does the editorial work.
 *
 * Usage: npm run curate:feed (or: npx tsx src/fetchers/feed-curator.ts)
 * Requires: OPENAI_API_KEY environment variable
 */

import OpenAI from "openai";
import { createDb, persons, personFacts, feedItems, feedItemPersons, scoreSnapshots, curatorPassedOver } from "@ba/db";
import { and, eq, inArray, desc, sql, gte } from "drizzle-orm";
import { CROSS_RUN_EVENT_THRESHOLD, eventSignature, jaccardScore, sameEvent } from "./feed-event-dedup";
import { GRAY_BAND_FLOOR, grayBandMatches, judgeSameEvent, remapToOriginal, type CandidatePair } from "./feed-same-event-judge";
// accountabilityScore + credibilityTier live in @ba/shared (moved 2026-07-25,
// R-040) because the API's DISPLAY ranking scores cards with the same signals
// the curator uses for SELECTION — one calibration, two call sites.
import { accountabilityScore, credibilityTier, foundationAssetsChip, sourceLabel, isFecRecordImpossible, formatCurrency, readerFacingScorePhrase, GIVING_EVIDENCE_FACT_KEYS, gradeStatus } from "@ba/shared";
// Candidate-layer kind read + the soft same-kind demotion it feeds (R-048, 2026-09-07).
// Same @ba/shared home as accountabilityScore and eventSignature, for the same reason:
// one calibration, no second copy in packages/jobs.
import {
  candidateKind,
  kindMix,
  formatKindMix,
  diversifyByKind,
  distinctKindsInWindow,
  DEFAULT_KIND_SOFT_CAP,
} from "@ba/shared";
import { findAttributionMismatch } from "./feed-attribution-guard";
import { promptLeakDrops } from "./feed-prompt-leak-guard";
import { isDeceased } from "./feed-deceased-filter";
import { cooldownKind, sendTier, refusedCooldownRows, faithfulnessCooldownRows, SOURCE_PASS_A, type CooldownKind } from "./feed-cooldown";
import { auditFaithfulnessDrop } from "./feed-faithfulness-drop-audit";
import { temperatureOpt, estimateCostUsd, fmtCostUsd } from "./openai-model-opts";
// Portfolio LLM-call log (S-20260905-45). The per-run cost line this file
// prints dies with the GH Actions log; these rows are what the model-audit
// cycle can actually read. ⚠ main() ends in process.exit — see flushLlmLogs.
import { postLlmCall, usageOf, flushLlmLogs } from "./llm-call-log";
import { contextReceiptsFor, generatorCandidateBlock, faithfulnessCardBlock } from "./feed-receipt-lines";
import { GENERATOR_SYSTEM_PROMPT, GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING, generatorRequest } from "./feed-generator-prompt";
// Model-registry resolver (portfolio standard, 2026-09-06). `../model-seats`
// reads ../../../model-seats.json at the repo root; every seat below keeps its
// old env var as `legacyEnv`, so the workflow's CURATOR_MODEL still wins.
import { resolveSeat } from "../model-seats";
// Native Anthropic branch for the JUDGE seats (2026-09-06). The registry lets a
// SEAT_*_MODEL override point Pass B / Pass C at claude-sonnet-5 — the standard's
// § 8 rule is that a judge sits in a different model FAMILY from the writer it
// grades, and today both sit on gpt-5.6-terra alongside Pass A. This package had
// only the OpenAI SDK, so that override would have shipped a Claude id to
// api.openai.com. NOT a router: each call site keeps its OpenAI call verbatim and
// gains one sibling branch, selected by the resolved model string.
import { createAnthropicJudge, isAnthropicModel, verdictTool } from "../anthropic-judge";
import { isMain } from "../is-main";

const databaseUrl = process.env.DATABASE_URL;
const openaiKey = process.env.OPENAI_API_KEY;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!openaiKey) { console.error("OPENAI_API_KEY is required"); process.exit(1); }

const db = createDb(databaseUrl);
const openai = new OpenAI({ apiKey: openaiKey });

// Per-role model constants (atomic-ops un-weld, 2026-06-30). Pass A (GENERATOR —
// writes the card voice the reader sees, the would-tell-a-friend payload) and
// Pass B (VERIFIER — a refute-only relevance judge) are SEPARATE cognitive
// operations on independent axes. They run on the same model TODAY, but pinning
// each to its own role constant keeps them un-welded: re-tiering the generator
// (the aha-critical creative op) must NOT silently move the relevance judge — a
// judge-model change moves the verdicts themselves — and a bulk find-replace
// model bump can't weld the two together. Env-overridable so a future re-tier /
// A-B is config, not a code change. Behavior-preserving: the defaults equal the
// prior inline literals, so a run with no env set issues byte-identical calls.
// 2026-09-06: the model STRINGS moved into `model-seats.json` (the owner's inventory
// ruling). Precedence is SEAT_<NAME>_MODEL → the legacy env
// var → the checked-in default, so `CURATOR_MODEL: "gpt-5.6-terra"` in
// .github/workflows/curate-feed.yml still decides Pass A exactly as it did — the
// file default simply stopped lying about what the daily run calls.
const GENERATOR_SEAT = resolveSeat("feed-curator:passA-generator");
const GENERATOR_MODEL = GENERATOR_SEAT.model;
const VERIFIER_SEAT = resolveSeat("feed-curator:passB-relevance-verifier");
const VERIFIER_MODEL = VERIFIER_SEAT.model;
// The same-event judge (B-022 candidate pass, B-023 rewrite pass) is its own
// cognitive seat, and each pass carries its own registry entry because each
// already carries its own call-log label — the registry seat name IS the label,
// or the panel joins nothing. Both share CURATOR_VERIFIER_MODEL as `legacyEnv`,
// so nothing about today's behaviour moves; they can now be re-pointed apart.
const SAME_EVENT_B022_SEAT = resolveSeat("feed-curator:b022-candidate-same-event-judge");
const SAME_EVENT_B023_SEAT = resolveSeat("feed-curator:b023-rewrite-same-event-judge");

// Faithfulness verifier (R9 quality-gate wave, 2026-06-30). A SIBLING refute-only
// pass to Pass B on an INDEPENDENT axis: Pass B judges ENTITY+TOPIC relevance;
// THIS judges whether the rewritten headline/summary is FAITHFUL to its source —
// i.e. every number / attribution / claim / implication traces to the original
// article OR the provided context receipts (net worth, FEC, 990, PBS). The
// generator is explicitly invited to use "dry humor through juxtaposition," which
// can manufacture a false IMPLICATION that the relevance gate happily passes; over
// REAL NAMED billionaires — now crawlable + citeable via the AEO baseline — a wrong
// receipt is both the OPPOSITE of the aha moment and a defamation surface (NOT
// user-count-gated). Kept SEPARATE from Pass B (not a 3rd question) so its
// calibration can't disturb Pass B's verified-correct relevance rejects
// (atomic-ops un-weld discipline). SHADOW-FIRST: defaults to LOG-ONLY (does not
// drop); set CURATOR_FAITHFULNESS_ENFORCE=1 to actually drop unfaithful cards once
// the shadow logs validate the calibration on real cards.
const FAITHFULNESS_SEAT = resolveSeat("feed-curator:passC-faithfulness-verifier");
const FAITHFULNESS_MODEL = FAITHFULNESS_SEAT.model;
const FAITHFULNESS_ENFORCE = process.env.CURATOR_FAITHFULNESS_ENFORCE === "1";
// B-023 write-time dedup (Pass D). SHADOW by default — it logs what it WOULD drop and
// publishes everything until this is 1. A wrong SAME deletes a real story, so the
// false-positive cost is measured on real runs before it is allowed to act.
const REWRITE_DEDUP_ENFORCE = process.env.CURATOR_REWRITE_DEDUP_ENFORCE === "1";

// Ingest-recency cap (R-037, owner-ruled 2026-07-20). GDELT's stalest-first rotation
// re-serves the SAME article 15-45+ days after publication (measured 2026-07-20: 47% of
// the 1,096-article candidate pool was >30d old). Because /feed sorts publishedAt desc,
// those stale re-serves BURIED that day's freshly-curated cards below the fold (6 fresh
// cards landed at feed positions 1/24/48/67/68/87 of ~104), AND they fed the cross-run
// dedup churn. Dropping too-old articles AT INGEST — before dedup/pre-rank/selection —
// fixes both at the source. 14d keeps ~352 articles (measured), far above the ~20 a run
// selects, so supply is not at risk; the drop count is logged so a thin day is visible,
// not silent. Env-overridable to widen on a genuinely thin day without a redeploy.
// This is a SIBLING to the 45d cross-run dedup window, NOT a replacement — leave that
// window alone (it still guards same-event different-article dupes inside 14d).
const MAX_INGEST_AGE_DAYS = Number(process.env.CURATOR_MAX_INGEST_AGE_DAYS) || 14;
// R-048 passed-over cooldown. 14d is deliberately SHORTER than the 45d dedup window:
// that window guards an event we PUBLISHED, where a second card is pure duplication,
// while this one holds down an event we merely declined, which can legitimately become
// news later (an investigation opens, a number gets confirmed). Long enough to break
// the daily re-serve loop, short enough that a developing story comes back.
const COOLDOWN_DAYS = Number(process.env.CURATOR_COOLDOWN_DAYS) || 14;
// R-048 kind-mix soft cap (2026-09-07). How many candidates of ONE accountability kind
// may sit in the shortlist before the rest of that kind are demoted behind the others.
// A REORDER, never a drop — see feed-kind-diversity.ts for why soft rather than a hard
// per-run cap (a hard cap starves the shortlist on a genuinely monocultural news day and
// turns a variety problem into a supply problem). Env-overridable so a thin day can be
// widened without a redeploy. Set to 0 or a negative value to disable the reorder
// entirely and restore the prior ordering exactly — the revert path, no code change.
const KIND_SOFT_CAP = Number(process.env.CURATOR_KIND_SOFT_CAP ?? DEFAULT_KIND_SOFT_CAP);

// GPT-5.6 model-audit wave (2026-07-10). Two independent knobs, both off by default:
// - CURATOR_DRY_RUN=1 runs the full real pipeline (candidates, pre-rank, both
//   verifiers) but skips the DB insert — for local A-B/shadow evals against real
//   data with zero prod side effects.
// - CURATOR_SHADOW_VERIFIER_MODEL / CURATOR_SHADOW_FAITHFULNESS_MODEL, if set, run
//   a SECOND judge pass with that model on the SAME cards purely for comparison
//   logging (agreement/disagreement) — never affects which cards are dropped. This
//   is the mechanism for judge-seat shadow evals (the owner's "better judge" hypothesis)
//   without touching the live VERIFIER_MODEL/FAITHFULNESS_MODEL.
const CURATOR_DRY_RUN = process.env.CURATOR_DRY_RUN === "1";
const SHADOW_VERIFIER_MODEL = process.env.CURATOR_SHADOW_VERIFIER_MODEL;
const SHADOW_FAITHFULNESS_MODEL = process.env.CURATOR_SHADOW_FAITHFULNESS_MODEL;

// Pass A's system prompt lives in feed-generator-prompt.ts (side-effect-free, so its test reads
// the EMITTED text). GROUNDING rule + the dry-run A/B baseline: see that module's header.
const SYSTEM_PROMPT = GENERATOR_SYSTEM_PROMPT;

// Pass B — adversarial relevance verifier. A SEPARATE call on an independent
// axis: it does NOT select, rewrite, or weigh newsworthiness — its only job is
// to REFUTE, catching the false positives the single selecting pass let through
// (a billionaire who is only a namesake / a ship-building-stadium that shares
// the name / a bystander in a sports-gossip item). The selecting model (Pass A)
// optimizes for "newsworthy + diverse," so its relevance gate competes with that
// objective in one head and confident collisions sail through — e.g. the live
// "USS Gerald R. Ford carrier collision" card with billionaire Gerald Ford's
// 990 receipt appended (~6/50 such cards, B-004, caught only by a human audit).
// Splitting refutation into its own pass with its own framing is the fix; piling
// more rules into Pass A's gate "felt like progress" but stayed one pass.
const VERIFIER_SYSTEM_PROMPT = `You are a relevance auditor for Billionaire Army, a civic accountability platform. Another model has ALREADY selected and rewritten these feed cards — you are NOT selecting, ranking, or rewriting. Your ONLY job is to catch false positives before they reach readers.

For each card, answer TWO questions:
1. ENTITY — is THIS billionaire the grammatical SUBJECT of the story, or only an incidental name match?
2. TOPIC — even if they are the subject, is the story substantively about their MONEY, GIVING, POLITICAL SPENDING, or WEALTH-DERIVED POWER (what a civic-accountability reader cares about)?

REJECT when EITHER fails:
- ENTITY fails — the named billionaire is:
  - A name collision: a ship, building, stadium, place, team, product, or unrelated person sharing the name (a US Navy carrier or a US president named "Ford" is NOT the billionaire Gerald Ford).
  - A namesake institution / naming rights: "<Name> Field/Center/Hospital/Library" — the venue is not the person.
  - A bystander in a sports / entertainment / gossip item: a player's contract, a movie, an ex-spouse, a red-carpet appearance, an obituary of someone else.
- TOPIC fails — the billionaire is the subject but the story is CLEARLY off-axis (not about money/giving/political-spending/wealth-derived power):
  - A commencement or conference speech with no policy-or-giving substance.
  - A stock pick, market call, endorsement, or earnings/IPO-hype item — finance news, not accountability.
  - A geopolitical or electoral story where they merely feature as a player or commentator.
  - A product launch or routine corporate operations (layoffs, reorg) with no wealth/power angle.

Rules:
- ENTITY: default to REJECT when uncertain — a wrong receipt is worse than a missing one; it destroys credibility.
- TOPIC: reject ONLY when the story is CLEARLY off-axis. KEEP borderline cases so the feed is not starved.
- Use the ORIGINAL article title and excerpt to decide; a polished rewrite can hide a collision or an off-topic story.
- Start each reason with "ENTITY:" or "TOPIC:" so the rejection reason is legible.

Return JSON: { "verdicts": [ { "index": 0, "verdict": "KEEP", "reason": "short phrase" } ] } — one entry per card, echoing the index you were given.`;

// Pass C — faithfulness auditor (R9). Judges ONLY whether the rewrite invents
// facts; relevance/newsworthiness/voice are out of scope (Pass B owns relevance).
const FAITHFULNESS_SYSTEM_PROMPT = `You are a faithfulness auditor for Billionaire Army, a civic accountability platform. Another model rewrote each news article into a polished feed card (headline + summary) and was allowed to weave in provided context data (net worth, political donations, foundation assets, the platform's own giving grade). You are NOT judging relevance, newsworthiness, or writing quality — ONLY faithfulness to the source.

For each card, REJECT if the rewritten headline or summary contains ANY claim, number, dollar figure, attribution, quote, or implication NOT supported by EITHER (a) the original article title/excerpt OR (b) the provided context data for that billionaire. Specifically reject:
- A dollar amount, net worth, donation total, or foundation figure that does not match — or is absent from — the source and the provided context.
- A causal or wrongdoing claim ("funded", "bribed", "donated to X", "under investigation", "to influence") that the source does not state.
- A misleading juxtaposition that asserts or strongly implies a connection the source does not make (e.g. pairing an unrelated receipt with the story to imply impropriety).
- An action or intent attributed to the billionaire that the source attributes to someone else, or does not state.

KEEP cards whose every factual claim and number is traceable to the source article or the provided context. Faithful framing and dry tone are fine — judge FACTS, not voice.

What counts as supported (R9 backtest calibration, 2026-06-30): the ORIGINAL article title + excerpt and the provided context receipts ARE the source of truth. A claim that PARAPHRASES or restates the article (a name, role, event, or figure that appears in its title/body) is GROUNDED — do not reject faithful paraphrase. Ignore cosmetic citation labels; judge the factual content, not the tag or phrasing.

Default to REJECT when a number or a wrongdoing claim cannot be traced — for real named people a fabricated receipt is a credibility and legal risk.

Return JSON: { "verdicts": [ { "index": 0, "verdict": "KEEP", "reason": "short phrase" } ] } — one entry per card, echoing the index you were given. Start each REJECT reason with the unsupported element (e.g. "$2.4M figure not in source").`;

// The Anthropic branch's structured-output contract for Pass B and Pass C — the
// SAME shape the two prompts above already ask for, expressed as a forced tool's
// JSON Schema because Anthropic has no `response_format`. One spec serves both
// because both judges answer KEEP/REJECT per card index; the tool NAME differs so
// a run log can still tell the two calls apart.
const RELEVANCE_TOOL = verdictTool({
  name: "record_relevance_verdicts",
  description: "Record one KEEP/REJECT subject-relevance verdict per feed card you were given.",
  envelope: "verdicts",
  key: "index",
  keyType: "integer",
  keyDescription: "The bracketed index of the card, exactly as it was given to you.",
  verdicts: ["KEEP", "REJECT"],
});
const FAITHFULNESS_TOOL = verdictTool({
  name: "record_faithfulness_verdicts",
  description: "Record one KEEP/REJECT faithfulness verdict per feed card you were given.",
  envelope: "verdicts",
  key: "index",
  keyType: "integer",
  keyDescription: "The bracketed index of the card, exactly as it was given to you.",
  verdicts: ["KEEP", "REJECT"],
});

/**
 * Which environment variable a judge's `model` argument actually came from, for
 * the Anthropic path's missing-key refusal. The shadow A/B callers read
 * `CURATOR_SHADOW_*_MODEL`, so telling them to unset the seat's own
 * `SEAT_<NAME>_MODEL` would be a wrong instruction in the one place a reader is
 * already confused about which of two models is running.
 */
function overrideVarFor(modelSource: string, shadowVar: string): string | undefined {
  return modelSource === "shadow-env" ? shadowVar : undefined;
}

interface RawArticle {
  title: string;
  url: string;
  source: string;
  date: string;
  body?: string;
}

interface Candidate {
  article: RawArticle;
  personId: string;
  personName: string;
  context: {
    netWorth: string | null;
    pbs: string | null;
    political: string | null;
    philanthropy: string | null;
  };
}

interface CuratedItem {
  candidate_index: number;
  headline: string;
  summary: string;
  category: string;
  curation_score: number;
}

interface Verdict {
  index: number;
  verdict: string;
  reason?: string;
}

interface VerifierResult {
  rejected: Set<number>;
  reasons: Map<number, string>;
  inTok: number;
  outTok: number;
  ran: boolean;
  /**
   * TRUE only when the judge was asked and could not answer (threw, or returned no
   * content). Distinct from `ran: false`, which is ALSO the legitimate "nothing to
   * check" case — an early return when no card resolved. Without this split, the
   * only honest alarm would have to fire on every empty run too, and a detector that
   * cries wolf on a healthy day gets muted, which is the failure it exists to prevent.
   *
   * WHY IT EXISTS AT ALL: both judges are fail-OPEN by design, and `if (ran)` had no
   * `else` — so a judge that died dropped nothing, printed no verdict line, and left a
   * run that is byte-indistinguishable from a clean one. "0 rejected" and "never asked"
   * read identically in the feed, in the log tail, and in the card count.
   */
  failedOpen: boolean;
}

/**
 * Pass B — run the refute-only relevance verifier over Pass A's selections.
 * Returns the set of curated-item indices to DROP (by position in `curated`).
 * Fail-OPEN: the verifier is a strictly-additive safety net on top of Pass A's
 * existing gate, so a transient verifier failure degrades to today's behavior
 * (insert all) rather than nuking the run — logged loudly so the miss is visible.
 */
async function runRelevanceVerifier(
  curated: CuratedItem[],
  filtered: Candidate[],
  model: string = VERIFIER_MODEL,
  // Where `model` came from, recorded on the log row. The shadow caller passes
  // "shadow-env": its rows share this seat's callSite (they always have), and
  // without this field a shadow row and a production row are indistinguishable
  // in the aggregate — two models under one seat with nothing saying which.
  modelSource: string = VERIFIER_SEAT.source
): Promise<VerifierResult> {
  const result: VerifierResult = {
    rejected: new Set(),
    reasons: new Map(),
    inTok: 0,
    outTok: 0,
    ran: false,
    failedOpen: false,
  };

  // Build one card description per selected item, indexed by position in `curated`.
  // The verifier judges the ORIGINAL article (title/source/excerpt) + billionaire —
  // a polished rewrite can launder a collision, so the source material is what counts.
  const cards = curated
    .map((item, i) => {
      const c = filtered[item.candidate_index];
      if (!c) return null;
      const parts = [
        `[${i}] Billionaire named in card: ${c.personName}`,
        `  Rewritten headline: "${item.headline}"`,
        `  Original article title: "${c.article.title}"`,
        `  Source: ${c.article.source}`,
      ];
      if (c.article.body) parts.push(`  Excerpt: ${c.article.body.slice(0, 300)}...`);
      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  if (!cards) return result;

  const userPrompt = `Audit these ${curated.length} feed cards for subject-relevance. For each index, is the named billionaire the actual subject of an accountability story, or an incidental name match? Return a verdict per index.\n\n${cards}`;

  const startedAt = Date.now();
  let usage: ReturnType<typeof usageOf> = {};
  let logged = false;
  // Logged on every exit including the fail-open paths: a judge that quietly
  // stops judging still bills, and "how often does Pass B fail open" is only
  // answerable if the failures are rows too.
  const log = (taskStatus: string) =>
    logged
      ? undefined
      : ((logged = true),
        postLlmCall({
          model,
          callSite: "feed-curator:passB-relevance-verifier",
          taskStatus,
          ...usage,
          latencyMs: Date.now() - startedAt,
          extra: { cards: curated.length, modelSource },
        }));

  try {
    let content: string | null | undefined;
    if (isAnthropicModel(model)) {
      const judge = createAnthropicJudge("feed-curator:passB-relevance-verifier", model, {
        overrideVar: overrideVarFor(modelSource, "CURATOR_SHADOW_VERIFIER_MODEL"),
      });
      const answer = await judge.judge({
        system: VERIFIER_SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 2000,
        tool: RELEVANCE_TOOL,
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
          { role: "system", content: VERIFIER_SYSTEM_PROMPT },
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
      console.warn("  Relevance verifier returned no content — failing open (no items dropped).");
      result.failedOpen = true;
      log("empty_content");
      return result;
    }

    const parsed = JSON.parse(content);
    const verdicts: Verdict[] = Array.isArray(parsed)
      ? parsed
      : (Object.values(parsed).find((v) => Array.isArray(v)) as Verdict[]) || [];

    for (const v of verdicts) {
      if (typeof v.index !== "number") continue;
      if (String(v.verdict).toUpperCase() === "REJECT") {
        result.rejected.add(v.index);
        result.reasons.set(v.index, v.reason || "incidental/name-collision");
      }
    }
    result.ran = true;
    log("ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  Relevance verifier failed (${msg}) — failing open (no items dropped).`);
    result.failedOpen = true;
    log("fail");
  }

  return result;
}

/**
 * The two things a DROP line needs to be re-adjudicable later, and neither was logged
 * until 2026-08-08.
 *
 * On that day Pass C dropped 5 of 5 cards as unfaithful and the feed published nothing.
 * Proving those were FALSE drops took a hand-written probe against prod, because the log
 * recorded the verdict and threw away the evidence: the DROP lines carried index, person
 * and reason, while the rewritten headline printed ONLY for cards that were ADDED. The
 * artifact needed to re-judge a suspicious drop was discarded at the exact moment we
 * decided it was suspicious.
 *
 * So a drop now prints the CARD, and a faithfulness drop also prints the CONTEXT RECEIPTS
 * the judge was handed — because the whole question in that class is "was the figure it
 * called unsupported actually sitting in the context?" On 8/08 it was, verbatim, all five
 * times. With these two lines that reading comes off the log in seconds instead of a probe.
 *
 * `contextReceiptsFor` is the SINGLE source of that string: the verifier's prompt builds
 * its receipts from this same function, so the log cannot drift from what the judge read.
 * Fork it and the log starts describing a prompt that was never sent.
 */
function droppedCardText(item: CuratedItem | undefined): string {
  if (!item) return "(curated item missing)";
  return `"${item.headline}" / "${item.summary.slice(0, 160)}"`;
}

type GeneratorResult =
  | { kind: "ok"; curated: CuratedItem[]; inTok: number; outTok: number }
  | { kind: "empty" }
  | { kind: "unparseable"; content: string };

/**
 * Pass A — the GENERATOR (selects + rewrites). One function so the live run and the dry-run
 * grounding A/B send the SAME call and differ only in `systemPrompt`.
 */
async function runGenerator(systemPrompt: string, userPrompt: string, candidates: number, callSite = "feed-curator:passA-generator"): Promise<GeneratorResult> {
  const genStartedAt = Date.now();
  const response = await openai.chat.completions.create(generatorRequest(GENERATOR_MODEL, systemPrompt, userPrompt));

  const content = response.choices[0]?.message?.content;
  // Pass A is the GENERATOR — the card voice a reader actually sees. Logged
  // before the empty-content early return, because an empty generation is the
  // most expensive kind of run (full prompt billed, zero cards shipped) and it
  // is exactly the row a cost reader would otherwise never see.
  postLlmCall({
    model: GENERATOR_MODEL,
    callSite,
    taskStatus: content ? "ok" : "empty_content",
    ...usageOf(response),
    latencyMs: Date.now() - genStartedAt,
    extra: { candidates },
  });
  if (!content) return { kind: "empty" };

  const inTok = response.usage?.prompt_tokens || 0;
  const outTok = response.usage?.completion_tokens || 0;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return { kind: "ok", curated: parsed, inTok, outTok };
    // Find the first array value in the response object
    const arrayVal = Object.values(parsed).find((v) => Array.isArray(v));
    return { kind: "ok", curated: (arrayVal as CuratedItem[]) || [], inTok, outTok };
  } catch {
    return { kind: "unparseable", content };
  }
}

/**
 * Pass C — refute-only FAITHFULNESS verifier (R9). Returns the set of curated-item
 * indices whose rewrite contains a claim/number not traceable to the source article
 * or the provided context receipts. Like Pass B it is fail-OPEN (a transient failure
 * drops nothing), and like Pass B it judges the ORIGINAL article + the context the
 * generator was actually given — but its axis is invented-fact, not relevance.
 */
export async function runFaithfulnessVerifier(
  curated: CuratedItem[],
  filtered: Candidate[],
  model: string = FAITHFULNESS_MODEL,
  // See runRelevanceVerifier: the shadow caller passes "shadow-env" so its rows
  // stay separable from production rows under this seat's shared callSite.
  modelSource: string = FAITHFULNESS_SEAT.source,
  // B-063 — false ONLY from the dry-run label A/B below; every live call keeps the labels.
  receiptLabels: boolean = true
): Promise<VerifierResult> {
  const result: VerifierResult = {
    rejected: new Set(),
    reasons: new Map(),
    inTok: 0,
    outTok: 0,
    ran: false,
    failedOpen: false,
  };

  const cards = curated
    .map((item, i) => {
      const c = filtered[item.candidate_index];
      return c ? faithfulnessCardBlock(item, c, i, receiptLabels) : null;
    })
    .filter(Boolean)
    .join("\n\n");

  if (!cards) return result;

  const userPrompt = `Audit these ${curated.length} feed cards for FAITHFULNESS to their source. For each index, does every claim and number in the rewrite trace to the original article or the provided context receipts? Return a verdict per index.\n\n${cards}`;

  const startedAt = Date.now();
  let usage: ReturnType<typeof usageOf> = {};
  let logged = false;
  const log = (taskStatus: string) =>
    logged
      ? undefined
      : ((logged = true),
        postLlmCall({
          model,
          callSite: "feed-curator:passC-faithfulness-verifier",
          taskStatus,
          ...usage,
          latencyMs: Date.now() - startedAt,
          extra: { cards: curated.length, modelSource },
        }));

  try {
    let content: string | null | undefined;
    if (isAnthropicModel(model)) {
      const judge = createAnthropicJudge("feed-curator:passC-faithfulness-verifier", model, {
        overrideVar: overrideVarFor(modelSource, "CURATOR_SHADOW_FAITHFULNESS_MODEL"),
      });
      const answer = await judge.judge({
        system: FAITHFULNESS_SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 2000,
        tool: FAITHFULNESS_TOOL,
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
          { role: "system", content: FAITHFULNESS_SYSTEM_PROMPT },
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
      console.warn("  Faithfulness verifier returned no content — failing open (no items dropped).");
      result.failedOpen = true;
      log("empty_content");
      return result;
    }

    const parsed = JSON.parse(content);
    const verdicts: Verdict[] = Array.isArray(parsed)
      ? parsed
      : (Object.values(parsed).find((v) => Array.isArray(v)) as Verdict[]) || [];

    for (const v of verdicts) {
      if (typeof v.index !== "number") continue;
      if (String(v.verdict).toUpperCase() === "REJECT") {
        result.rejected.add(v.index);
        result.reasons.set(v.index, v.reason || "unsupported claim");
      }
    }
    result.ran = true;
    log("ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  Faithfulness verifier failed (${msg}) — failing open (no items dropped).`);
    result.failedOpen = true;
    log("fail");
  }

  return result;
}

async function main() {
  console.log("Feed Curator — starting...");

  // 1. Gather raw articles from person_facts
  const newsFacts = await db
    .select({
      id: personFacts.id,
      personId: personFacts.personId,
      factKey: personFacts.factKey,
      factValue: personFacts.factValue,
      retrievedAt: personFacts.retrievedAt,
    })
    .from(personFacts)
    .where(
      sql`${personFacts.factKey} IN ('news_headlines', 'gdelt_articles')`
    )
    .orderBy(desc(personFacts.retrievedAt))
    .limit(500);

  console.log(`Found ${newsFacts.length} news facts to process`);

  if (newsFacts.length === 0) {
    console.log("No news facts found. Run fetch:gdelt or fetch:news first.");
    return;
  }

  // Get person info
  const personIds = [...new Set(newsFacts.map((f) => f.personId))];
  const personRows = await db
    // birthYear added 2026-09-02 for B-037's withhold — see the political branch below.
    .select({ id: persons.id, name: persons.name, state: persons.state, deathYear: persons.deathYear, birthYear: persons.birthYear })
    .from(persons)
    .where(inArray(persons.id, personIds));

  const personMap = new Map(personRows.map((p) => [p.id, p]));

  // Get PBS scores
  const scores = await db
    .select({ personId: scoreSnapshots.personId, pbs: scoreSnapshots.pbs })
    .from(scoreSnapshots)
    .where(inArray(scoreSnapshots.personId, personIds));

  // NOT GRADED (2026-10-02, `gradeStatus` in @ba/shared): a person with no giving fact on file has
  // no grade, so the writer and Pass C are handed none — `readerFacingScorePhrase(null)` emits no
  // score line at all, and a card cannot state a grade nobody gave it.
  const givingKeyRows = await db
    .select({ personId: personFacts.personId, factKey: personFacts.factKey })
    .from(personFacts)
    .where(and(inArray(personFacts.personId, personIds), inArray(personFacts.factKey, [...GIVING_EVIDENCE_FACT_KEYS])));
  const givingKeysById = new Map<string, string[]>();
  for (const r of givingKeyRows) givingKeysById.set(r.personId, [...(givingKeysById.get(r.personId) ?? []), r.factKey]);

  const scoreMap = new Map<string, string>();
  for (const s of scores) {
    if (gradeStatus(givingKeysById.get(s.personId) ?? []) !== "graded") continue;
    scoreMap.set(s.personId, s.pbs);
  }

  // Get context facts (net_worth, political, philanthropy)
  const contextFacts = await db
    .select({
      personId: personFacts.personId,
      factType: personFacts.factType,
      // factKey is SELECTED because the foundation-chip branch below dispatches on it. It was absent
      // when that branch first switched from the shared TYPE to the KEY (2026-09-14), which made
      // `f.factKey` undefined, the branch dead, and every feed card's Pass A context silently lose
      // its foundation assets — a regression worse than the clobber it replaced. Typecheck caught it
      // (TS2339); the source-shape test did not, so the wiring test now asserts this projection.
      factKey: personFacts.factKey,
      factValue: personFacts.factValue,
    })
    .from(personFacts)
    .where(
      sql`${personFacts.personId} IN (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
        AND ${personFacts.factType} IN ('net_worth', 'political', 'philanthropy')`
    );

  const contextMap = new Map<string, { netWorth: string | null; political: string | null; philanthropy: string | null }>();
  for (const f of contextFacts) {
    const existing = contextMap.get(f.personId) || { netWorth: null, political: null, philanthropy: null };
    if (f.factType === "net_worth") {
      existing.netWorth = String(f.factValue);
    } else if (f.factType === "political") {
      const val = f.factValue as Record<string, unknown>;
      // B-037, FIFTH CONSUMER — and by the note directly below, the one that reaches the front
      // door TWICE. A record whose earliest contribution predates the person's 18th year is
      // withheld on the profile, on /compare and on /today; without this it would still become a
      // feed-card chip AND be handed to Pass A, which reproduces context figures in the GPT-written
      // dek. That is the same path B-030's doubled foundation total took to the served #1 card.
      // Found 2026-09-02 by re-running the consumer sweep with BOTH fact vocabularies: the web
      // keys on factKey `fec_contributions`, this file and the API key on factType `political`,
      // so the first sweep — which grepped only the factKey — structurally could not see either.
      if (isFecRecordImpossible(String(val.dateRange ?? ""), personMap.get(f.personId)?.birthYear)) continue;
      const total = Number(val.totalAmount) || 0;
      // ONE currency ladder (@ba/shared). This line used to hand-copy formatCurrency's ladder
      // inline and, like every other copy of it, dropped the rounding on the sub-$1K branch —
      // a bare `$${total}`. FEC totals accumulate with `+=` over float rows, so the drift is
      // expected in the DATA and containing it is the display layer's job. MacKenzie Scott's
      // chip reached the served front door as "$711.5900000000003 in political donations",
      // promoted at position 1 on 2026-09-03. This is the THIRD copy of that same ladder to be
      // found: `2c2db8f` fixed /today's on 2026-08-26 and moved the function into @ba/shared,
      // but swept the surface where the defect was SEEN rather than the shape, so this one and
      // probe-passc-context.ts survived. The inline copy also had no 1e9 branch, so a >=$1B
      // political total would have read "$1500.0M". Do not re-inline it.
      existing.political = `${formatCurrency(total)} in political donations`;
    } else if (f.factKey === "foundation_990s") {
      // B-030, FOURTH CONSUMER — and the one that reaches the front door. This summed
      // `foundations[].totalAssets` by hand, so a foundation with its own endowment trust was
      // counted twice: the served #1 card on 2026-08-20 read "$152.5B in foundation assets" for
      // Melinda French Gates, where the collapsed figure is $76.95B. It slipped the fork guard
      // because that guard searched for the STORED sum fields, and this path never named them —
      // it reduced the array itself, one level below where the guard was looking.
      // The chip is not decoration: it is also handed to Pass A as context, so the doubled number
      // was reproduced in the GPT-written dek prose too.
      // DISPATCHED BY KEY, B-048's sibling (found 2026-09-14 by the fix-then-grep-siblings sweep).
      // This branch used to match factTYPE `philanthropy`, which is shared by foundation_990s,
      // giving_pledge and total_giving — and foundationAssetsChip() returns null for the last two.
      // So a pledge row read AFTER a foundation row erased the real chip (reproduced: [foundation,
      // pledge] ended null; [pledge, foundation] kept "$9.0B in foundation assets"), and this loop's
      // rows carry no ORDER BY, so the feed card's Pass A context depended on heap order.
      // The first fix here was `if (chip)` — suppress every null. Adversarial review rejected it:
      // that also stops a NEWER foundation record that legitimately renders no chip from clearing a
      // stale one. Dispatching on the KEY is the actual fix — only a foundation record may set this,
      // and it sets it INCLUDING null. Same shape as readPhilanthropyFacts in @ba/shared.
      // KNOWN CEILING, pre-existing and NOT introduced here: two foundation_990s rows for one person
      // are still last-wins by row order. person_facts has no uniqueness constraint and the 990
      // fetcher deletes then inserts, so an overlapping import could leave a duplicate — inferred,
      // not observed in prod. Choosing the latest by retrievedAt is the upgrade if it is ever seen.
      existing.philanthropy = foundationAssetsChip(f.factValue);
    }
    contextMap.set(f.personId, existing);
  }

  // 2. Flatten articles into candidates
  const candidates: Candidate[] = [];
  const seenUrls = new Set<string>();

  // Check existing feed items to avoid re-publishing. TWO guards, because a URL match
  // alone is not enough: a big story keeps generating NEW articles at NEW urls for days,
  // so the same event re-carded every run (live prod, 2026-07-14: the Buffett/Gates
  // Epstein pause shipped 3 cards on 3 consecutive days; the Dell $6.25B pledge 2). A
  // reader scrolling the top of the feed saw the same receipt three times — the opposite
  // of the one-card gut-punch the feed exists to deliver.
  //   1. sourceUrl  — exact same article re-ingested.
  //   2. event signature — a DIFFERENT article about an already-published event.
  // Window sizing is driven by GDELT's RE-SURFACING TAIL, not by how long a story runs.
  // GDELT rotates 1,083 persons stalest-first, so it re-serves the SAME article weeks
  // after publication: live prod 2026-07-19 showed dupe pairs carded 15-31 days apart
  // that ALL shared one publishedAt (Caruso 06-18 carded 06-18 + 07-18; Bloomberg 21d;
  // Koum 17d; Cummings 15d; Adelson 15d). At 14 days the original had already aged out
  // of the lookback, so the guard never saw it and the dupe shipped — five same-receipt
  // pairs reached the live feed AFTER the guard went in. 45d covers the observed 31d
  // max with margin. Supply is not at risk: ~184 on-axis candidates/run feed a top-20.
  const recentFeedItems = await db
    .select({ sourceUrl: feedItems.sourceUrl, headline: feedItems.headline })
    .from(feedItems)
    .where(sql`${feedItems.createdAt} > now() - interval '45 days'`);

  const existingUrls = new Set(recentFeedItems.map((f) => f.sourceUrl));
  const publishedSignatures = recentFeedItems.map((f) => eventSignature(f.headline));

  // B-013: a deceased person's row can still be attached to a live news article (e.g. a
  // generic "X-linked donors" reference that doesn't name a specific different person, so the
  // attribution guard's explicit-name-swap rule doesn't fire). Filter deceased persons out of
  // candidate eligibility entirely, upstream of both the guard and Pass B/C, and log the count
  // so a filtered-out person never silently shrinks the feed without a visible trace.
  let deceasedFilteredArticles = 0;
  const deceasedFilteredNames = new Set<string>();
  let staleIngestDropped = 0;
  const ingestCutoffMs = Date.now() - MAX_INGEST_AGE_DAYS * 864e5;

  for (const fact of newsFacts) {
    const person = personMap.get(fact.personId);
    if (!person) continue;

    if (isDeceased(person)) {
      deceasedFilteredNames.add(`${person.name} (d. ${person.deathYear})`);
      const val = fact.factValue as Record<string, unknown>;
      const arr =
        fact.factKey === "gdelt_articles"
          ? ((val.articles as unknown[]) || [])
          : fact.factKey === "news_headlines"
            ? ((val.articles as unknown[]) || [])
            : [];
      deceasedFilteredArticles += arr.length;
      continue;
    }

    const val = fact.factValue as Record<string, unknown>;
    let articles: RawArticle[] = [];

    if (fact.factKey === "gdelt_articles") {
      // gdelt.ts stores each article with the publisher under `source` (set from
      // GDELT's `domain`) — read `a.source`, never `a.domain`, which is undefined
      // here and once made sourceName null against the source_name NOT-NULL constraint.
      //
      // B-032: GDELT does not always carry a domain, and the old `|| "Unknown"` wrote
      // that placeholder to the column. It is not a fallback — it is a claim about the
      // source, and it shipped to the front door as `Unknown ↗` over a real link on a
      // hedged allegation about a named living person. The rate stepped to ~100% of new
      // rows on 08-23/08-24 (12 of 13) while every one of those cards carried a
      // perfectly parseable URL. sourceLabel() derives the host from that URL — the same
      // transform the render already applies, so ingest and display agree by sharing ONE
      // function rather than by both being right (don't-fork rule, @ba/shared).
      const arr = (val.articles as { title: string; url: string; source: string; date: string; body?: string }[]) || [];
      articles = arr.map((a) => ({
        title: a.title,
        url: a.url,
        source: sourceLabel(a.source, a.url),
        date: a.date,
        body: a.body,
      }));
    } else if (fact.factKey === "news_headlines") {
      const arr = (val.articles as { title: string; url: string; source: { name: string }; publishedAt: string }[]) || [];
      articles = arr.map((a) => ({
        title: a.title,
        url: a.url,
        source: sourceLabel(a.source?.name, a.url),
        date: a.publishedAt,
      }));
    }

    const ctx = contextMap.get(fact.personId) || { netWorth: null, political: null, philanthropy: null };
    const pbs = scoreMap.get(fact.personId) || null;

    for (const article of articles) {
      if (seenUrls.has(article.url) || existingUrls.has(article.url)) continue;
      // R-037 ingest-recency cap. Unparseable/missing date => keep (fail-open: never
      // silently shrink the feed on a bad date string).
      const publishedMs = article.date ? new Date(article.date).getTime() : NaN;
      if (Number.isFinite(publishedMs) && publishedMs < ingestCutoffMs) {
        staleIngestDropped++;
        continue;
      }
      seenUrls.add(article.url);

      candidates.push({
        article,
        personId: fact.personId,
        personName: person.name,
        context: { ...ctx, pbs },
      });
    }
  }

  console.log(`${candidates.length} unique candidate articles after dedup`);

  if (staleIngestDropped > 0) {
    console.log(
      `Ingest-recency cap (R-037): ${staleIngestDropped} article(s) dropped — older than ${MAX_INGEST_AGE_DAYS}d at ingest.`
    );
  }

  if (deceasedFilteredArticles > 0) {
    console.log(
      `Deceased-person filter (B-013): ${deceasedFilteredArticles} candidate article(s) excluded — ${[...deceasedFilteredNames].join(", ")}`
    );
  }

  if (candidates.length === 0) {
    console.log("No new candidate articles to curate.");
    return;
  }

  // Accountability pre-rank (R-010): score each candidate by money/giving/
  // political-spending/wealth-power keyword signal, then sort by that score DESC
  // with recency as the tiebreaker. The prior recency-only sort surfaced mostly
  // news-of-the-day to the gate and starved it of on-axis receipts; this lifts the
  // densest accountability stories to the front so the gate has real material to
  // select. The two-pass gate is still the quality floor — this only reorders what
  // it sees. Reversible: revert to a pure-recency sort to restore prior behavior.
  const scoreOf = new Map<Candidate, number>();
  for (const c of candidates) {
    scoreOf.set(c, accountabilityScore(c.article.title, c.article.body));
  }

  // Passed-over cooldown (R-048, owner-approved branch B 2026-08-07). Stories Pass A
  // already refused sink BELOW every fresh candidate for COOLDOWN_DAYS. Deprioritized,
  // never dropped — same shape as the R-028 credibility downweight, so on a thin day a
  // cooled story can still reach the selector rather than the feed going empty. Measured
  // before building: 13/20 slots were held by prior refusals, and 115 fresh candidates
  // survived the cooldown against 20 needed, so the supply to do this exists.
  const cooldownSince = new Date(Date.now() - COOLDOWN_DAYS * 86400_000);
  // B-052: reads EVERY source, deliberately — the `source` column exists so the
  // composition reader can keep its Pass-A-only population, not so this lookup can
  // narrow. person_id comes with it because a Pass B row cools for one person only.
  const cooledRows = await db
    .select({
      title: curatorPassedOver.title,
      personId: curatorPassedOver.personId,
      // Aliased `refusalSource`, NOT `source`: in this file `source`/`sourceName` means a
      // PUBLISHER, and B-032's wire-up test rightly fails any `source:` assignment that does
      // not route through sourceLabel(). This column is a pipeline STAGE. The guard caught the
      // collision on first run — keep the names distinct rather than widening the guard.
      refusalSource: curatorPassedOver.source,
    })
    .from(curatorPassedOver)
    .where(gte(curatorPassedOver.passedOverAt, cooldownSince));
  // B-052 / the owner's amendment (2026-09-22): the KIND is kept, not just
  // the boolean, because a person-scoped verifier refusal now sorts below every off-axis
  // candidate while Pass A's person-blind rows keep their 08-11 tiers.
  const kindOf = new Map<Candidate, CooldownKind>();
  const cooledOf = new Map<Candidate, number>();
  for (const c of candidates) {
    const kind = cooldownKind(c.article.title, c.personId, cooledRows);
    kindOf.set(c, kind);
    cooledOf.set(c, kind === "none" ? 0 : 1);
  }
  // Source-credibility downweight (R-028, Option B): tier is the PRIMARY sort
  // key, so low-credibility domains sink behind every default-tier candidate —
  // deprioritized, never banned (on a thin day they can still reach the
  // selector, and the two-pass gate + faithfulness verifier stay the floor).
  // B-029 (owner-approved 2026-08-11): the cooldown now applies WITHIN the send window
  // rather than ACROSS it. It used to outrank the accountability score outright, on the
  // reasoning that a story the selector already refused is worth less than a fresh one it
  // has never been asked about. True in isolation — and false once the 20-slot send cap
  // is applied downstream, because the on-axis supply IS largely the refused set, so the
  // window filled with fresh score-0 material and the on-axis candidates never reached
  // the selector. sendTier() encodes the ruling: cooled still loses to every fresh
  // on-axis story, but no longer loses to a fresh OFF-axis one.
  const sortComparator = (a: Candidate, b: Candidate) => {
    const dt = credibilityTier(a.article.source) - credibilityTier(b.article.source);
    if (dt !== 0) return dt;
    const dTier =
      sendTier(kindOf.get(a) ?? "none", scoreOf.get(a) ?? 0) -
      sendTier(kindOf.get(b) ?? "none", scoreOf.get(b) ?? 0);
    if (dTier !== 0) return dTier;
    const ds = (scoreOf.get(b) ?? 0) - (scoreOf.get(a) ?? 0);
    if (ds !== 0) return ds;
    return new Date(b.article.date).getTime() - new Date(a.article.date).getTime();
  };
  // BEFORE/AFTER on real candidates, logged every run — the owner asked for the preview and
  // it is cheap enough to keep permanently. It is also the instrument that answers
  // "has the fraction actually recovered?", which is what keeps the check:curator
  // shortlist floor honest rather than something we mute once it has been noticed.
  const priorOrder = [...candidates].sort((a, b) => {
    const dt = credibilityTier(a.article.source) - credibilityTier(b.article.source);
    if (dt !== 0) return dt;
    const dc = (cooledOf.get(a) ?? 0) - (cooledOf.get(b) ?? 0);
    if (dc !== 0) return dc;
    const ds = (scoreOf.get(b) ?? 0) - (scoreOf.get(a) ?? 0);
    if (ds !== 0) return ds;
    return new Date(b.article.date).getTime() - new Date(a.article.date).getTime();
  });
  candidates.sort(sortComparator);
  const cooledCount = candidates.filter((c) => cooledOf.get(c) === 1).length;
  if (cooledCount > 0) {
    console.log(
      // The window's COMPOSITION beside the candidate count (B-052): the table now holds
      // two kinds of refusal with different reach. Split by the `source` COLUMN, not by
      // `personId === null` — the column is the provenance, and a proxy that happens to
      // agree today is the label-vs-predicate defect this project keeps re-finding.
      // The candidate-side attribution the previous version said it could not make: kindOf is
      // that per-candidate read, so the line now states how many candidates the 2026-09-22
      // amendment actually sank below off-axis — printed even at 0, so "the rule reached
      // nothing today" and "the rule is not running" stop looking alike.
      `Passed-over cooldown (R-048): ${cooledCount} candidate(s) deprioritized — refused within ${COOLDOWN_DAYS}d, of which ${candidates.filter((c) => kindOf.get(c) === "person").length} person-scoped and sunk below off-axis (B-052, the owner 2026-09-22). Window holds ${cooledRows.length} refusal(s): ${cooledRows.filter((r) => r.refusalSource === SOURCE_PASS_A).length} ${SOURCE_PASS_A} (person-blind), ${cooledRows.filter((r) => r.refusalSource !== SOURCE_PASS_A).length} person-scoped.`
    );
    // The before/after the owner asked for, measured on the run's own real candidates.
    // Isolates the SORT change: everything downstream of here is identical either way.
    const onAxisIn = (list: Candidate[]) =>
      list.slice(0, 20).filter((c) => (scoreOf.get(c) ?? 0) > 0).length;
    const wasOnAxis = onAxisIn(priorOrder);
    const nowOnAxis = onAxisIn(candidates);
    console.log(
      `Reserve slots (B-029): top-20 by sort is ${nowOnAxis}/20 on-axis, was ${wasOnAxis}/20 under the prior order ` +
        `(delta ${nowOnAxis - wasOnAxis >= 0 ? "+" : ""}${nowOnAxis - wasOnAxis}). ` +
        `A zero delta on a day with cooled on-axis candidates means the fix is not reaching them — read it, don't assume it.`
    );
  }
  // ── Kind mix at the CANDIDATE layer (R-048, 2026-09-07) ────────────────────────
  // The read first, then the change, so the number is measured where the choice is
  // actually made rather than at the published set. Pass A's `category` is filled in
  // by the MODEL during the rewrite, so until now the earliest kind was knowable only
  // AFTER selection — which is precisely why a five-run philanthropy monoculture went
  // unremarked while every on-axis gate read green.
  //
  // REPORTED, NOT GATED, and deliberately: nobody has measured what a healthy mix
  // looks like on this corpus, so a floor picked today would be invented rather than
  // calibrated. B-021's rule — measure against prod before tuning — applies.
  const kindOfCandidate = (c: Candidate) => candidateKind(c.article.title, c.article.body);
  const candidateMix = kindMix(
    candidates.map((c) => ({ title: c.article.title, body: c.article.body }))
  );
  // The parts must reach the denominator, or the classifier never fired and the zeros
  // are an artifact rather than a measurement (this lane's sum-check rule).
  const mixSum = Object.values(candidateMix.counts).reduce((a, b) => a + b, 0);
  console.log(
    `Candidate kind mix (R-048): ${formatKindMix(candidateMix)}` +
      (mixSum === candidateMix.total
        ? ""
        : ` ⚠ PARTS DO NOT SUM (${mixSum} vs ${candidateMix.total}) — read this as a broken classifier, not as a mix`)
  );

  // The change: a soft same-kind demotion so the 20-slot shortlist is not handed to
  // Pass A as one kind. Reorder only — nothing is dropped, no threshold moves, the
  // cooldown is untouched, and an off-axis candidate that could not reach the selector
  // still cannot. Before/after is logged on the run's own candidates, matching the
  // B-029 precedent, so the effect is read rather than assumed.
  const SEND_WINDOW = 20;
  const kindsBefore = distinctKindsInWindow(candidates, kindOfCandidate, SEND_WINDOW);
  const diversified = diversifyByKind(candidates, kindOfCandidate, KIND_SOFT_CAP);
  const kindsAfter = distinctKindsInWindow(diversified, kindOfCandidate, SEND_WINDOW);
  candidates.splice(0, candidates.length, ...diversified);
  // A zero delta has TWO causes and they call for opposite responses, so the line says
  // which one applies rather than asserting a cause the way its first draft did.
  const poolKinds = distinctKindsInWindow(candidates, kindOfCandidate, candidates.length);
  const zeroDeltaNote =
    kindsAfter !== kindsBefore
      ? ""
      : kindsBefore <= 1
        ? ` Zero delta with ${kindsBefore} kind in the window AND ${poolKinds} in the whole pool: the POOL is monocultural — a SUPPLY finding, the lever is upstream, and nothing here can fix it.`
        : ` Zero delta but the window already carried ${kindsBefore} kinds — nothing needed reordering. That is the healthy reading, NOT a no-op to investigate.`;
  console.log(
    `Kind diversity (R-048): top-${SEND_WINDOW} carries ${kindsAfter} distinct kind(s), was ${kindsBefore}; ` +
      `whole pool carries ${poolKinds} ` +
      `(soft cap ${KIND_SOFT_CAP} per kind; surplus reordered WITHIN the classified slots, never dropped, ` +
      `so the on-axis fraction of any prefix is unchanged by construction).${zeroDeltaNote}`
  );

  const onAxis = candidates.filter((c) => (scoreOf.get(c) ?? 0) > 0).length;
  const downweighted = candidates.filter((c) => credibilityTier(c.article.source) === 1);
  if (downweighted.length > 0) {
    const domains = [...new Set(downweighted.map((c) => c.article.source))];
    console.log(
      `Source-credibility downweight (R-028): ${downweighted.length} candidate(s) deprioritized — ${domains.join(", ")}`
    );
  }

  // Diversity filter: max 2 articles per billionaire, AND at most one article per
  // near-duplicate EVENT cluster (G2). Per-person dedup alone left one event
  // (e.g. a commencement walkout) surfacing 6 cards across different attributed
  // billionaires; the event signature collapses N outlets on one story so the
  // selector sees distinct events. Both caps logged — no silent truncation.
  const perPerson = new Map<string, number>();
  const acceptedSignatures: Set<string>[] = [];
  const filtered: Candidate[] = [];
  let collapsedEvents = 0;
  let alreadyPublishedEvents = 0;
  const alreadyPublishedTitles: string[] = [];
  // Candidates the deterministic guard KEEPS but cannot separate — the judge's input.
  const grayBand: CandidatePair[] = [];
  for (const c of candidates) {
    const count = perPerson.get(c.personId) || 0;
    if (count >= 2) continue;
    const sig = eventSignature(c.article.title);
    if (acceptedSignatures.some((s) => sameEvent(sig, s))) {
      collapsedEvents++;
      continue;
    }
    // Cross-run: this event already has a card on the live feed. Drop it BEFORE the
    // selector so we also don't pay LLM cost to rewrite a duplicate.
    if (publishedSignatures.some((s) => sameEvent(sig, s, CROSS_RUN_EVENT_THRESHOLD))) {
      alreadyPublishedEvents++;
      if (alreadyPublishedTitles.length < 5) alreadyPublishedTitles.push(c.article.title);
      continue;
    }
    // B-022: the guard is about to KEEP this candidate. Record its closest published
    // neighbour when the score lands in the gray band, so the judge can be asked about
    // the pairs no threshold can separate. Best match only — the question is "is this a
    // repeat of something live?", which keeps the ask linear in candidates.
    let bestScore = 0;
    let bestIdx = -1;
    publishedSignatures.forEach((s, i) => {
      const v = jaccardScore(sig, s);
      if (v > bestScore) {
        bestScore = v;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0 && bestScore >= GRAY_BAND_FLOOR) {
      grayBand.push({
        index: filtered.length,
        a: c.article.title,
        b: recentFeedItems[bestIdx].headline,
        score: bestScore,
      });
    }
    perPerson.set(c.personId, count + 1);
    acceptedSignatures.push(sig);
    filtered.push(c);
    if (filtered.length >= 20) break;
  }

  // Never let a filter silently shrink the feed — log what it removed (codebase invariant).
  if (alreadyPublishedEvents > 0) {
    console.log(
      `Cross-run duplicate-event filter: ${alreadyPublishedEvents} candidate(s) dropped ` +
        `— already carded in the last 45 days: ${alreadyPublishedTitles.join(" | ")}` +
        (alreadyPublishedEvents > alreadyPublishedTitles.length ? " | ..." : "")
    );
  }

  // B-022 — LLM same-event judge over the GRAY BAND, i.e. pairs scoring below
  // CROSS_RUN_EVENT_THRESHOLD that the guard therefore keeps. The guard's calibration
  // stops at 0.364 because that is where its false-positive band goes empty; BELOW it the
  // true and false bands INTERLEAVE (measured 2026-08-03 across 6,903 live pairs — a FALSE
  // positive at 0.3333 outranks TRUE ones at 0.2667 and 0.2500), so no threshold reaches
  // these and an LLM read is the only remaining instrument. Note this is NOT the judge
  // documented at CROSS_RUN_EVENT_THRESHOLD: that one reads the COLLAPSED set, which is
  // empty here and answers the opposite defect (a follow-up wrongly DROPPED, R-036).
  //
  // Subtractive and refute-only: it sees only candidates already destined to ship, so a
  // miss, a parse failure or an outage reproduces prior behaviour exactly.
  //
  // ponytail: a judged-out candidate keeps the per-person slot it consumed above. It is a
  // duplicate of something already carded, so the slot is spent either way; rolling it
  // back would only matter if a person routinely had >2 gray-band candidates in one run.
  let dedupJudgeFailedOpen = false;
  // Tokens travel with the seat: a fourth LLM call that never reaches the cost line is
  // the B-019 defect again, one level up — a total that quietly under-reports.
  let dedupInTok = 0;
  let dedupOutTok = 0;
  if (grayBand.length > 0) {
    const judged = await judgeSameEvent(
      grayBand,
      openai,
      SAME_EVENT_B022_SEAT.model,
      "feed-curator:b022-candidate-same-event-judge",
      { modelSource: SAME_EVENT_B022_SEAT.source }
    );
    dedupInTok = judged.inTok;
    dedupOutTok = judged.outTok;
    if (judged.ran) {
      for (const i of judged.duplicate) {
        const p = grayBand.find((g) => g.index === i);
        if (!p) continue;
        console.log(
          `  ✗ SAME-EVENT DROP [${p.score.toFixed(3)}] ${p.a} — already carded as "${p.b}" (${judged.reasons.get(i)})`
        );
      }
      // Log what the judge ASKED AND KEPT, not only what it dropped. A count alone
      // ("5 checked, 2 dropped") cannot tell asked-and-cleared from never-asked, and
      // those are different defects: the first is calibration, the second is REACH —
      // the ingest score compares a raw article title against an already-published GPT
      // REWRITE, so a pair can sit below GRAY_BAND_FLOOR here and score well above it
      // once both sides are rewritten (which is the pair a reader actually sees).
      for (const p of grayBand) {
        if (judged.duplicate.has(p.index)) continue;
        console.log(`  · same-event KEPT [${p.score.toFixed(3)}] ${p.a} — vs carded "${p.b}"`);
      }
      // Splice high index first so earlier positions stay valid.
      [...judged.duplicate].sort((a, b) => b - a).forEach((i) => filtered.splice(i, 1));
      console.log(
        `Same-event judge (B-022): ${grayBand.length} gray-band candidate(s) checked, ${judged.duplicate.size} dropped as duplicates`
      );
    } else if (judged.failedOpen) {
      // Same explicit else as Pass B/C: "asked and could not answer" must not read as
      // "nothing to drop". Third seat on the shared JUDGE-FAILED-OPEN token.
      dedupJudgeFailedOpen = true;
      console.error(
        `JUDGE-FAILED-OPEN dedup — the same-event judge did not run; ${grayBand.length} gray-band candidate(s) kept unchecked.`
      );
    }
  }

  const sentScores = filtered.map((c) => scoreOf.get(c) ?? 0);
  const sentOnAxis = sentScores.filter((s) => s > 0).length;
  // Guard the empty slice explicitly. Seeding Math.min(...scores, 0) clamps the
  // reported low end to <=0 forever (scores can be negative — see the penalty list
  // in feed-relevance-rank.ts), which makes an on-axis top-20 read as off-axis.
  const hi = sentScores.length ? Math.max(...sentScores) : 0;
  const lo = sentScores.length ? Math.min(...sentScores) : 0;
  // On-axis SUPPLY overstates on-axis REACH once the R-048 cooldown is live. The sort
  // puts every cooled candidate below every fresh one, and the send is capped at 20, so
  // a cooled candidate can be sorted clean out of the selector's reach — "deprioritized,
  // never dropped" is true of the candidate LIST and false at the send boundary. Print
  // the split so the next responder reads the cause instead of inferring it: on
  // 2026-08-11 supply was a healthy 29 while the shortlist arrived 1/19 on-axis.
  const onAxisCooled = candidates.filter(
    (c) => (scoreOf.get(c) ?? 0) > 0 && cooledOf.get(c) === 1
  ).length;
  console.log(
    `Accountability pre-rank (R-010): ${onAxis}/${candidates.length} candidates on-axis (score>0); ` +
      `${onAxis - onAxisCooled} reachable / ${onAxisCooled} sunk by cooldown; ` +
      `top-${filtered.length} sent score range ${hi}..${lo} ` +
      `(${sentOnAxis}/${filtered.length} on-axis)`
  );
  const sentDownweighted = filtered.filter((c) => credibilityTier(c.article.source) === 1).length;
  console.log(
    `Sending ${filtered.length} candidates to GPT for curation` +
      (collapsedEvents > 0 ? ` (${collapsedEvents} near-duplicate-event articles collapsed)` : "") +
      (sentDownweighted > 0 ? ` (${sentDownweighted} low-credibility-tier candidate(s) still reached the selector — thin-supply path)` : "") +
      "..."
  );

  // 3. Build prompt
  const candidateDescriptions = filtered.map((c, i) => generatorCandidateBlock(c, i)).join("\n\n");

  const userPrompt = `Here are ${filtered.length} candidate articles about U.S. billionaires. Select the 5-10 most newsworthy and write polished feed items.\n\n${candidateDescriptions}`;

  // 4. GPT curation
  const gen = await runGenerator(SYSTEM_PROMPT, userPrompt, filtered.length);
  if (gen.kind === "empty") {
    console.error("No response from GPT");
    await flushLlmLogs();
    return;
  }
  if (gen.kind === "unparseable") {
    console.error("Failed to parse GPT response:", gen.content.slice(0, 500));
    await flushLlmLogs(); // Pass A was billed; its row must survive this exit.
    return;
  }
  const curated: CuratedItem[] = gen.curated;

  console.log(`GPT selected ${curated.length} items`);

  // Pass A is the pipeline's LARGEST single drop (20 distinct on-axis events sent,
  // a handful selected) and was the only stage exempt from the log-what-you-removed
  // invariant the filters above follow — so "did the selector pass over a real
  // story?" was unanswerable from a run log, which is exactly what R-048 needs and
  // could not get. The candidates below already survived the per-person cap, the
  // intra-run event collapse and the 45-day cross-run dedup, so each one is a
  // DISTINCT event the selector saw and declined.
  // ponytail: a log, not a judge — it makes the passed-over set readable, it does
  // not rule on it. Upgrade path when a verdict is wanted: run the existing Pass B
  // relevance verifier over this same set and compare its keeps against Pass A's.
  const selectedIdx = new Set(curated.map((i) => i.candidate_index));
  const passedOver = filtered.filter((_, i) => !selectedIdx.has(i));
  if (passedOver.length > 0) {
    console.log(
      `Pass A passed over ${passedOver.length}/${filtered.length} distinct on-axis events [pre-rank score]:`
    );
    // ADJACENCY, not just the score (added 2026-08-17, R-048, orchestrator-directed).
    // The score alone cannot answer the only question that matters about a passed-over
    // high scorer: was Pass A RIGHT to skip it? On 2026-08-17 it declined a [12] Gates
    // Foundation card and a [10] Errol Musk card and published a src-4 hedged allegation
    // — and that reads as a selection defect ONLY if those two were fresh. If either was
    // a near-duplicate of a card already on the feed, skipping it was correct.
    //
    // So print each refusal's closest already-published neighbour. `publishedSignatures`
    // is the same 45-day set the cross-run guard uses, and jaccardScore is the same
    // overlap function — no new threshold, no new model, nothing forked. A HIGH number
    // beside a high score means "correctly skipped as a dupe"; a LOW number beside a high
    // score is the selection defect, and it is the pair that separates them across runs.
    //
    // Printed for EVERY refusal including score-0 ones, and `adj 0.00` on a run with no
    // published history is a real reading rather than a gap — the positive control is that
    // the number always appears.
    for (const c of passedOver) {
      const sig = eventSignature(c.article.title);
      const adj = publishedSignatures.length
        ? Math.max(...publishedSignatures.map((s) => jaccardScore(sig, s)))
        : 0;
      console.log(
        `  – [${scoreOf.get(c) ?? 0}] adj ${adj.toFixed(2)} — ${c.personName} — ${c.article.title.slice(0, 110)}`
      );
    }
    // R-048: persist the refusal so it stops re-occupying a slot tomorrow. Written even
    // on a DRY RUN would be a prod write, so it is gated — the dry run must stay the
    // safe full-pipeline exercise CLAUDE.md advertises.
    if (!CURATOR_DRY_RUN) {
      await db
        .insert(curatorPassedOver)
        .values(passedOver.map((c) => ({ title: c.article.title.slice(0, 300) })));
    }
  }

  // Deterministic attribution guard (2026-07-02): a candidate's person link is
  // fixed at ingest, but Pass A can rewrite the card toward a different subject
  // (Miriam-Adelson card attached to Sheldon Adelson's row; MacKenzie-Scott card
  // attached to Jeff Bezos). Pass B checks the card against the ARTICLE, not the
  // attached row, so these ship with the wrong photo/PBS/net-worth receipt.
  // Zero-LLM, headline-vs-index name match; drops at write time. Runs AFTER the
  // verifiers are computed below so Pass B/C telemetry stays comparable day to day.
  const allPersonRows = await db.select({ id: persons.id, name: persons.name }).from(persons);
  const attributionDrop = new Set<number>();
  for (const [idx, item] of curated.entries()) {
    const candidate = filtered[item.candidate_index];
    if (!candidate) continue;
    const other = findAttributionMismatch(item.headline, candidate.personId, candidate.personName, allPersonRows);
    if (other) {
      attributionDrop.add(idx);
      console.log(`  ✗ DROP [${idx}] ${candidate.personName} — ATTRIBUTION: headline names ${other}, card attached to ${candidate.personName}`);
      console.log(`      card was: ${droppedCardText(item)}`);
    }
  }
  if (attributionDrop.size > 0) {
    console.log(`Attribution guard: ${curated.length} checked, ${attributionDrop.size} dropped (headline subject ≠ attached person)`);
  }

  // B-056: a card that quotes the curator's own inputs ("records in the provided data list…")
  // never publishes. Zero-LLM, both leak vocabularies (feed-prompt-leak-guard.ts says why it may
  // be wider than the purge). Like the attribution guard it does not narrow what Pass B/C are
  // asked, so their telemetry stays comparable. The count line prints on EVERY run, zero
  // included: its presence is what separates "checked, nothing leaked" from "never ran".
  const leakDrop = promptLeakDrops(curated);
  for (const idx of leakDrop) {
    const candidate = filtered[curated[idx].candidate_index];
    console.log(`  ✗ DROP [${idx}] ${candidate?.personName ?? "?"} — PROMPT-LEAK: the card quotes the curator's own inputs`);
    console.log(`      card was: ${droppedCardText(curated[idx])}`);
  }
  console.log(`Prompt-leak guard (B-056): ${curated.length} checked, ${leakDrop.size} dropped (card quotes the curator's own inputs)`);

  // Pass B — adversarial relevance verifier (separate call, refute-only axis).
  // Drops the incidental/name-collision cards Pass A's single-pass gate let
  // through, at WRITE time — instead of a human cold-audit + manual SQL delete
  // after they go live (B-004). The rejected count IS the write-time
  // false-positive rate we pre-registered to drive toward near-zero.
  const verifier = await runRelevanceVerifier(curated, filtered);
  if (verifier.ran) {
    const checked = curated.length;
    const rejected = verifier.rejected.size;
    const pct = checked > 0 ? ((rejected / checked) * 100).toFixed(0) : "0";
    console.log(`Relevance verifier: ${checked} checked, ${rejected} rejected (${pct}% write-time false positives caught)`);
    for (const idx of verifier.rejected) {
      const c = filtered[curated[idx]?.candidate_index];
      console.log(`  ✗ DROP [${idx}] ${c?.personName || "?"} — ${verifier.reasons.get(idx)}`);
      console.log(`      card was: ${droppedCardText(curated[idx])}`);
      // B-052: the SOURCE article, not just the rewrite. Without this line "the same story
      // was refused twice" is an INFERENCE from two matching verdict texts — which is how
      // the Earl Woods recurrence had to be argued on 09-19. The rewrite differs run to
      // run; the article title is what a second run can be matched against.
      console.log(`      source article: ${c?.article.title ?? "?"}`);
    }
  } else if (verifier.failedOpen) {
    // The `else` this block spent its whole life without. A fail-open judge used to
    // leave NO verdict line, so its absence had to be noticed by a human diffing run
    // logs. ASCII marker, deliberately: it is grepped out of a CI log by check:curator.
    console.error(
      `JUDGE-FAILED-OPEN relevance — Pass B did not run; ${curated.length} card(s) shipped with NO relevance gate.`
    );
  }

  // Judge-seat shadow eval (GPT-5.6 model audit, 2026-07-10): run a second relevance
  // pass with a candidate model on the SAME cards, purely for comparison — never
  // affects `verifier.rejected` (the drop decision). Logs agreement so a judge-model
  // swap can be backtested before it ever touches the live VERIFIER_MODEL.
  if (SHADOW_VERIFIER_MODEL) {
    const shadow = await runRelevanceVerifier(curated, filtered, SHADOW_VERIFIER_MODEL, "shadow-env");
    if (shadow.ran) {
      const agree = curated.map((_, i) => verifier.rejected.has(i) === shadow.rejected.has(i)).filter(Boolean).length;
      console.log(`Relevance shadow [${SHADOW_VERIFIER_MODEL}]: ${shadow.rejected.size} rejected (incumbent ${verifier.rejected.size}) — ${agree}/${curated.length} agree with incumbent`);
      for (const idx of shadow.rejected) {
        if (!verifier.rejected.has(idx)) {
          const c = filtered[curated[idx]?.candidate_index];
          console.log(`  ○ SHADOW-ONLY-REJECT [${idx}] ${c?.personName || "?"} — ${shadow.reasons.get(idx)} (incumbent kept this)`);
        }
      }
      for (const idx of verifier.rejected) {
        if (!shadow.rejected.has(idx)) {
          const c = filtered[curated[idx]?.candidate_index];
          console.log(`  ○ SHADOW-MISSED-REJECT [${idx}] ${c?.personName || "?"} — incumbent rejected (${verifier.reasons.get(idx)}), shadow kept it`);
        }
      }
    }
  }

  // Pass C — faithfulness verifier (R9 quality-gate wave, 2026-06-30). SHADOW-FIRST:
  // by default it LOGS what it would drop but does NOT drop (CURATOR_FAITHFULNESS_ENFORCE
  // off), so we validate calibration on real cards before it gates the aha surface.
  // Flip the env var to 1 to actually drop unfaithful cards at write time.
  const faith = await runFaithfulnessVerifier(curated, filtered);
  const faithDrop = new Set<number>();
  let suspectDrops = 0;
  if (faith.ran) {
    const rejected = faith.rejected.size;
    const pct = curated.length > 0 ? ((rejected / curated.length) * 100).toFixed(0) : "0";
    const mode = FAITHFULNESS_ENFORCE ? "ENFORCE" : "SHADOW";
    console.log(`Faithfulness verifier [${mode}]: ${curated.length} checked, ${rejected} would-drop (${pct}% unfaithful)`);
    for (const idx of faith.rejected) {
      const c = filtered[curated[idx]?.candidate_index];
      const reason = String(faith.reasons.get(idx) ?? "");
      const receipts = contextReceiptsFor(c);
      console.log(`  ${FAITHFULNESS_ENFORCE ? "✗ DROP" : "○ SHADOW-DROP"} [${idx}] ${c?.personName || "?"} — ${reason}`);
      console.log(`      card was: ${droppedCardText(curated[idx])}`);
      console.log(`      source article: ${c?.article.title ?? "?"}`); // B-052, same reason as Pass B above
      console.log(`      context it was given: ${receipts}`);
      // Judge ACCURACY, checked deterministically at the moment of the drop (B-027). We
      // have only ever logged judge RATE; on 2026-08-08 the rate was 100% and the accuracy
      // was 0%. This does NOT block the drop — it marks it for a human, because the judge
      // may be rejecting the figure's USE rather than its existence.
      const audit = auditFaithfulnessDrop(reason, receipts);
      if (audit.suspect) {
        suspectDrops++;
        console.log(`      ⚠ SUSPECT-DROP — ${audit.matched.join(", ")} WAS in the context it was given`);
      }
      if (FAITHFULNESS_ENFORCE) faithDrop.add(idx);
    }
    // Judge ACCURACY as a first-class number beside judge RATE. Printed only when the
    // judge actually dropped something, so a clean day stays quiet — the same
    // absence-is-ambiguous rule the fail-open alarm follows.
    if (rejected > 0) {
      console.log(
        `Faithfulness accuracy check: ${rejected} drop(s) audited, ${suspectDrops} SUSPECT (figure was in the card's own context receipts)`
      );
    }
  } else if (faith.failedOpen) {
    // Pass C is the faithfulness gate on a defamation-adjacent surface, and it is
    // ENFORCING in prod. Silent absence here is the most expensive silence in the repo.
    console.error(
      `JUDGE-FAILED-OPEN faithfulness — Pass C did not run; ${curated.length} card(s) shipped unverified against source.`
    );
  }

  // Judge-seat shadow eval, faithfulness axis — same mechanism as the relevance
  // shadow above: comparison logging only, never affects `faithDrop`.
  if (SHADOW_FAITHFULNESS_MODEL) {
    const shadow = await runFaithfulnessVerifier(curated, filtered, SHADOW_FAITHFULNESS_MODEL, "shadow-env");
    if (shadow.ran) {
      const agree = curated.map((_, i) => faith.rejected.has(i) === shadow.rejected.has(i)).filter(Boolean).length;
      console.log(`Faithfulness shadow [${SHADOW_FAITHFULNESS_MODEL}]: ${shadow.rejected.size} rejected (incumbent ${faith.rejected.size}) — ${agree}/${curated.length} agree with incumbent`);
      for (const idx of shadow.rejected) {
        if (!faith.rejected.has(idx)) {
          const c = filtered[curated[idx]?.candidate_index];
          console.log(`  ○ SHADOW-ONLY-REJECT [${idx}] ${c?.personName || "?"} — ${shadow.reasons.get(idx)} (incumbent kept this)`);
        }
      }
      for (const idx of faith.rejected) {
        if (!shadow.rejected.has(idx)) {
          const c = filtered[curated[idx]?.candidate_index];
          console.log(`  ○ SHADOW-MISSED-REJECT [${idx}] ${c?.personName || "?"} — incumbent rejected (${faith.reasons.get(idx)}), shadow kept it`);
        }
      }
    }
  }

  // B-063 label A/B — DRY RUN ONLY, never affects `faithDrop`. Re-judges every card on the same
  // seat three more times: once more WITH the FEC:/990: labels (the incumbent's own input, so any
  // disagreement there is judge NOISE) and twice WITHOUT them (the pre-B-063 input). A card is a
  // LABEL-FLIP only when both labeled verdicts agree, both unlabeled verdicts agree, and the two
  // pairs differ — otherwise it is noise and is reported as such, never as the labels' effect.
  if (CURATOR_DRY_RUN && process.env.CURATOR_PASSC_LABEL_AB === "1" && faith.ran) {
    const labeledAgain = await runFaithfulnessVerifier(curated, filtered, FAITHFULNESS_MODEL, "label-ab");
    const bare1 = await runFaithfulnessVerifier(curated, filtered, FAITHFULNESS_MODEL, "label-ab", false);
    const bare2 = await runFaithfulnessVerifier(curated, filtered, FAITHFULNESS_MODEL, "label-ab", false);
    if (!labeledAgain.ran || !bare1.ran || !bare2.ran) {
      console.log(`PASSC-LABEL-AB INCOMPLETE — a re-judge did not run; no flip is reported for this run.`);
    } else {
      const v = (r: VerifierResult, i: number) => (r.rejected.has(i) ? "REJECT" : "KEEP");
      let flips = 0;
      let noise = 0;
      curated.forEach((item, i) => {
        const c = filtered[item.candidate_index];
        const l1 = v(faith, i), l2 = v(labeledAgain, i), u1 = v(bare1, i), u2 = v(bare2, i);
        const kind = l1 !== l2 || u1 !== u2 ? "NOISE" : l1 !== u1 ? "LABEL-FLIP" : "stable";
        if (kind === "LABEL-FLIP") flips++;
        if (kind === "NOISE") noise++;
        console.log(`  PASSC-LABEL-AB [${i}] ${c?.personName || "?"} labeled=${l1}/${l2} unlabeled=${u1}/${u2} → ${kind}`);
        if (kind !== "stable") {
          console.log(`      card: "${item.headline}" / "${item.summary}"`);
          console.log(`      source article: ${c?.article.title ?? "?"}`);
          console.log(`      receipts labeled: ${contextReceiptsFor(c)}`);
          for (const [tag, r] of [["labeled", faith], ["labeled#2", labeledAgain], ["unlabeled", bare1], ["unlabeled#2", bare2]] as const) {
            if (r.rejected.has(i)) console.log(`      ${tag} reason: ${r.reasons.get(i)}`);
          }
        }
      });
      console.log(`PASSC-LABEL-AB: ${curated.length} card(s) judged 4x — ${flips} LABEL-FLIP, ${noise} NOISE, ${curated.length - flips - noise} stable`);
    }
  }

  // Pass A GROUNDING A/B (R-048 round 2) — DRY RUN ONLY, never affects any drop set or write.
  // Re-runs the WRITER on the SAME `filtered` candidates with the pre-grounding prompt, then
  // judges that arm with the SAME unchanged Pass B and Pass C. Reported per arm as the manager
  // review asked: cards surviving B+C and Pass C-ONLY drops (a card Pass B also refused would
  // have died anyway, so it is not a Pass C loss). Each arm is ONE stochastic writer draw and ONE
  // verdict per judge, and several dry runs on one day re-judge the SAME pool — read the counts
  // as a same-day paired sample, never as a rate. "survive B+C" excludes the attribution,
  // prompt-leak and Pass D guards (both arms equally).
  if (CURATOR_DRY_RUN && process.env.CURATOR_PASSA_GROUNDING_AB === "1" && verifier.ran && faith.ran) {
    const oldGen = await runGenerator(
      GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING,
      userPrompt,
      filtered.length,
      "feed-curator:passA-generator-grounding-ab"
    );
    const oldB = oldGen.kind === "ok" ? await runRelevanceVerifier(oldGen.curated, filtered, VERIFIER_MODEL, "grounding-ab") : null;
    const oldC = oldGen.kind === "ok" ? await runFaithfulnessVerifier(oldGen.curated, filtered, FAITHFULNESS_MODEL, "grounding-ab") : null;
    if (oldGen.kind !== "ok" || !oldB?.ran || !oldC?.ran) {
      console.log(`PASSA-GROUNDING-AB INCOMPLETE — the baseline arm's writer or a judge did not run; no comparison is reported.`);
    } else {
      const arm = (tag: string, items: CuratedItem[], b: VerifierResult, c: VerifierResult) => {
        let survive = 0;
        let cOnly = 0;
        items.forEach((item, i) => {
          const cand = filtered[item.candidate_index];
          const excerpt = cand?.article.body ? "excerpt" : "title-only";
          let fate: string;
          if (b.rejected.has(i)) fate = "B-REJECT";
          else if (c.rejected.has(i)) (fate = "C-ONLY-DROP"), cOnly++;
          else (fate = "SURVIVES"), survive++;
          console.log(`  PASSA-GROUNDING-AB ${tag} [${i}] ${fate} ${cand?.personName || "?"} (${excerpt}) — "${item.headline}" / "${item.summary}"`);
          if (fate === "C-ONLY-DROP") console.log(`      Pass C reason: ${c.reasons.get(i)}`);
          if (fate !== "B-REJECT") console.log(`      source article: ${cand?.article.title ?? "?"}`);
        });
        return { selected: items.length, bReject: b.rejected.size, cOnly, survive };
      };
      const g = arm("grounded", curated, verifier, faith);
      const p = arm("baseline", oldGen.curated, oldB, oldC);
      console.log(
        `PASSA-GROUNDING-AB: grounded selected ${g.selected} · B-reject ${g.bReject} · C-only drop ${g.cOnly} · survive B+C ${g.survive}` +
          ` | baseline selected ${p.selected} · B-reject ${p.bReject} · C-only drop ${p.cOnly} · survive B+C ${p.survive}`
      );
    }
  }

  // Pass D — WRITE-TIME event dedup, over the REWRITTEN headline (B-023).
  //
  // NOT a second copy of the ingest guard: the SAME guard, run at the one point where its
  // input is comparable. At candidate stage it scores a RAW article title against an
  // already-published GPT REWRITE — two different registers. 2026-08-13: two Sergey Brin
  // cards for one $100M story shipped a day apart and the guard never asked about the pair
  // (no DROP and no KEPT line in that run's log, and absent means never-asked). Once BOTH
  // sides are rewrites the same signature scores them 0.273 and the same judge calls them
  // SAME. So grayBandMatches() is reused twice with different bounds, against the same
  // CROSS_RUN_EVENT_THRESHOLD and the same judge. No new threshold, no new calibration —
  // the defect was REACH, and reach is the only thing changed here.
  //
  // Deliberately NOT the display-side fix: extending the promoted-6 collapse across the
  // stream was measured wrong on 2026-08-13 (it would suppress two genuinely different
  // Mark Cuban bootcamp cards scoring 0.385, which the judge correctly calls DIFFERENT).
  const rewriteDrop = new Set<number>();
  let rewriteJudgeFailedOpen = false;
  {
    // Only cards still standing after B/C/attribution can duplicate anything.
    const live = curated
      .map((item, idx) => ({ item, idx }))
      .filter(({ idx }) => !verifier.rejected.has(idx) && !faithDrop.has(idx) && !attributionDrop.has(idx) && !leakDrop.has(idx));
    const headlines = live.map(({ item }) => item.headline);
    const published = recentFeedItems.map((f) => f.headline);
    const mode = REWRITE_DEDUP_ENFORCE ? "ENFORCE" : "SHADOW";
    const label = REWRITE_DEDUP_ENFORCE ? "✗ REWRITE-DUP DROP" : "○ REWRITE-DUP SHADOW-DROP";
    const wouldDrop = new Set<number>(); // local indices into `headlines`

    // At or above the threshold the score alone settles it; the band beneath is the judge's.
    const hard = headlines.length ? grayBandMatches(headlines, published, CROSS_RUN_EVENT_THRESHOLD, Infinity) : [];
    const gray = headlines.length ? grayBandMatches(headlines, published) : [];

    for (const p of hard) {
      console.log(`  ${label} [${p.score.toFixed(3)}] ${p.a} — already carded as "${p.b}"`);
      wouldDrop.add(p.index);
    }

    if (gray.length > 0) {
      const judged = await judgeSameEvent(
        gray,
        openai,
        SAME_EVENT_B023_SEAT.model,
        "feed-curator:b023-rewrite-same-event-judge",
        { mode, modelSource: SAME_EVENT_B023_SEAT.source }
      );
      dedupInTok += judged.inTok;
      dedupOutTok += judged.outTok;
      if (judged.ran) {
        for (const p of gray) {
          if (judged.duplicate.has(p.index)) {
            console.log(`  ${label} [${p.score.toFixed(3)}] ${p.a} — already carded as "${p.b}" (${judged.reasons.get(p.index)})`);
            wouldDrop.add(p.index);
          } else {
            // Asked-and-KEPT, logged for the same reason the ingest seat logs it: a count
            // alone cannot tell asked-and-cleared from never-asked, and those are
            // different defects (calibration vs REACH). This seat exists because that
            // distinction was unreadable at ingest.
            console.log(`  · rewrite-dup KEPT [${p.score.toFixed(3)}] ${p.a} — vs carded "${p.b}"`);
          }
        }
      } else if (judged.failedOpen) {
        // Fourth seat on the shared JUDGE-FAILED-OPEN token (matched by
        // check-curator-supply.mjs as /JUDGE-FAILED-OPEN \w+/ — keep it ONE word).
        rewriteJudgeFailedOpen = true;
        console.error(
          `JUDGE-FAILED-OPEN rewrite — the write-time dedup judge did not run; ${gray.length} gray-band card(s) shipped unchecked against published cards.`
        );
      }
    }

    // The matcher's indices are into `live`, NOT into `curated` — remap or drop a
    // different, innocent card. See remapToOriginal's docblock.
    if (REWRITE_DEDUP_ENFORCE) {
      for (const original of remapToOriginal(wouldDrop, live.map((l) => l.idx))) rewriteDrop.add(original);
    }
    if (headlines.length > 0) {
      console.log(
        `Write-time rewrite dedup (B-023) [${mode}]: ${headlines.length} card(s) checked, ${hard.length} above threshold, ${gray.length} gray-band asked, ${wouldDrop.size} duplicate(s) ${REWRITE_DEDUP_ENFORCE ? "dropped" : "would drop"}.`
      );
    }
  }

  // 5. Write to DB — skipped entirely under CURATOR_DRY_RUN (model-audit evals:
  // exercise the real pipeline/candidates/verifiers against prod data with zero
  // writes).
  let inserted = 0;
  let dropped = 0;
  let leakDropped = 0;
  for (const [idx, item] of curated.entries()) {
    // Counted APART from `dropped`, which the completion line reports as "dropped by verifiers"
    // and check-curator-supply.mjs reads as the B-027 wipeout denominator. A deterministic guard
    // is not a judge: a batch lost to prompt leaks would otherwise print "the judges were ASKED
    // and refused everything" and send the reader to a prompt that is not the problem.
    if (leakDrop.has(idx)) {
      leakDropped++;
      continue;
    }
    if (verifier.rejected.has(idx) || faithDrop.has(idx) || attributionDrop.has(idx) || rewriteDrop.has(idx)) {
      dropped++;
      continue;
    }
    const candidate = filtered[item.candidate_index];
    if (!candidate) {
      console.warn(`Invalid candidate_index: ${item.candidate_index}`);
      continue;
    }

    const validCategories = ["politics", "philanthropy", "business", "sec_filing", "controversy"];
    const category = validCategories.includes(item.category) ? item.category : "business";

    // R-048 third leg, instrumented (2026-08-14). LOG-ONLY: no gate, no drop, no
    // behavior change — five candidate rules looked obviously right and were wrong
    // on live data in B-021, so this prints a number and decides nothing.
    // TWO numbers because they answer different questions, and the divergence is
    // the whole point: `src` is the score the SELECTION saw (the raw article the
    // pre-rank admitted), `card` is what the READER gets (the GPT rewrite). A high
    // src with a low card means the rewrite drained the receipt; a low src that
    // shipped at all means the pre-rank never knew it was off-axis. Until now the
    // third leg was judged by eye — 3/3, 2/5, 2/5 on three consecutive days.
    const srcScore = accountabilityScore(candidate.article.title, candidate.article.body);
    const cardScore = accountabilityScore(item.headline, item.summary);
    // `src` FIRST, and `card` labelled as the rewrite score. On 2026-08-17 the day's one
    // card printed src 4 / card 17 — a 4.25x inflation — so quoting `card` alone reports
    // that the REWRITE looks on-axis, not that the feed is. Standing reporting rule since.
    const axisTag = `[axis src ${srcScore} / card ${cardScore} (rewrite)]`;

    // WHICH RANK DID PASS A ACTUALLY PICK? (added 2026-08-17, R-048.) The axis tag above
    // says what the selected article scored; it cannot say what Pass A DECLINED to select.
    // On 2026-08-17 Pass A passed over the two best on-axis events — [12] "Gates Foundation
    // $540M gift" and [10] "Errol Musk admits the family foundation funded Tommy Robinson's
    // trip" — and published a src-4 hedged allegation instead. That was only visible because
    // the passed-over list happens to print scores; nothing said "it picked rank 15 of 17".
    //
    // A selection-from-the-bottom pattern and a correct duplicate-avoidance pattern look
    // IDENTICAL in one run, which is exactly why this prints a number and decides nothing:
    // Pass A may be right to skip a near-duplicate of a card already on the feed. Across a
    // sample the two separate, and R-048's 08-21 read is where that happens.
    //
    // LOG-ONLY: no gate, no drop, no threshold, no model — same shape as the 08-14 tag it
    // extends. Prints ALWAYS, including when the pick IS rank 1, because "picked the best
    // available" is the positive control proving the reader works (KP-93).
    const pickScore = scoreOf.get(candidate) ?? 0;
    const pickRank = filtered.indexOf(candidate) + 1;
    const rankTag =
      pickRank > 0
        ? `[pick rank ${pickRank}/${filtered.length} pre-rank ${pickScore}, best available ${hi}]`
        : `[pick rank UNRESOLVED — candidate not in the sent set; do not read this run's rank]`;

    if (CURATOR_DRY_RUN) {
      inserted++;
      console.log(`  [DRY RUN] + ${item.headline.slice(0, 60)}... [${category}] ${axisTag} ${rankTag}`);
      continue;
    }

    // One transaction per card: the item row and its person link land together
    // or not at all — a crash between the two would otherwise leave an orphan
    // card that renders with no attached person (and no receipt).
    await db.transaction(async (tx) => {
      const [feedItem] = await tx
        .insert(feedItems)
        .values({
          headline: item.headline,
          summary: item.summary,
          sourceUrl: candidate.article.url,
          sourceName: sourceLabel(candidate.article.source, candidate.article.url),
          category,
          contextData: candidate.context,
          curationScore: String(Math.min(100, Math.max(0, item.curation_score || 50))),
          publishedAt: new Date(candidate.article.date || new Date()),
        })
        .returning();

      await tx.insert(feedItemPersons).values({
        feedItemId: feedItem.id,
        personId: candidate.personId,
      });
    });

    inserted++;
    console.log(`  + ${item.headline.slice(0, 60)}... [${category}] ${axisTag} ${rankTag}`);
  }

  // B-052 — record the VERIFIER refusals so they stop returning at full rank tomorrow.
  //
  // AFTER the publish loop and inside try/catch, both deliberately: a cooldown row is worth
  // strictly less than a card, so nothing here may cost a publication or turn a good run
  // red. (Round 2 of the 09-19 review put this BEFORE the loop, where one malformed verdict
  // would have stopped unrelated accepted cards from publishing.)
  //
  // GATED ON `verifier.ran`, not on `verifier.rejected` alone. Pass B adds to `rejected`
  // as it parses and only then sets `ran`, so a verdict list that throws half way leaves a
  // PARTIAL rejected set behind a `ran: false` / `failedOpen: true` result. Writing that set
  // would turn a judge the run itself declares did-not-run into a durable 14-day
  // suppression, while `JUDGE-FAILED-OPEN relevance` sits in the same log saying the gate
  // never ran — asked-and-could-not-answer recorded as answered.
  if (!CURATOR_DRY_RUN && verifier.ran) {
    try {
      const refusedRows = refusedCooldownRows(curated, filtered, verifier.rejected);
      if (refusedRows.length > 0) await db.insert(curatorPassedOver).values(refusedRows);
      // Printed on EVERY run that got here, including the zero — otherwise "the write never
      // ran" and "there was nothing to write" are the same silence, which is the distinction
      // this repo has already been bitten by on its judges. ASCII token so a CI log grep
      // finds it; the reader in scripts/read-curator-run.mjs matches on PASSB-COOLED.
      console.log(`PASSB-COOLED n=${refusedRows.length} (person-scoped, ${COOLDOWN_DAYS}d window)`);
    } catch (err) {
      // A cooldown row is worth strictly less than a card, and every card is already
      // committed by here — so this warns and the run stays green.
      console.warn(`PASSB-COOLED-FAILED (cards are unaffected): ${String(err)}`);
    }
  } else if (!CURATOR_DRY_RUN) {
    console.log(`PASSB-COOLED n=0 (skipped: Pass B did not run, so its rejected set is not a verdict)`);
  }

  // R-048 — Pass C drops cool the ARTICLE, person-blind, so a story the faithfulness judge
  // refused stops re-entering the selector at full rank (One Bead: five consecutive runs).
  // Tier 1 at most for an on-axis story — see faithfulnessCooldownRows for why that is safe
  // against a false drop. Same placement and guards as the Pass B write above: after the
  // publish loop, inside try/catch, gated on the judge having run. `faithDrop` holds only
  // ENFORCED drops, so a SHADOW-mode Pass C cools nothing. The count prints on a dry run too,
  // with nothing written, so the wire-up is checkable without a prod write.
  if (faith.ran) {
    const passCRows = faithfulnessCooldownRows(curated, filtered, faithDrop);
    if (CURATOR_DRY_RUN) {
      console.log(`PASSC-COOLED n=${passCRows.length} (dry run — NOT written; person-blind, ${COOLDOWN_DAYS}d window)`);
    } else {
      try {
        if (passCRows.length > 0) await db.insert(curatorPassedOver).values(passCRows);
        console.log(`PASSC-COOLED n=${passCRows.length} (person-blind, ${COOLDOWN_DAYS}d window)`);
      } catch (err) {
        console.warn(`PASSC-COOLED-FAILED (cards are unaffected): ${String(err)}`);
      }
    }
  } else {
    console.log(`PASSC-COOLED n=0 (skipped: Pass C did not run, so it dropped nothing)`);
  }

  console.log(`\nFeed curation complete: ${inserted} items added${dropped > 0 ? `, ${dropped} dropped by verifiers` : ""}.`);
  // Its own sentence, AFTER the parsed one: check-curator-supply.mjs reads
  // `(\d+) items added(?:, (\d+) dropped by verifiers)?` and must keep reading the judges' number.
  if (leakDropped > 0) {
    console.log(`Prompt-leak guard (B-056) dropped ${leakDropped} more, counted apart from the verifiers' figure above.`);
  }
  // Per-run cost visibility (D-001). Per-role rates (GPT-5.6 model-audit wave,
  // 2026-07-10): each pass is priced at ITS OWN model, not one blended guess — the
  // prior single hardcoded rate under-reported spend whenever a role ran a
  // different-priced model (true since before W-005).
  const inTok = gen.inTok + verifier.inTok + faith.inTok + dedupInTok;
  const outTok = gen.outTok + verifier.outTok + faith.outTok + dedupOutTok;
  const genCost = estimateCostUsd(GENERATOR_MODEL, gen.inTok, gen.outTok);
  const verCost = estimateCostUsd(VERIFIER_MODEL, verifier.inTok, verifier.outTok);
  const faithCost = estimateCostUsd(FAITHFULNESS_MODEL, faith.inTok, faith.outTok);
  // One unpriced leg makes the TOTAL unknown too — a partial sum printed as a
  // confident total is the same $0-reads-as-free defect one level up.
  // dedupInTok/dedupOutTok merge Pass D's two same-event passes (B-022 candidate,
  // B-023 rewrite), which are now two registry seats. They resolve to the same
  // model by default, so this line is exact today; override one seat apart and it
  // becomes an approximation. The authoritative per-seat cost is the llm-call-log
  // rows, which carry each pass's own model — this console line is a run receipt.
  const dedupCost = estimateCostUsd(SAME_EVENT_B022_SEAT.model, dedupInTok, dedupOutTok);
  const legs = [genCost, verCost, faithCost, dedupCost];
  const estCost = legs.some((c) => c === null) ? null : legs.reduce((a, b) => a! + b!, 0);
  console.log(
    `Tokens used: ${inTok} in + ${outTok} out (all passes) — est. cost ${fmtCostUsd(estCost)} ` +
      `(Pass A ${fmtCostUsd(genCost)} @ ${GENERATOR_MODEL}, Pass B ${fmtCostUsd(verCost)} @ ${VERIFIER_MODEL}, Pass C ${fmtCostUsd(faithCost)} @ ${FAITHFULNESS_MODEL}, dedup ${fmtCostUsd(dedupCost)} @ ${SAME_EVENT_B022_SEAT.model})`
  );
  // A fail-open judge FAILS THE RUN. The cards are already written by this point, and
  // that is the point: a red run is the only signal that reaches anyone without being
  // asked for. The alternative — a warning inside a green run's log — is what we had,
  // and it is read by nobody on the day it matters. check:curator greps the same marker
  // for anyone reading after the fact, but this is the half that runs on its own.
  const judgeFailedOpen = verifier.failedOpen || faith.failedOpen || dedupJudgeFailedOpen || rewriteJudgeFailedOpen;
  if (judgeFailedOpen) {
    console.error(
      "\nRun marked FAILED: at least one fail-open judge did not run, so this run's cards " +
        "bypassed a gate. The cards are live — review them, do not just re-run."
    );
  }
  // ⚠ MUST precede process.exit. A hard exit kills every in-flight LLM-log POST
  // with no error anywhere, so without this line the wiring would look correct
  // and publish approximately nothing. Bounded by each post's abort timeout.
  await flushLlmLogs();
  process.exit(judgeFailedOpen ? 1 : 0);
}

// Only run when this file IS the entrypoint. Importing it must never execute
// the script — these scripts mutate prod. See is-main.ts.
if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error("Feed curation failed:", err);
    process.exit(1);
  });
}
