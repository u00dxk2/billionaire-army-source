/**
 * B-028 path (A) — the profile News-Coverage selection, as a pure decision.
 *
 * WHY THIS IS ITS OWN MODULE. The gate it replaces was a single line in the middle
 * of a fetcher that writes prod and spends API credits (`title.includes(lastName)`,
 * newsapi.ts). That made it untestable without a live run, which is how it survived
 * long enough to fill 100 profiles with megayacht listicles. A gate that cannot be
 * tested cannot be trusted — same reason `isAdminUserId`, `isOnCooldown`, `sendTier`
 * and `isPlausiblyOwnFoundation` all live outside their call sites.
 *
 * WHAT WAS ACTUALLY WRONG, measured 2026-08-11 against live NewsAPI over the eight
 * profiles this defect was catalogued on: only 3.3% of stored articles were both
 * correctly attributed AND on-axis. Every artifact — "Larry Ellison Fast Facts", the
 * Brin megayacht, the superyacht listicle, the Buffett stock picks — passes a surname
 * check. The section was never badly filtered; it was filtered on the wrong axis.
 *
 * THE BINDING CONSTRAINT WAS SUPPLY, NOT THE FILTER, and that was the surprise. At the
 * old 20-article request an axis floor empties 4-5 of 8 profiles, which is why a filter
 * alone looks impossible. At 100 it empties NOBODY at any floor from 1 to 5. So the
 * fetcher asks for more candidates and this module chooses among them.
 */
import { accountabilityScore, eventSignature, jaccardScore } from "@ba/shared";
import { CROSS_RUN_EVENT_THRESHOLD } from "./feed-event-dedup";

/** Minimum accountabilityScore for a profile article. */
export const PROFILE_RELEVANCE_FLOOR = 3;

/** How many survive onto the profile. Unchanged from the previous behaviour. */
export const PROFILE_ARTICLE_LIMIT = 10;

export type SelectableArticle = { title: string; body: string | null };

/**
 * Does the TITLE name a different person who shares this surname?
 *
 * The residual half of the Kimbal Musk defect. Requiring the first name in title-or-body
 * dropped "Elon Musk's foundation paid for…" from Kimbal's profile, but kept "Errol Musk
 * admits the family foundation funded Tommy Robinson's trip" — because a family story
 * mentions Kimbal somewhere in the body. Being MENTIONED is not being the SUBJECT, and
 * attaching a funding-an-extremist story to the wrong brother is a false claim of
 * wrongdoing — strictly worse than the false-claim-of-generosity case B-020's
 * drop-on-doubt rule was written for.
 *
 * The rule: find every capitalised word immediately preceding the surname in the title.
 * If ANY of them is not part of this person's own name, the title is about someone else.
 * Tokens from the person's own full name are allowed through, which is what keeps
 * "Melinda French Gates" on Melinda's profile ("French" is hers) while dropping it from
 * Bill's — a distinction a bare first-name check cannot make.
 *
 * Deliberately reads the TITLE only. Bodies name relatives constantly ("Errol Musk,
 * father of Elon"), so extending this to the body would drop nearly everything.
 */
export function titleNamesADifferentRelative(
  title: string,
  lastName: string,
  ownNameTokens: Set<string>
): boolean {
  // CASE-SENSITIVE on purpose — the preceding token must be Capitalised to be a name.
  // An earlier version carried the `i` flag, which made `[A-Z]` match lowercase too, so
  // "…nonprofit names Gates its largest donor" captured "names" as a relative and
  // dropped a real story. Caught by the cap test, which is why that test earns its keep.
  const esc = lastName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const surname = esc.charAt(0).toUpperCase() + esc.slice(1);
  const re = new RegExp(`\\b([A-Z][a-zA-Z'’-]+)\\s+${surname}\\b`, "g");
  for (const m of title.matchAll(re)) {
    if (!ownNameTokens.has(m[1].toLowerCase())) return true;
  }
  return false;
}

export type SelectionResult<T> = {
  kept: T[];
  /** Diagnostics — every filter reports what it removed (codebase invariant: no silent shrinking). */
  returned: number;
  namedOut: number;
  belowFloor: number;
  duplicates: number;
};

/**
 * @param articles  everything the API returned for this person
 * @param lastName  lower-cased surname, as extracted by the caller
 */
export function selectProfileArticles<T extends SelectableArticle>(
  articles: T[],
  lastName: string,
  /** The person's FULL name — every token of it is treated as "theirs". */
  personName: string,
  floor: number = PROFILE_RELEVANCE_FLOOR,
  limit: number = PROFILE_ARTICLE_LIMIT
): SelectionResult<T> {
  const returned = articles.length;
  const tokens = personName.trim().split(/\s+/).filter(Boolean);
  const firstName = tokens[0] ?? "";

  // (1) Attribution. The surname must appear in the TITLE — unchanged — AND the FIRST
  // name must appear in the title or the body.
  //
  // THE FIRST-NAME HALF EXISTS BECAUSE THE PREVIEW CAUGHT A FALSE CLAIM ABOUT A REAL
  // PERSON. On tier 1, Kimbal Musk's profile came back holding "Elon Musk's foundation
  // paid for UK's Tommy Robinson's trip to Russia" and "Elon Musk leads African-born
  // billionaires" — a surname gate cannot tell Kimbal from Elon or Errol. That is the
  // B-020 class (a wrong attribution is a false claim, and this row's rule is that it
  // DROPS on doubt), and it would have shipped to prod.
  //
  // Deliberately checked against title+BODY, not title alone: "Gates Foundation Gives
  // University Of Washington A Record $540 Million" never says "Bill" in the headline
  // but its body does, and "Soros-funded group offers to pay student protesters" is
  // carried by a body naming George Soros. A title-only first-name rule would have
  // dropped both — which is exactly how 8/09's full-name-in-title candidate emptied
  // 15 of 37 profiles and was rejected.
  //
  // KNOWN CEILING, unchanged: this separates relatives with DIFFERENT first names. It
  // cannot separate a father and son who share one, and it cannot rescue a story that
  // names neither. Both need trustee-level evidence, same as B-020's ceiling.
  const first = firstName.toLowerCase();
  // EVERY token of the person's own name counts as theirs — not just first and last.
  // "Melinda French Gates" must keep her own stories, and a first+last set would flag
  // "French Gates" as a different relative and drop them.
  const ownTokens = new Set(tokens.map((t) => t.toLowerCase()));
  const named = articles.filter(
    (a) =>
      a.title.toLowerCase().includes(lastName) &&
      `${a.title} ${a.body ?? ""}`.toLowerCase().includes(first)
  );
  // titleNamesADifferentRelative() is BUILT, TESTED, AND DELIBERATELY NOT WIRED IN.
  // Measured on tier 1, 2026-08-11, with and without it:
  //            kept   emptied   Kimbal's wrong story   Edythe Broad's real $1.1M grant
  //   without    29     7/15            1 (bad)                  kept
  //   with       24     9/15            0 (good)                 DROPPED
  // It fixes one false attribution and costs at least one true receipt, because any
  // capitalised word before the surname reads as a first name — "College of the Canyons
  // Receives $1.1 MILLION BROAD Foundation Grant" captures "Million". Net negative, so
  // it stays off. This is the SEVENTH attribution rule on this row to look obviously
  // right and measure wrong (B-021's five, 8/09's org-string rule, and now this).
  // Kept in the file rather than deleted because the NEXT attempt should start from the
  // measurement, not from the idea.
  const namedOut = returned - named.length;

  // (2) The axis. Scored on title AND body — collection time has the first 500 chars,
  // which the stored facts never did, and that extra signal is part of why the floor
  // works here when it was flat over the stored corpus.
  const scored = named
    .map((article) => ({ article, score: accountabilityScore(article.title, article.body ?? undefined) }))
    .filter((s) => s.score >= floor);
  const belowFloor = named.length - scored.length;

  // (3) Event dedup. The probe found the same Gates $540M story twice and the same
  // Musk story three times — the shape that put a 2007 Ballmer quote on a profile
  // twice. Highest score wins, so the better-written version of a story survives.
  //
  // The INGEST threshold is reused rather than forked, and MEASURED before trusting
  // it rather than reused on faith — within one person's articles every title shares
  // the surname and topic vocabulary, so baseline similarity is higher than in the
  // cross-run case this constant was calibrated on. Scored 2026-08-11 on real pairs:
  //   real duplicates : 1.000 (identical) · 1.000 (+source suffix) · 0.500 (reworded)
  //                     · 0.214 (Bloomberg, reworded harder)
  //   distinct stories: 0.273 (two Gates gifts) · 0.083 · 0.077
  // 0.40 sits in the gap: it collapses the first three and leaves every distinct pair
  // alone. KNOWN MISS, pinned as a test: the 0.214 Bloomberg duplicate is UNREACHABLE,
  // because catching it would mean going below the 0.273 distinct pair. The bands
  // INTERLEAVE — the same shape B-022 measured on the feed, where no threshold exists
  // and only a judge can separate them. A miss here costs one slot of ten; it is not
  // worth an LLM call on a profile section.
  scored.sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const keptSignatures: Set<string>[] = [];
  let duplicates = 0;
  for (const { article } of scored) {
    const sig = eventSignature(article.title);
    if (keptSignatures.some((s) => jaccardScore(sig, s) >= CROSS_RUN_EVENT_THRESHOLD)) {
      duplicates++;
      continue;
    }
    keptSignatures.push(sig);
    kept.push(article);
    if (kept.length >= limit) break;
  }

  // Note the ordering that falls out of (3): kept is SCORE-ordered, not date-ordered.
  // The previous code took the ten most RECENT survivors. For a section whose job is
  // surviving a credibility check, the ten best receipts beat the ten newest — it is
  // the difference between a profile opening on a $540M foundation grant or on
  // whatever happened to publish yesterday.
  return { kept, returned, namedOut, belowFloor, duplicates };
}
