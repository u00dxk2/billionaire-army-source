/**
 * Profile Summary Generator (model read from `model-seats.json` seat
 * `profile-summary:generate` — default gpt-5.6-terra since the owner's 2026-09-06
 * pick; still overridable by SEAT_PROFILE_SUMMARY_GENERATE_MODEL, then by the
 * legacy SUMMARY_MODEL)
 *
 * Takes each person's raw structured data (SEC filings, 990s, FEC, news, net worth)
 * and generates a clear, source-cited narrative summary. Stored as a person_fact
 * with factType "summary", factKey "profile_summary".
 *
 * Output structure (JSON):
 * {
 *   overview: "One-paragraph bio synthesizing who they are and how they built wealth",
 *   business: "SEC filings context — what companies, insider activity, key holdings",
 *   philanthropy: "Foundation data — assets, grants, what the numbers mean",
 *   political: "FEC data — who they donate to, patterns, party lean",
 *   newsDigest: "What recent headlines say — themes, sentiment, notable stories",
 *   dataSources: ["wikidata", "sec_edgar", "propublica_990", "fec", "newsapi"],
 *   generatedAt: "ISO date",
 *   model: "gpt-5.6-terra"
 * }
 *
 * Usage: npm run generate:summaries (or: npx tsx src/fetchers/profile-summary.ts)
 * Requires: OPENAI_API_KEY environment variable
 */

import { readFileSync } from "fs";
import { createHash } from "crypto";
import OpenAI from "openai";
import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, sql } from "drizzle-orm";
import { temperatureOpt } from "./openai-model-opts";
// Portfolio LLM-call log (S-20260905-45). ⚠ main() ends in process.exit(0) —
// see the flushLlmLogs call there.
import { postLlmCall, usageOf, flushLlmLogs } from "./llm-call-log";
// Model-registry resolver (portfolio standard, 2026-09-06). SUMMARY_MODEL and
// SUMMARY_FAITHFULNESS_MODEL survive as each seat's `legacyEnv` and still win.
import { resolveSeat } from "../model-seats";
// Native Anthropic branch for the JUDGE seat below (2026-09-06). The registry can
// point profile-summary:faithfulness-verifier at claude-sonnet-5 — it currently
// audits a writer on the same model — and this package spoke only OpenAI, so that
// override would have sent a Claude id to api.openai.com. NOT a router: the
// generator's OpenAI call and this verifier's OpenAI call are both untouched.
import { createAnthropicJudge, isAnthropicModel, verdictTool } from "../anthropic-judge";
import { buildUserPrompt } from "./summary-prompt";
// B-045's deterministic block + the SAME prompt shaping buildUserPrompt applies, so the comparison
// set is the figures this summary was actually written from (merged party buckets included).
// applyFigureBlock is its C2 consequence (keep the published section, quarantine the candidate).
// applyApprovedSections is B-046: a section marked as hand-approved keeps its published text.
import {
  applyApprovedSections,
  applyFigureBlock,
  preservedSectionDates,
  type SectionApproval,
  storedFiguresForSummary,
  stripPipelineCommentary,
  summarySelfNarration,
  isFecRecordImpossible,
  SUMMARY_QUARANTINE_FACT_KEY,
  type QuarantineEntry,
} from "@ba/shared";
import {
  collapseFoundationTotalsForPrompt,
  labelFecMoneyForPrompt,
  labelFecTruncationForPrompt,
} from "./summary-fact-collapse";
import { isMain } from "../is-main";

const databaseUrl = process.env.DATABASE_URL;
const openaiKey = process.env.OPENAI_API_KEY;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!openaiKey) { console.error("OPENAI_API_KEY is required"); process.exit(1); }

const db = createDb(databaseUrl);
const openai = new OpenAI({ apiKey: openaiKey });

// Profile summarization is grounded narrative generation in the platform voice
// (inline citations, no fabrication). Pinned to one role constant (atomic-ops
// un-weld, 2026-06-30) so a future model change is one config edit AND the stored
// `model` metadata can never drift from the model actually called. Env-overridable.
// GPT-5.6 model-audit wave (2026-07-10): re-tiered gpt-5.4-mini -> gpt-5.6-luna after
// a clean 10-profile sample (marquee + long-tail) showed equal-or-better precision
// (more granular FEC/SEC cross-references) at a trivial cost delta given this
// generator's local/occasional-batch cadence, not a scheduled job. Needed
// max_completion_tokens raised 1000->2000 (luna's reasoning overhead could otherwise
// truncate to empty content before any JSON — see the call site). Revert = set back
// to "gpt-5.4-mini". Detail: docs/model-audit-billionaire-army-2026-07-10.md.
// 2026-09-06 (the owner's inventory ruling): the string moved
// into model-seats.json and his pick re-tiers this seat luna -> gpt-5.6-terra.
// He picked terra where a user reads prose, and this seat writes the profile
// prose on every /billionaires/[id] page. Revert = SEAT_PROFILE_SUMMARY_GENERATE_MODEL.
const SUMMARY_SEAT = resolveSeat("profile-summary:generate");
const SUMMARY_MODEL = SUMMARY_SEAT.model;

// Faithfulness gate (R9 quality-gate wave, 2026-06-30). The summary is generated
// from provided structured facts about a REAL NAMED billionaire and inserted to
// prod with no check that the prose stays grounded — it is the partner-demo first
// impression (daily-ten card #1 + every /billionaires/[id]) and, via the AEO
// baseline, crawlable + citeable by GPTBot/ClaudeBot, so an invented claim is a
// defamation surface even at ~0 users. This refute-only pass (cloned from the feed
// curator's verifier scaffold — VENDORED, not imported, because the GH-Actions
// checkout can't reach skylark-site's .mjs helpers) asks per section: does every
// claim/number trace to a provided fact? SHADOW-FIRST: default LOGS would-omit
// sections without changing output; set SUMMARY_FAITHFULNESS_ENFORCE=1 to OMIT a
// failing section (fail-closed-to-omit — for a named person a missing section beats
// a fabricated one) once the shadow logs validate the calibration.
const FAITHFULNESS_SEAT = resolveSeat("profile-summary:faithfulness-verifier");
const FAITHFULNESS_MODEL = FAITHFULNESS_SEAT.model;
const FAITHFULNESS_ENFORCE = process.env.SUMMARY_FAITHFULNESS_ENFORCE === "1";

// Sections the verifier rejected while the gate was LOG-ONLY — i.e. flagged and published anyway.
// Counted so the closing summary can state it; a run that flags 90 sections and says nothing about
// them at the end is how 2026-09-13's list of published-then-corrected figures happened.
let flaggedPublished = 0;

// Sections B-045's deterministic block QUARANTINED (C2, 2026-09-17 ruling), split by consequence:
// kept = the already-published section stayed live; withheld = first generation, nothing published.
// Counted beside flaggedPublished so a run that quarantines nothing says so rather than staying silent.
let figureKept = 0;
let figureWithheld = 0;
// First generations the block left with NO section at all — B-045's closeWhen escalates these to a
// owner card, so the run names each one rather than writing an empty summary quietly.
let figureEmptied = 0;

// Sections the block could NOT judge because the person's record is over MAX_FIGURES_FOR_DERIVATION.
// Counted SEPARATELY from figureBlocked on purpose: those sections published without being checked,
// and folding them into "0 blocked" is exactly the shape where a refusal reads as a clean pass.
let figureRefused = 0;
// B-046: hand-approved sections this run KEPT, and markers it could NOT honour. Both are stated at
// zero in the closing line, because "nothing was marked" and "the marker was unreadable" are
// otherwise the same silence — and the second one overwrites a ruled paragraph.
let approvedKept = 0;
let approvedIgnored = 0;
// B-060: (a)-class self-narration sentences in this run's candidates — SHADOW, logged and published.
let selfNarrationShadow = 0;

// GPT-5.6 model-audit wave (2026-07-10). PROFILE_DRY_RUN skips the DB delete/insert
// (local eval against real data, zero prod writes). SUMMARY_SHADOW_FAITHFULNESS_MODEL,
// if set, runs a second faithfulness pass with that model for comparison logging only
// — never changes what gets omitted. This is the mechanism for a FRESH shadow
// calibration attempt with a new judge model, per the 2026-07-10 freeze-override
// decision (the profile-faithfulness gate is otherwise under a standing do-not-
// recalibrate ruling — see docs/cold-starts / memory project_r021_faithfulness_gate_calibration.md).
const PROFILE_DRY_RUN = process.env.PROFILE_DRY_RUN === "1";
const SHADOW_FAITHFULNESS_MODEL = process.env.SUMMARY_SHADOW_FAITHFULNESS_MODEL;

// B-060 (2026-09-25) — RE-THOUGHT, not patched: the voice rules below replace the 2026-03-09 opening
// ("transform raw structured data…", "ONLY state facts supported by the data provided"), which framed
// the job as describing an input — and the model did: 116 sentences across 104 of 948 stored summaries
// narrated our pipeline ("The supplied NewsAPI results include two validated articles…"). The fix is the
// journalist's attribution convention — attribute to the SOURCE (the filing, the outlet), never to the
// PROCESS that gathered it — plus removing the pipeline bookkeeping from the input (newsFactForPrompt).
// Measured with `npm run check:summary-self-narration`; the truncation and party-bucket rules are
// unchanged verbatim (probe-fec-cap and check:party-sum read their output).
const SYSTEM_PROMPT = `You write the profile summaries for Billionaire Army, a civic accountability platform, the way a careful investigative journalist writes a profile of a real, named U.S. billionaire: every fact comes from a public record or a published article, and every fact is attributed to that record or outlet — never to the process that gathered it.

Rules:
- ONLY state facts the records below support. Never fabricate or assume.
- Attribute each fact to its SOURCE, as a reporter would: "FEC filings show…", "According to SEC filings…", "Form 990 filings show…". For a news fact, name the outlet EXACTLY as it appears in that article's "source" field ("<source> reported…"), or a publication the article's own text credits; never name an outlet that appears nowhere in the records below. If you cannot tell which article a fact came from, write "news reports said…".
- Never describe the material you were handed. The reader sees the public record, not our pipeline: never write "supplied", "provided", "the data", "the dataset", "the records below", "search results" or "the results" (meaning what was retrieved), "validated", "listed in the profile data", how many articles or results there were, sentiment scores, or a data vendor (NewsAPI, GDELT) as the subject of a sentence.
- Also tag each claim with its source in brackets: [SEC EDGAR], [ProPublica 990], [FEC], [NewsAPI], [Wikidata], [RTB]. The tags render as small source labels; they do not replace naming the filing or outlet in the sentence.
- Label estimates: "estimated net worth of ~$X" (never state net worth as exact).
- Use plain language. Explain what SEC forms and filing types mean for a general audience.
- Highlight noteworthy patterns (e.g., "all donations went to one party", "foundation has large assets but $0 grants paid", "very active insider trading").
- No opinions. No adjectives like "generous" or "controversial." Let the facts speak.
- If a data object says its record is TRUNCATED, never state its count, total, or date range as if it were complete: write "at least N", and say the figures cover only the sampled records.
- A party breakdown is ALL of partyBreakdownUsd or none of it. If you state any party amount, state EVERY bucket, including small ones (a $19.24 bucket is still a bucket) — a reader adds the parts and must reach the total you stated. If you will not list them all, give the total without party amounts.
- If a data section is missing, or says nothing about this person, omit that section entirely — never write that something is missing, unavailable, not specified, or not included.
- Keep each section to 2-4 sentences. Be concise.
- For the overview, synthesize the person's identity: who they are, how they built their wealth, key facts.

Return valid JSON with these fields (omit any field where you have no data):
{
  "overview": "string",
  "business": "string",
  "philanthropy": "string",
  "political": "string",
  "newsDigest": "string"
}`;

// Refute-only faithfulness auditor (R9). Judges ONLY whether each written section
// is grounded in the provided source data; writing quality/completeness is out of
// scope. Per-section verdicts so enforcement can OMIT one bad section, not the whole
// summary.
const FAITHFULNESS_SYSTEM_PROMPT = `You are a faithfulness auditor for Billionaire Army. Another model wrote a profile summary about a real, named U.S. billionaire from the structured data below. You are NOT judging writing quality or completeness — ONLY whether each section is GROUNDED in the provided data.

You are given the SOURCE DATA (the only facts the writer was allowed to use) and the WRITTEN SECTIONS (overview, business, philanthropy, political, newsDigest). For EACH written section, REJECT it if it contains ANY claim, number, dollar figure, company, office, donation, relationship, or attribution NOT supported by the source data. Specifically reject a section that:
- States a net worth, asset, grant, or donation figure not present in — or contradicting — the source data.
- Names a company, foundation, candidate, party, or office the source data does not tie to this person.
- Asserts wrongdoing, investigation, or a causal claim the data does not contain.
- Generalizes beyond the data (e.g. "a major Republican donor") when the data does not support it.

KEEP a section whose every claim and number is traceable to the source data. A section that merely explains what a data point means (e.g. what an SEC Form 4 is) is fine. Default to REJECT when a figure or a wrongdoing claim cannot be traced — for a real named person a fabricated claim is a legal and credibility risk.

CRITICAL — what counts as "source data" and what is NOT a violation (R9 backtest calibration, 2026-06-30):
- NEWS ARTICLE DATA IS SOURCE DATA. Fact keys like GDELT ARTICLES / NEWS HEADLINES contain article titles and bodies — a claim traceable to ANY article title or body in that JSON is GROUNDED, even if paraphrased or summarized. Example: if an article title says "Anthropic CEO Dario Amodei," then "he is the CEO of Anthropic" is SUPPORTED. Do NOT reject a claim that restates or paraphrases a provided article.
- IGNORE CITATION-LABEL MISMATCH. The bracketed tags the writer uses ([NewsAPI], [GDELT], [RTB], [Wikidata], etc.) are cosmetic citation labels, NOT claims. NEVER reject a section because its tag names a different source than the data's [source: …] label (e.g. writer wrote [NewsAPI] but the data is tagged gdelt). Judge ONLY the factual content, never the citation tag.
- A statement that NO validated articles exist (when validatedResults=0) is ACCURATE — KEEP it regardless of its citation tag.

REJECT only a genuine FACTUAL violation: a number/figure absent from or contradicting the data, a company/foundation/office/donation the data does not tie to this person, a date misstatement (e.g. treating birth–death years as service/tenure years), or a wrongdoing/causal claim no provided article or fact supports.

Return JSON: { "sections": [ { "section": "overview", "verdict": "KEEP", "reason": "short phrase" } ] } — one entry per WRITTEN section, using the exact section names given. Start each REJECT reason with the unsupported element.`;

// The Anthropic branch's structured-output contract — the SAME shape the prompt
// above already asks for, expressed as a forced tool's JSON Schema because
// Anthropic has no `response_format`. This seat keys by SECTION NAME, not by
// index, so the parser below reads `v.section`; the schema says so too.
const SECTION_FAITHFULNESS_TOOL = verdictTool({
  name: "record_section_faithfulness_verdicts",
  description: "Record one KEEP/REJECT faithfulness verdict per written profile section.",
  envelope: "sections",
  key: "section",
  keyType: "string",
  keyDescription: "The section name exactly as it was given to you (e.g. overview, newsDigest).",
  verdicts: ["KEEP", "REJECT"],
});

export interface PersonData {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  birthYear: number | null;
  country: string | null;
  facts: {
    factKey: string;
    factValue: unknown;
    sourceType: string | null;
  }[];
}

// R-021 clinic fix (2026-07-01): hash of the exact fact-state fed to the generator,
// stored alongside the summary so a future faithfulness backtest can tell "unfaithful
// at write time" apart from "facts drifted since" instead of conflating them — the
// confound behind the out-of-sample re-validation's 20.9% reject rate (see MEMORY.md
// R-021 / B-011). A backtest that re-hashes current facts and finds a mismatch knows
// the summary is stale, not necessarily unfaithful.
function hashFacts(facts: PersonData["facts"]): string {
  const canonical = [...facts]
    .sort((a, b) => a.factKey.localeCompare(b.factKey))
    .map((f) => ({ factKey: f.factKey, factValue: f.factValue, sourceType: f.sourceType }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}


/** Exported for the NO-WRITE fresh-prose probe (scripts/probe-fresh-block.mjs). Importing this module runs nothing: `main()` is behind `isMain`. */
export async function generateSummary(person: PersonData): Promise<{
  overview?: string;
  business?: string;
  philanthropy?: string;
  political?: string;
  newsDigest?: string;
} | null> {
  const userPrompt = buildUserPrompt(person);

  const startedAt = Date.now();
  // One row per CALL, never per exit path: JSON.parse below runs after a
  // successful response, so without this latch a parse failure would emit a
  // second row for a call that was already logged and inflate the seat's count.
  let logged = false;
  try {
    const response = await openai.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      ...temperatureOpt(SUMMARY_MODEL, 0.3),
      // GPT-5.6 model-audit wave (2026-07-10): reasoning-family models (5.6) can
      // spend part of this budget on hidden reasoning tokens before any visible
      // JSON, so 1000 was tight enough to occasionally truncate to empty content
      // (finish_reason "length", observed live during the luna eval). 2000 gives
      // headroom; still trivial cost at any of our per-role rates.
      max_completion_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    // The empty-content case is the one this seat has actually hit in the wild
    // (luna's reasoning overhead truncating before any JSON, 2026-07-10), and
    // it bills a full prompt for nothing — so it is a row, with the provider's
    // own finish_reason attached, not a silent skip.
    logged = true;
    postLlmCall({
      model: SUMMARY_MODEL,
      callSite: "profile-summary:generate",
      taskStatus: content ? "ok" : "empty_content",
      ...usageOf(response),
      latencyMs: Date.now() - startedAt,
      extra: {
        finishReason: response.choices[0]?.finish_reason ?? "unknown",
        modelSource: SUMMARY_SEAT.source,
      },
    });
    if (!content) {
      console.warn(`    Empty content from ${SUMMARY_MODEL} (finish_reason: ${response.choices[0]?.finish_reason || "unknown"}) — skipping.`);
      return null;
    }

    return JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    Error: ${msg}`);
    // Reached from the API call (never logged yet, usage unknown — omitted,
    // never 0) or from JSON.parse (already logged with its real usage).
    if (!logged) {
      postLlmCall({
        model: SUMMARY_MODEL,
        callSite: "profile-summary:generate",
        taskStatus: "fail",
        latencyMs: Date.now() - startedAt,
        extra: { modelSource: SUMMARY_SEAT.source },
      });
    }
    return null;
  }
}

export interface SummaryShape {
  overview?: string;
  business?: string;
  philanthropy?: string;
  political?: string;
  newsDigest?: string;
}

const SUMMARY_SECTIONS = ["overview", "business", "philanthropy", "political", "newsDigest"] as const;

/**
 * Refute-only faithfulness pass (R9). Returns the set of section names whose prose
 * contains a claim/number not traceable to the person's source data. Fail-OPEN: a
 * transient verifier failure rejects nothing (keeps today's behavior) — the gate is
 * an additive safety net, never a reason to lose a run.
 */
async function verifyFaithfulness(
  person: PersonData,
  summary: SummaryShape,
  model: string = FAITHFULNESS_MODEL,
  // Where `model` came from, recorded on the log row. The shadow caller passes
  // "shadow-env": its rows share this seat's callSite (they always have), so
  // without this field two models sit under one seat with nothing saying which.
  modelSource: string = FAITHFULNESS_SEAT.source
): Promise<{ ran: boolean; rejected: Set<string>; reasons: Map<string, string> }> {
  const out = { ran: false, rejected: new Set<string>(), reasons: new Map<string, string>() };
  const written = SUMMARY_SECTIONS.filter((s) => summary[s]);
  if (written.length === 0) return out;

  const sourceData = buildUserPrompt(person);
  const sectionsText = written.map((s) => `--- ${s} ---\n${summary[s]}`).join("\n\n");
  const userPrompt = `SOURCE DATA (the only facts the writer could use):\n${sourceData}\n\n=== WRITTEN SECTIONS TO AUDIT ===\n${sectionsText}\n\nFor each written section, is every claim and number traceable to the source data above? Return a verdict per section.`;

  const startedAt = Date.now();
  let logged = false;
  // Takes the already-extracted token classes rather than a raw provider
  // response: the two branches below report usage in different field names, and
  // a logger that only knows OpenAI's would silently log nothing for the other.
  const log = (taskStatus: string, usage?: ReturnType<typeof usageOf>) =>
    logged
      ? undefined
      : ((logged = true),
        postLlmCall({
          model,
          callSite: "profile-summary:faithfulness-verifier",
          taskStatus,
          ...(usage ?? {}),
          latencyMs: Date.now() - startedAt,
          extra: { sections: written.length, modelSource },
        }));

  try {
    let content: string | null | undefined;
    let usage: ReturnType<typeof usageOf> = {};
    if (isAnthropicModel(model)) {
      const judge = createAnthropicJudge("profile-summary:faithfulness-verifier", model, {
        overrideVar:
          modelSource === "shadow-env" ? "SUMMARY_SHADOW_FAITHFULNESS_MODEL" : undefined,
      });
      const answer = await judge.judge({
        system: FAITHFULNESS_SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 800,
        tool: SECTION_FAITHFULNESS_TOOL,
      });
      usage = {
        tokensIn: answer.tokensIn,
        tokensOut: answer.tokensOut,
        cachedInputTokens: answer.cachedInputTokens,
      };
      content = answer.content;
    } else {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: FAITHFULNESS_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        ...temperatureOpt(model, 0),
        max_completion_tokens: 800,
      });
      usage = usageOf(response);
      content = response.choices[0]?.message?.content;
    }

    if (!content) {
      console.warn("    Faithfulness verifier returned no content — failing open (sections kept).");
      log("empty_content", usage);
      return out;
    }
    log("ok", usage);

    const parsed = JSON.parse(content);
    const verdicts: { section?: string; verdict?: string; reason?: string }[] = Array.isArray(parsed)
      ? parsed
      : (Object.values(parsed).find((v) => Array.isArray(v)) as { section?: string; verdict?: string; reason?: string }[]) || [];

    for (const v of verdicts) {
      if (!v.section) continue;
      if (String(v.verdict).toUpperCase() === "REJECT") {
        out.rejected.add(v.section);
        out.reasons.set(v.section, v.reason || "unsupported claim");
      }
    }
    out.ran = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`    Faithfulness verifier failed (${msg}) — failing open (sections kept).`);
    log("fail");
  }

  return out;
}

/**
 * B-045 C2's consequence, applied where the write happens. `exec` is the transaction (`lock: true`,
 * so a correction committed while the LLM calls ran is seen here and not silently restored) or the
 * pool for a dry run. Returns what to write, the quarantine entries, and the original generation date
 * of every section it KEPT.
 */
export async function applyBlockAtWrite(
  exec: { execute: (q: any) => Promise<unknown> },
  personData: PersonData,
  candidate: SummaryShape,
  storedFigures: number[],
  lock: boolean,
): Promise<{
  summary: SummaryShape;
  quarantined: QuarantineEntry[];
  preservedAt: Record<string, string>;
  approvedSections: Record<string, SectionApproval>;
}> {
  // A STABLE per-person lock first (adversarial review round 2, 2026-09-24). FOR UPDATE on the summary
  // row alone is not enough: a concurrent run that deletes and re-inserts that row leaves this read,
  // under READ COMMITTED, seeing NO row — so it would treat an approved section as unpublished and
  // overwrite it. The persons row is never deleted by this job, so locking it serialises every write
  // for this person. Not exercised by the fake-exec tests; a source assertion pins it.
  if (lock) await exec.execute(sql`SELECT id FROM persons WHERE id = ${personData.id} FOR UPDATE`);
  const [row] = [...(await exec.execute(sql`
    SELECT fact_value FROM person_facts
    WHERE person_id = ${personData.id} AND fact_key = 'profile_summary'
    ORDER BY retrieved_at DESC LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `) as any)] as any[];
  let parsed: unknown = row?.fact_value ?? null;
  if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
  const published = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  // B-046 FIRST: a hand-approved section keeps its published text whatever the candidate says, so the
  // figure block below judges only the sections this run may actually rewrite. Read from the SAME
  // locked row as the block, for the same lost-update reason.
  const approval = applyApprovedSections(candidate as Record<string, unknown>, published, SUMMARY_SECTIONS);
  for (const p of approval.preserved) {
    console.log(`    ✓ HAND-APPROVED section "${p.section}" PRESERVED [B-046] — approved by ${p.approval.by} ${p.approval.date} (${p.approval.ruling})`);
    approvedKept++;
  }
  for (const i of approval.ignored) {
    console.log(`    ⚠ HAND-APPROVAL marker on "${i.section}" IGNORED [B-046] — ${i.reason}; that section is REWRITTEN`);
    approvedIgnored++;
  }
  const kept = new Set(approval.preserved.map((p) => p.section));
  const judged = SUMMARY_SECTIONS.filter((s) => !kept.has(s));

  const block = applyFigureBlock(approval.summary, published, judged, storedFigures);
  const summary = block.summary as SummaryShape;

  for (const sec of block.notJudged) {
    // Over MAX_FIGURES_FOR_DERIVATION: the record could not be enumerated, so NOTHING was judged.
    // Said out loud on purpose — a silent skip here is indistinguishable from a clean section,
    // and this is the one path where the block publishes without having looked.
    console.log(`    ⚠ FIGURE-BLOCK NOT JUDGED section "${sec}" — record over the derivation cap; published unchecked`);
    figureRefused++;
  }

  const preservedAt = { ...preservedSectionDates(published, block.quarantined), ...approval.preservedAt };
  for (const q of block.quarantined) {
    const detail = q.disagreements
      .map((d) => `states $${d.stated.toLocaleString("en-US")} where the stored record reads $${d.stored.toLocaleString("en-US")} (via ${d.via === "derived" ? "a derived sum" : "a stored figure"})`)
      .join("; ");
    const consequence = q.kept === "previous" ? "QUARANTINED, published section KEPT" : "QUARANTINED, first generation WITHHELD";
    console.log(`    ✗ FIGURE-BLOCK section "${q.section}" ${consequence} [B-045 C2, card 30cfaf53] — ${detail}`);
    if (q.kept === "previous") figureKept++;
    else figureWithheld++;
  }

  // WOULD A READER SEE ANY SECTION? Answered with the PROFILE'S OWN rules, not `trim()`: the page
  // strips pipeline commentary (a section that is only plumbing renders as nothing) and withholds the
  // political section entirely for a person whose FEC record the shared guard refuses.
  const fec = personData.facts.find((f) => f.factKey === "fec_contributions");
  const withholdPolitical = fec
    ? isFecRecordImpossible(String((fec.factValue as any)?.dateRange ?? ""), personData.birthYear)
    : false;
  const renders = (section: string) => {
    if (section === "political" && withholdPolitical) return false;
    const text = summary[section as keyof SummaryShape];
    return Boolean(stripPipelineCommentary(typeof text === "string" ? text : undefined));
  };
  if (block.quarantined.some((q) => q.kept === "withheld") && !SUMMARY_SECTIONS.some(renders)) {
    console.log(`    ⚠ ESCALATE [B-045 closeWhen] — nothing a reader would see is left after the figure block; card this for the owner`);
    figureEmptied++;
  }

  return { summary, quarantined: block.quarantined, preservedAt, approvedSections: approval.approvedSections };
}

async function main() {
  console.log(`=== Profile Summary Generator (${SUMMARY_MODEL}) ===\n`);

  // A RULING WITH NO MECHANISM IS INDISTINGUISHABLE FROM NO RULING AT THE MOMENT IT MATTERS.
  // The owner ruled on 2026-09-12 that the faithfulness verifier MAY hold back a section stating a
  // dollar figure that disagrees with our stored records. On 2026-09-13 an 855-profile run
  // published all 90 flagged sections because that block is not built and the gate is log-only —
  // and nothing said so until the run had finished. The run now states its own gate BEFORE the
  // first profile, so the gap is visible in the first line of the log rather than in the cleanup.
  console.log(
    FAITHFULNESS_ENFORCE
      ? `Faithfulness gate: ENFORCING — a section the verifier rejects is OMITTED.`
      : `Faithfulness gate: LOG-ONLY — the verifier flags sections and they are PUBLISHED ANYWAY (set SUMMARY_FAITHFULNESS_ENFORCE=1 to omit them).`,
  );
  console.log(
    `Figure block (B-045): ENFORCING — the owner's authorised block (card 30cfaf53) is LIVE, with the C2 consequence (ruling 2026-09-17): a candidate section stating a dollar figure that disagrees with the stored record is QUARANTINED, never published — the already-published section is KEPT, or on a first generation that one section is withheld. Deterministic, scoped to dollar figures, using derived sums of the person's own stored figures as both agreement and typo targets. Measured 2026-09-15 AFTER four adversarial rounds, over all 946 judged prod profiles: 0 of 3,333 live sections blocked, and recall 370 of 684 middle-digit typos = 54.1% (the 62.9% form excludes 96 typos the wider agreement publishes on purpose — same 370 catches, smaller denominator). It catches roughly half of one-digit transcription errors in 2-3 figure derivations — NOT every wrong figure, and review round 4 holds that no predicate of this shape can reach zero false deletions on unrestricted prose.`,
  );

  // Get all persons with their facts, ordered by fact count (richest data first)
  const allPersons = await db.execute(sql`
    SELECT p.id, p.name, p.state, p.industry, p.birth_year, p.country,
           COALESCE(
             json_agg(
               json_build_object(
                 'factKey', pf.fact_key,
                 'factValue', pf.fact_value,
                 'sourceType', pf.source_type
               )
             ) FILTER (WHERE pf.id IS NOT NULL),
             '[]'::json
           ) as facts,
           COUNT(pf.id) as fact_count
    FROM persons p
    LEFT JOIN person_facts pf ON pf.person_id = p.id
    WHERE pf.fact_key NOT IN ('profile_summary', ${SUMMARY_QUARANTINE_FACT_KEY})
    GROUP BY p.id
    ORDER BY COUNT(pf.id) DESC
  `);

  let personList = allPersons as any[];
  // Targeted regen: when SUMMARY_PERSON_IDS_FILE (a JSON array of person ids) is
  // set, only regenerate those persons — used after a data fix (e.g. the B-008
  // SEC matcher correction) to refresh only the affected summaries instead of
  // all ~1,000. Falls back to the full run when the env var is absent.
  const idFile = process.env.SUMMARY_PERSON_IDS_FILE;
  if (idFile) {
    const want = new Set<string>(JSON.parse(readFileSync(idFile, "utf8")));
    const full = personList.length;
    personList = personList.filter((r) => want.has(r.id));
    console.log(`Targeted regen via SUMMARY_PERSON_IDS_FILE: ${personList.length} of ${full} persons`);
  }
  console.log(`Processing ${personList.length} persons (most data-rich first)...\n`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of personList) {
    const personData: PersonData = {
      id: row.id,
      name: row.name,
      state: row.state,
      industry: row.industry || [],
      birthYear: row.birth_year,
      country: row.country,
      facts: row.facts || [],
    };

    // Skip persons with only net_worth (not enough to write about)
    const factKeys = personData.facts.map(f => f.factKey);
    const meaningfulFacts = factKeys.filter(k => k !== "net_worth");
    if (meaningfulFacts.length === 0) {
      skipped++;
      continue;
    }

    console.log(`  ${personData.name} (${row.fact_count} facts)...`);

    const candidate = await generateSummary(personData);

    if (!candidate) {
      errors++;
      continue;
    }

    /* B-045 — THE BLOCK, ENFORCING (card 30cfaf53, the owner 2026-09-12), with the C2 CONSEQUENCE
       (orchestrator ruling 2026-09-17, bus ac23cd8e). A candidate section stating a dollar figure that
       disagrees with the person's stored figures, or a 2-3 figure sum of them, NEVER publishes: the
       already-published section is KEPT, or on a first generation that one section is withheld, and
       the candidate goes to a quarantine row. Deterministic and independent of
       SUMMARY_FAITHFULNESS_ENFORCE — the LLM verdict below stays log-only; the wire-up test pins the
       separation. What it catches, never stated apart: ~56% of one-digit transcription errors
       (numbers on B-045) — and it also fires on true bounds it cannot enumerate, which is why the
       consequence keeps live text instead of deleting it. */
    const storedFigures = storedFiguresForSummary(
      personData.facts.map((f) => f.factValue),
      personData.facts.map((f) =>
        labelFecTruncationForPrompt(labelFecMoneyForPrompt(collapseFoundationTotalsForPrompt(f.factValue))),
      ),
    );
    // The block is APPLIED at the write, inside the transaction, against the row read there — see
    // applyBlock below. It cannot be applied here: verifyFaithfulness is an unbounded external call,
    // and a correction committed while it runs would be silently restored by a preservation decision
    // taken before it. Nothing about the PREDICATE waits; only the read of what is currently published.
    const summary = candidate as SummaryShape;

    // B-060 write-time guard, SHADOW ONLY: logs, never blocks or edits. A self-narration sentence
    // usually carries a real fact inside it ("The provided 2023 Form 990 records list two foundations
    // named…"), so dropping it would lose true content — the prompt is the fix, this is its tripwire.
    for (const { section, hits } of summarySelfNarration(summary)) {
      for (const h of hits) {
        selfNarrationShadow++;
        console.log(`    ○ SELF-NARRATION [B-060 shadow, published] section "${section}" — ${h.sentence.slice(0, 160)}`);
      }
    }

    // Faithfulness gate (R9). SHADOW-FIRST: log would-omit sections; only OMIT when
    // SUMMARY_FAITHFULNESS_ENFORCE=1 (fail-closed-to-omit for the defamation surface).
    const faith = await verifyFaithfulness(personData, summary);
    if (faith.ran && faith.rejected.size > 0) {
      const mode = FAITHFULNESS_ENFORCE ? "ENFORCE" : "SHADOW";
      for (const sec of faith.rejected) {
        console.log(`    ${FAITHFULNESS_ENFORCE ? "✗ OMIT" : "○ SHADOW-OMIT"} section "${sec}" [${mode}] — ${faith.reasons.get(sec)}`);
        if (FAITHFULNESS_ENFORCE) delete (summary as SummaryShape)[sec as keyof SummaryShape];
        else flaggedPublished++;
      }
    }

    // Judge-seat shadow eval (GPT-5.6 model audit, 2026-07-10): a FRESH calibration
    // attempt with a new judge model, comparison-logged only — never omits anything
    // itself. This gate previously failed out-of-sample re-validation (20.9% vs 4%
    // in-sample) and is under a standing do-not-recalibrate ruling; a new model is a
    // new attempt, so report its numbers honestly rather than treat this as a graduation.
    if (SHADOW_FAITHFULNESS_MODEL) {
      const shadow = await verifyFaithfulness(personData, summary, SHADOW_FAITHFULNESS_MODEL, "shadow-env");
      if (shadow.ran) {
        const agree = SUMMARY_SECTIONS.filter((s) => summary[s]).every((s) => faith.rejected.has(s) === shadow.rejected.has(s));
        console.log(`    [shadow ${SHADOW_FAITHFULNESS_MODEL}] ${shadow.rejected.size} would-reject (incumbent ${faith.rejected.size}) — ${agree ? "agrees" : "DISAGREES"} with incumbent`);
        for (const sec of shadow.rejected) {
          if (!faith.rejected.has(sec)) console.log(`      ○ shadow-only-reject "${sec}" — ${shadow.reasons.get(sec)}`);
        }
      }
    }

    if (PROFILE_DRY_RUN) {
      // No lock and no write: the dry run reports what the block WOULD do against what is published now.
      const dry = await applyBlockAtWrite(db, personData, summary, storedFigures, false);
      const sections = SUMMARY_SECTIONS.map((s) => dry.summary[s]).filter(Boolean);
      console.log(`    [DRY RUN] + ${sections.length} sections generated (not written)`);
      if (process.env.PROFILE_DRY_RUN_VERBOSE === "1") console.log(JSON.stringify(dry.summary, null, 2));
      generated++;
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    const now = new Date();
    let written = 0;

    // ONE TRANSACTION: the block's read of what is published, the quarantine row, the delete and the
    // insert commit together or not at all. The delete-then-insert was never atomic, and under C2 that
    // matters more: a failed insert after the delete would lose the very section the block just KEPT.
    // The read takes FOR UPDATE, so a correction committed during the LLM calls above is seen here
    // rather than silently restored. The quarantine row is appended and never deleted by this job, so
    // it survives every later regeneration; its key is excluded from every non-allowlist read path.
    await db.transaction(async (tx) => {
      const block = await applyBlockAtWrite(tx, personData, summary, storedFigures, true);
      const finalSummary = block.summary;
      written = SUMMARY_SECTIONS.filter((s) => finalSummary[s]).length;
      if (block.quarantined.length > 0) {
        await tx.insert(personFacts).values({
          personId: personData.id,
          factType: "quarantine",
          factKey: SUMMARY_QUARANTINE_FACT_KEY,
          factValue: {
            entries: block.quarantined,
            storedFigures: [...new Set(storedFigures)].sort((a, b) => a - b),
            generatedAt: now.toISOString(),
            model: SUMMARY_MODEL,
          },
          sourceUrl: "https://openai.com",
          sourceType: "llm_summary_quarantine",
          retrievedAt: now,
          estimationMethod: "figure_block_quarantine",
        });
      }

      // Delete old summary if exists
      await tx.delete(personFacts).where(
        and(eq(personFacts.personId, personData.id), eq(personFacts.factKey, "profile_summary"))
      );

      // Insert new summary
      await tx.insert(personFacts).values({
        personId: personData.id,
        factType: "summary",
        factKey: "profile_summary",
        factValue: {
          ...finalSummary,
          dataSources: [...new Set(personData.facts.map(f => f.sourceType).filter(Boolean))],
          generatedAt: now.toISOString(),
          // A section KEPT by C2 is the OLD paragraph and must not inherit today's date: the profile
          // reads generatedAt to decide whether the political prose predates its FEC record (R-077),
          // so a preserved paragraph stamped today would silence its own staleness caveat.
          ...(Object.keys(block.preservedAt).length > 0 ? { sectionGeneratedAt: block.preservedAt } : {}),
          // B-046: the marker is written FORWARD, or it protects exactly one regeneration.
          ...(Object.keys(block.approvedSections).length > 0 ? { approvedSections: block.approvedSections } : {}),
          model: SUMMARY_MODEL,
          sourceFactsHash: hashFacts(personData.facts),
        },
        sourceUrl: "https://openai.com",
        sourceType: "llm_summary",
        retrievedAt: now,
        estimationMethod: "llm_summary",
      });
    });

    console.log(`    + ${written} sections generated`);
    generated++;

    // Rate limit: ~1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== Summary Generation Complete ===`);
  console.log(`  Generated: ${generated}`);
  console.log(`  Skipped (insufficient data): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  // B-045 at the end too, and STATED AT ZERO on purpose — "no section disagreed with its stored
  // record" and "the block never ran" are the same silence otherwise, which is the exact shape that
  // let 90 flagged sections publish unremarked on 2026-09-13.
  console.log(`  Figure block (B-045, ENFORCING): ${figureKept + figureWithheld} section(s) QUARANTINED for stating a figure that disagrees with the stored record (${figureKept} published section(s) KEPT, ${figureWithheld} first-generation section(s) WITHHELD${PROFILE_DRY_RUN ? "; DRY RUN, nothing written" : `; read them: npm run check:summary-quarantine`}); ${figureEmptied} profile(s) left with NO section (escalate each); ${figureRefused} section(s) NOT JUDGED (record over the derivation cap, published unchecked).`);
  console.log(`  Self-narration (B-060, SHADOW — logged, never blocked): ${selfNarrationShadow} sentence(s) describing our own inputs were published; read the corpus: npm run check:summary-self-narration.`);
  console.log(`  Hand-approved sections (B-046): ${approvedKept} PRESERVED, ${approvedIgnored} marker(s) IGNORED (malformed or nothing to keep — each named above; an ignored section was REWRITTEN)${PROFILE_DRY_RUN ? "; DRY RUN, nothing written" : ""}.`);
  // The gate again, at the end, with its cost in this run. Stated even at zero: "the verifier
  // rejected nothing" and "the verifier never ran" are the same silence otherwise.
  console.log(
    FAITHFULNESS_ENFORCE
      ? `  Faithfulness gate ENFORCING — rejected sections were omitted.`
      : `  ⚠ Faithfulness gate LOG-ONLY — ${flaggedPublished} flagged section(s) were PUBLISHED ANYWAY.`,
  );
  // ⚠ MUST precede process.exit — a hard exit kills in-flight log POSTs
  // silently. See llm-call-log.ts.
  await flushLlmLogs();
  process.exit(0);
}

// Only run when this file IS the entrypoint. Importing it must never execute
// the script — these scripts mutate prod. See is-main.ts.
if (isMain(import.meta.url)) main();
