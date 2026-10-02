/**
 * B-060 — profile-summary SELF-NARRATION: the generator describing its own inputs to the reader.
 *
 * "The supplied NewsAPI results include two validated articles published from July 22 to July 27"
 * (Ankur Jain, live 2026-09-25) is not a claim about Ankur Jain. It is the model telling the reader
 * what we handed it — which reads as machine output nobody checked, on the page whose whole thesis
 * is that no claim outruns its citation. A journalist attributes to the SOURCE ("The Economic Times
 * reported…", "FEC filings show…"), never to the PROCESS.
 *
 * WHY A SEPARATE LIST FROM `meta-commentary.ts`. Those lists drive a RENDER-TIME sentence strip
 * (and, for the feed list, a DELETE). A strip removes the whole sentence, and most (a)-class hits
 * here carry a real fact inside the narration ("The provided 2023 Form 990 records list two
 * foundations named Sanford Foundation…") — stripping it would hide true content. So this list is
 * for COUNTING (the `check:summary-self-narration` instrument) and for a SHADOW write-time log in
 * the generator; the fix is the generator prompt, never a render strip. Do not add these to
 * `PROFILE_COMMENTARY_PATTERNS` without that trade argued.
 *
 * NARROW BY CONSTRUCTION (B-056's lesson). Every entry is calibrated on real stored prose — the
 * hand split of the 2026-09-25 B-043 regeneration snapshots (20 persons, before + after), where a
 * WIDE regex (`supplied|provided …|NewsAPI|validated articles`) hit 41 times on the after-set and
 * 34 of those were legitimate `[NewsAPI]` citation chips. (a) vs (b):
 *   (a) pipeline self-narration — "the supplied data", "the provided records", "the results also
 *       show", "two validated news articles", "NewsAPI validated two articles". COUNTED.
 *   (b) source attribution — "FEC records show", "ProPublica records list", "According to SEC
 *       filings", "The Economic Times reported", a bracketed `[NewsAPI]` chip, "provided $5 million"
 *       (a verb), "the data provided to Cambridge Analytica" (postposed, a real news shape).
 *       NEVER counted; `summary-self-narration.test.ts` pins both directions.
 */
import { splitSentences } from "./meta-commentary";

export type SelfNarrationPattern = { re: RegExp; label: string; seenOn: string };

export const SELF_NARRATION_PATTERNS: SelfNarrationPattern[] = [
  {
    // "the supplied data", "The provided annual Form 990 tax filings", "the provided financial
    // figures", "The supplied NewsAPI results". Requires the DETERMINER + participle + an input noun
    // within four words: "provided" as a verb ("provided $5 million") and the postposed news shape
    // ("the data provided to Cambridge Analytica") both stay out.
    re: /\bthe (?:supplied|provided)(?:\s+[\w'’-]+){0,4}?\s+(?:data(?:set)?|records?|results|filings?|figures|articles|information|titles?|sources?|materials?)\b/i,
    label: "cites its own input (the supplied/provided …)",
    seenOn: "Herbert Wertheim, Charlie Ergen (before); Ankur Jain, T. Denny Sanford, Palmer Luckey (after) — B-043 snapshots 2026-09-25",
  },
  {
    // "Two validated news articles", "two validated articles", "Two validated August 2026 articles",
    // "NewsAPI validated two articles". `validated` is our relevance gate's word (validatedResults).
    // Singular too: "A validated August 4, 2026 news result reported…" (Travis Kalanick, old-prompt sample).
    re: /\bvalidated(?:\s+[\w'’,-]+){0,3}?\s+(?:news\s+)?(?:articles?|results?|stories|reports)\b/i,
    label: "narrates pipeline validation state (validated articles)",
    seenOn: "Justin Ishbia, Charlie Ergen, John Overdeck, Ankur Jain — B-043 snapshots 2026-09-25; Travis Kalanick — old-prompt sample 2026-09-25",
  },
  {
    // Retrieval counts: "The news dataset returned 201 results", "returned 6 total results", "The search
    // reported 19,111 total results". A count of what a search RETURNED is never a fact about a person.
    re: /\b(?:returned|reported|shows?|contains?)\s+[\d,]+\s+(?:total\s+)?results?\b/i,
    label: "narrates retrieval counts (N total results)",
    seenOn: "Travis Kalanick (old-prompt sample), Adarsh Hiremath, LeBron James — 2026-09-25 corpus",
  },
  {
    // "The results also show filings for Automatic Data Processing Inc." — search results, not a
    // record. Bare "the results" only: "the election results show" / "quarterly results show" do
    // not match, because the qualifier sits between "the" and "results".
    re: /\bthe results (?:also )?(?:show|shows|include|includes|list|lists)\b/i,
    label: "cites its own input (the results show)",
    seenOn: "Bill Ackman (before) — B-043 snapshot 2026-09-25",
  },
  {
    // Our vendors as the SUBJECT of a verb about retrieval, not a publication: "NewsAPI returned",
    // "GDELT results". The `[NewsAPI]` chip is untouched (no verb follows the bracket).
    re: /\b(?:NewsAPI|GDELT)\s+(?:validated|returned|found|results|lists?|includes?)\b/i,
    label: "names a pipeline vendor as the speaker",
    seenOn: "Charlie Ergen, Ankur Jain (after) — B-043 snapshot 2026-09-25",
  },
  {
    re: /\b(?:(?:in|from) (?:the|this) (?:news )?dataset|the news dataset)\b/i,
    label: "cites its own input (the dataset)",
    seenOn: "profile corpus 2026-08-25 (the render list's `in the provided dataset` family); Travis Kalanick old-prompt sample 2026-09-25 (`The news dataset returned…`)",
  },
];

export type SelfNarrationHit = { sentence: string; labels: string[] };

/** Every sentence in `text` carrying (a)-class self-narration, with the patterns it tripped. */
export function findSelfNarration(text: string | undefined | null): SelfNarrationHit[] {
  if (typeof text !== "string" || !text) return [];
  const hits: SelfNarrationHit[] = [];
  for (const sentence of splitSentences(text)) {
    const labels = SELF_NARRATION_PATTERNS.filter((p) => p.re.test(sentence)).map((p) => p.label);
    if (labels.length) hits.push({ sentence: sentence.trim(), labels });
  }
  return hits;
}

export const SUMMARY_PROSE_SECTIONS = ["overview", "business", "philanthropy", "political", "newsDigest"] as const;

/** Per-section (a)-class hits over one stored or candidate summary object. */
export function summarySelfNarration(summary: unknown): { section: string; hits: SelfNarrationHit[] }[] {
  if (!summary || typeof summary !== "object") return [];
  const out: { section: string; hits: SelfNarrationHit[] }[] = [];
  for (const section of SUMMARY_PROSE_SECTIONS) {
    const hits = findSelfNarration((summary as Record<string, unknown>)[section] as string | undefined);
    if (hits.length) out.push({ section, hits });
  }
  return out;
}
