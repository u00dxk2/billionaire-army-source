/**
 * Pipeline-referential language — the model talking to the reader about ITS OWN INPUTS.
 *
 * WHY THIS LIVES IN @ba/shared. The feed already had a detector for this class
 * (`purge-meta-commentary-cards.ts`, R-034 residue) and it worked, but it lived in
 * `packages/jobs` where only a job script could reach it. On 2026-08-25 the same defect
 * was measured on the PROFILE surface — 22 of 89 summarised profiles (24.7%) rendered
 * phrases like "the provided data does not include a specific company role" to readers,
 * on real named people (Julia Koch, John Menard Jr.). Two surfaces, one defect class, so
 * ONE vocabulary: the same don't-fork rule that governs `accountabilityScore()` and
 * `eventSignature()`. The purge script now imports from here rather than owning a copy.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. This product's whole promise is that no claim
 * outruns its citation. A profile that says "No validated news articles were available in
 * the provided dataset" is not citing a source — it is narrating our plumbing, which reads
 * as unfinished and quietly tells the reader the page is machine output nobody checked.
 * The fix is the prose form of a rule this codebase already applies to numbers: when we
 * have nothing to say, say NOTHING — never render our own emptiness. (Cf. "absent, never
 * zero" for `givingRatio()` and `philanthropyZeroKind()`.)
 *
 * PATTERNS ARE OBSERVED, NOT SPECULATIVE. Every entry below matched real live content, and
 * the profile entries carry the person id they were seen on. Adding a speculative pattern
 * is how this becomes a false-positive machine that eats good copy, so: add a pattern only
 * when you have the page it matched.
 *
 * THE CONTROL THAT KEEPS IT HONEST. Legitimate sourcing language — "Public records do not
 * disclose the amount", "No 990 filing reports grants for this foundation" — says something
 * TRUE ABOUT THE WORLD and must survive untouched. That is the whole distinction: our
 * inputs vs the world's record. `meta-commentary.test.ts` pins both directions.
 */

/** Abbreviations that are NOT sentence ends. */
const ABBREV_END = /\b(?:[A-Z]|Inc|Jr|Sr|St|Dr|Mr|Ms|Mrs|Mt|No|vs|etc)\.$/;

/**
 * Split into sentences WITHOUT treating "U.S." or "$3.0B" as boundaries.
 *
 * Extracted from `packages/api/src/first-sentences.ts`, which shipped truncated bios
 * ("Frank Slootman is a U.S.") on the demo surface before it learned this. Kept in one
 * place so a second consumer cannot re-learn it the same way.
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text.trim() ? [text] : [];

  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    // Not a real boundary if the previous fragment ends in an abbreviation, or if this
    // fragment continues without whitespace (decimals like "$3.0B").
    if (prev !== undefined && (ABBREV_END.test(prev.trimEnd()) || !/^\s/.test(part))) {
      merged[merged.length - 1] += part;
    } else {
      merged.push(part);
    }
  }

  // A trailing fragment with no terminal punctuation is still a sentence to a reader.
  const consumed = merged.join("").length;
  if (consumed < text.length) {
    const tail = text.slice(consumed);
    if (tail.trim()) merged.push(tail);
  }
  return merged;
}

export type CommentaryPattern = {
  re: RegExp;
  label: string;
  /** Where this was actually observed. Keeps the no-speculative-patterns rule auditable. */
  seenOn?: string;
  /**
   * Safe to ENFORCE at write time (B-056), i.e. this wording cannot plausibly occur in a real
   * news sentence about a real subject. Only PROFILE entries carry it; feed entries are
   * write-time safe by construction, having been observed on feed cards.
   *
   * WHY THE FLAG EXISTS. A render-time strip hides one sentence; a write-time drop kills the
   * whole card, and the story then returns every run until it ages out. An adversarial review
   * on 2026-09-22 measured the unflagged profile entries against realistic accountability
   * cards: "Meta fined $5 billion over the data provided to Cambridge Analytica", "The SEC said
   * the information provided to investors was misleading", "No articles were available after
   * the Post pulled the op-ed", "the donor was identified in the data as a Koch affiliate" —
   * all real-news shapes, all would have been dropped. So the write-time set is a NAMED SUBSET,
   * not the union, and it lives here rather than in a second list a consumer could fork.
   */
  writeTimeSafe?: boolean;
};

/**
 * FEED-observed curator-internal language. Moved verbatim from
 * `purge-meta-commentary-cards.ts` — do NOT edit these to fix a profile case; the purge
 * script's blast radius is a DELETE, so widening this list deletes cards.
 */
export const META_COMMENTARY_PATTERNS: CommentaryPattern[] = [
  { re: /\bin the provided context\b/i, label: "cites its working material (provided context)" },
  { re: /\bthe provided records\b/i, label: "cites its working material (provided records)" },
  { re: /\baccording to the provided\b/i, label: "cites its working material (according to the provided)" },
  { re: /\bbased on the (provided|available) (records|context|information)\b/i, label: "cites its working material" },
  { re: /\bthis (piece|profile|article) (ties|alleges|argues|notes|suggests|centers)\b/i, label: "summariser voice about the source, not the subject" },
  { re: /\bso it lands lower\b/i, label: "narrates its own ranking decision to the reader" },
  { re: /\bnot a civic-accountability story\b/i, label: "narrates its own selection judgment" },
  { re: /\brather than a substantive accountability story\b/i, label: "narrates its own selection judgment" },
  { re: /\bmore profile than accountability story\b/i, label: "narrates its own selection judgment" },
  { re: /\bnot a lot of governance meat\b/i, label: "editorialises about the article's news value" },
  // B-056 (2026-09-22): first observed on a FEED card — until then it lived only in the profile
  // list, so the purge scan read 0 while the card was live.
  // NARROWED the same day, after an adversarial review measured the wider form against realistic
  // cards: `/\bthe provided data\b/` also matches "Meta said the provided data was anonymized"
  // and "Palantir said the provided data-sharing agreement was lawful" — ordinary privacy-story
  // sentences, which this list would then license a DELETE of. The observed leak reads "records
  // IN the provided data list…", so the collocation is what ships, mirroring the older
  // `in the provided context` entry.
  { re: /\bin the provided data\b/i, label: "cites its working material (in the provided data)", seenOn: "1a1b49a6 J.B. Pritzker (feed, 2026-09-22)" },
];

/**
 * PROFILE-observed pipeline-referential language, measured on the live API 2026-08-25.
 * Separate array from the feed list ON PURPOSE: these are used for RENDER-TIME suppression
 * (cost of a false positive = one hidden sentence, recoverable) and must never be fed to
 * the purge script (cost of a false positive = a deleted card). Same cost-asymmetry
 * reasoning that keeps the dedup thresholds unharmonised.
 */
export const PROFILE_COMMENTARY_PATTERNS: CommentaryPattern[] = [
  { re: /\bthe provided (data|dataset|information|text|titles?)\b/i, label: "cites its own input (the provided data)", seenOn: "03987986 Julia Koch, 9a8a65f8 John Menard Jr." },
  { re: /\bthe (data|dataset|information) provided\b/i, label: "cites its own input (the data provided)", seenOn: "e93a9fa8 John Fish" },
  { re: /\bin the provided dataset\b/i, label: "cites its own input (provided dataset)", seenOn: "8edcb4fb John Stanton, f1fd86d0 Charles Simonyi", writeTimeSafe: true },
  { re: /\bwere included in the dataset\b/i, label: "narrates what its input lacked", seenOn: "9a8a65f8 John Menard Jr." },
  { re: /\bno (validated )?(news )?articles? (were |was )?(available|validated)\b/i, label: "narrates pipeline validation state", seenOn: "f1fd86d0 Charles Simonyi, 333004e6 Andy Fang" },
  { re: /\bidentified in the data as\b/i, label: "cites its own input (identified in the data)", seenOn: "9a8a65f8 John Menard Jr." },
  { re: /\bto report from the provided\b/i, label: "narrates having nothing to report", seenOn: "333004e6 Andy Fang", writeTimeSafe: true },
  { re: /\bbased on the provided titles\b/i, label: "cites its own input (provided titles)", seenOn: "098e821a Elizabeth Johnson", writeTimeSafe: true },
];

/**
 * Which FEED patterns does this card's reader-visible text hit?
 *
 * Deliberately unchanged in scope: feed patterns ONLY. The purge script deletes on this
 * answer, so broadening it here would silently widen a destructive script's blast radius.
 */
export function matchMetaCommentary(headline: string, summary: string): string[] {
  const blob = `${headline}\n${summary}`;
  return [...new Set(META_COMMENTARY_PATTERNS.filter((p) => p.re.test(blob)).map((p) => p.label))];
}

const ALL_RENDER_PATTERNS = [...META_COMMENTARY_PATTERNS, ...PROFILE_COMMENTARY_PATTERNS];

/**
 * Drop sentences that talk about our own pipeline, keeping everything else verbatim.
 *
 * Returns `undefined` when nothing survives — the caller is expected to omit the section
 * entirely rather than render an empty one, which is the point: a section that had only
 * plumbing in it had nothing to tell the reader.
 *
 * Sentence-level, never word-level: excising a phrase mid-sentence produces a mangled
 * claim, and a mangled claim on this product is worse than a missing one.
 */
export function stripPipelineCommentary(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const kept = splitSentences(text).filter((s) => !ALL_RENDER_PATTERNS.some((p) => p.re.test(s)));
  const out = kept.join("").replace(/\s+/g, " ").trim();
  return out.length ? out : undefined;
}

/** Did this text carry any pipeline-referential sentence? (for gates//reporting, not render) */
export function hasPipelineCommentary(text: string | undefined | null): boolean {
  if (typeof text !== "string" || !text) return false;
  return splitSentences(text).some((s) => ALL_RENDER_PATTERNS.some((p) => p.re.test(s)));
}

/**
 * The WRITE-TIME set (B-056): every feed pattern, plus only those profile patterns flagged
 * `writeTimeSafe`. Built from the same objects the other two lists hold — one home, no fork.
 */
export const WRITE_TIME_LEAK_PATTERNS: CommentaryPattern[] = [
  ...META_COMMENTARY_PATTERNS,
  ...PROFILE_COMMENTARY_PATTERNS.filter((p) => p.writeTimeSafe),
];

/**
 * Would publishing this text show a reader the curator quoting its own inputs?
 *
 * Narrower than `hasPipelineCommentary` ON PURPOSE — see `writeTimeSafe`. Non-strings read
 * false rather than throwing: Pass A returns `json_object`, not a strict schema, so `summary`
 * is only conventionally a string, and a card whose summary came back as an object used to die
 * later in the run. A guard that crashes the run publishes nothing at all, which is worse than
 * the leak it was added to stop.
 */
export function hasWriteTimeLeak(text: string | undefined | null): boolean {
  if (typeof text !== "string" || !text) return false;
  return splitSentences(text).some((s) => WRITE_TIME_LEAK_PATTERNS.some((p) => p.re.test(s)));
}
