import { foundationTotals, isFecRecordImpossible, normalizePartyBreakdown } from "@ba/shared";

/**
 * B-030's last mile: collapse a philanthropy fact's doubled foundation totals BEFORE the raw
 * JSON is handed to the summary model as SOURCE DATA.
 *
 * The stored `totalFoundationAssets` / `totalGrantsPaid` are bare sums that double-count a
 * foundation holding its own endowment trust — $152,483,424,711 against a true $76,951,451,400
 * on the Gates profiles. `foundationTotals()` (@ba/shared) is the single collapsed source, and
 * the API and PBS both read through it. The summary generator never did: `buildUserPrompt`
 * serialises `factValue` verbatim, so the model was handed the un-collapsed sum and quoted it
 * faithfully.
 *
 * **This is why the summary faithfulness verifier could never catch it.** That verifier audits
 * the written prose against the SAME raw blob, so a number copied out of the blob is by
 * construction "supported by the source data" — it returns a correct verdict on the wrong
 * question. A gate cannot adjudicate its own blind spot, so the fix has to land on the INPUT,
 * not on another judge.
 *
 * Corollary worth keeping: regenerating an affected summary WITHOUT this collapse reproduces
 * the same number. The regen was never the fix.
 *
 * Returns the value untouched when there is no `foundations[]` array to collapse, which is also
 * `foundationTotals()`'s own fallback condition — older facts carrying only the stored sums are
 * left exactly as they are rather than being silently zeroed.
 */
export function collapseFoundationTotalsForPrompt(factValue: unknown): unknown {
  if (!factValue || typeof factValue !== "object" || Array.isArray(factValue)) return factValue;

  const fv = factValue as Record<string, unknown>;
  if (!Array.isArray(fv.foundations) || fv.foundations.length === 0) return factValue;

  const { totalAssets, totalGrants } = foundationTotals(fv);
  return { ...fv, totalFoundationAssets: totalAssets, totalGrantsPaid: totalGrants };
}

/**
 * Sibling of the above, same principle, different fact: label FEC money as MONEY before the
 * raw JSON is handed to the summary model.
 *
 * `fetchers/fec.ts` accumulates `partyBreakdown[party] += contribution_receipt_amount`, so every
 * value under `partyBreakdown` is US DOLLARS — but nothing in the blob says so, and the object
 * sits directly beside `count`, which really is a count. Measured on live prod 2026-08-28,
 * MacKenzie Scott's profile read: *"the party breakdown lists 100 Democratic contributions,
 * 52.43 Republican contributions, and 559.16 to PAC/Other"* — three dollar figures rendered as
 * contribution counts, on a named real person's political record. `52.43 contributions` cannot
 * exist, and `$100 + $52.43 + $559.16 = $711.59`, exactly the total the same sentence states.
 *
 * The model was not hallucinating; it was reading unlabelled integers next to a field called
 * `count`. So the fix lands on the INPUT, for the same reason B-030's does: the faithfulness
 * verifier audits the prose against this same blob, so a number copied out of it is "supported
 * by the source data" by construction.
 *
 * Money is rendered EXACT and unabbreviated — `$93,720.25`, not `$94K`. This is deliberately
 * NOT `formatCurrency`, and the distinction is not a fork: that function is the one ladder for
 * USER-FACING display, where abbreviation is the point. A prompt is source data, where it is a
 * hazard. Measured 2026-08-28: rendering through the display ladder put `$94K`, `$6K` and an
 * exact `$10` in one list, and the model normalised the odd one out, writing "$10,000 unknown"
 * for a $10 figure — trading a count error for a 1000x magnitude error on a political record.
 * Exact strings also strip the float tail (`711.5900000000003`) at the prompt boundary.
 *
 * `count` is deliberately left as a bare number: it is the one field here that IS a count —
 * of the records we FETCHED. Whether that is the person's record is a different question, and
 * `labelFecTruncationForPrompt` below is the answer to it. Do not read this paragraph as
 * clearance for `count`; it was written about UNITS and is silent about COMPLETENESS.
 */
/** Exact USD for a MODEL to read: grouped, never abbreviated, cents only when non-zero. */
function exactUsd(amount: number): string {
  const cents = Math.round(amount * 100) % 100;
  return "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: cents === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function labelFecMoneyForPrompt(factValue: unknown): unknown {
  if (!factValue || typeof factValue !== "object" || Array.isArray(factValue)) return factValue;
  const fv = factValue as Record<string, unknown>;

  const hasMoney =
    typeof fv.totalAmount === "number" ||
    (fv.partyBreakdown !== null && typeof fv.partyBreakdown === "object") ||
    Array.isArray(fv.topRecipients);
  if (!hasMoney) return factValue;

  const out: Record<string, unknown> = { ...fv };

  if (typeof fv.totalAmount === "number") {
    out.totalAmountUsd = exactUsd(fv.totalAmount);
    delete out.totalAmount;
  }
  if (fv.partyBreakdown !== null && typeof fv.partyBreakdown === "object" && !Array.isArray(fv.partyBreakdown)) {
    // B-038's WRITE-PATH half. The stored keys are raw FEC codes — sixteen of them for about six
    // parties (`DEM` and `Dem`; `UNK`, `UN` and `Unknown`; plus `NNE`, `DFL`, `DCG` unexpanded).
    // Handing those to the model is what produced paragraphs that state some buckets and drop the
    // rest: it renders the fields it can name and skips the jargon, so the parts fall short of the
    // total stated one sentence earlier (measured: 50 of 792 judged profiles). Folding through
    // `normalizePartyBreakdown` — the SAME merge policy the profile's bars read, never a second
    // looser copy — gives the model named buckets, and the sum is preserved exactly.
    //
    // Keyed by LABEL, summed on collision: two codes can only share a label by being the same
    // party, and summing rather than overwriting means no arithmetic can go missing here even if
    // the label table later grows an overlap. `Object.fromEntries` would have dropped one silently.
    const byLabel = new Map<string, number>();
    for (const bucket of normalizePartyBreakdown(fv.partyBreakdown as Record<string, number>)) {
      byLabel.set(bucket.label, (byLabel.get(bucket.label) ?? 0) + bucket.amount);
    }
    out.partyBreakdownUsd = Object.fromEntries(
      [...byLabel.entries()].map(([label, amount]) => [label, exactUsd(amount)]),
    );
    delete out.partyBreakdown;
  }
  if (Array.isArray(fv.topRecipients)) {
    out.topRecipients = fv.topRecipients.map((r) => {
      if (!r || typeof r !== "object") return r;
      const rec = r as Record<string, unknown>;
      if (typeof rec.amount !== "number") return r;
      const { amount, ...rest } = rec;
      return { ...rest, amountUsd: exactUsd(amount) };
    });
  }
  return out;
}

/**
 * The FEC page cap. `fetchers/fec.ts` requests `per_page=100` sorted `-contribution_receipt_date`
 * and never paginates, so a person with more than 100 federal contributions comes back as their
 * 100 MOST RECENT ones and nothing in the stored fact says so.
 */
export const FEC_PAGE_CAP = 100;

/**
 * Third sibling in this file, and the one the other two set up. Same principle, and the same
 * reason it has to land on the INPUT: `count` is a truthful count of a TRUNCATED SET, and every
 * other figure in the fact — `totalAmount`, `dateRange`, `partyBreakdown`, `topRecipients` —
 * is computed over that same truncated set.
 *
 * Measured on live prod 2026-08-29: **481 published profiles state "100 contributions"** as a
 * fact about a named person, out of 548 whose stored FEC record is at the cap (877 approved
 * persons carry an FEC fact; 329 are genuinely under it, which is the positive control that the
 * count field is being read at all). A reader met sentences like *"FEC records show 100
 * contributions totaling $2,388.28 from 2025-09-28 to 2025-12-31"* — a three-month window and a
 * four-figure total for someone whose real record is larger and longer on both counts. On a
 * platform whose whole thesis is that no claim outruns its citation, that is the pipeline's own
 * page size published as a fact about a person.
 *
 * Why the earlier fixes could not catch it, in one line each: the faithfulness verifier audits
 * the prose against this same blob, so `100` is "supported by the source data" by construction
 * (B-030's lesson, third instance); and `labelFecMoneyForPrompt` was right that `count` is the
 * one field here that is not money, which is a correct statement about UNITS that reads as
 * clearance on COMPLETENESS. **A rationale can be correct, unchanged, and false about the
 * question you are now asking.**
 *
 * The shape deliberately makes the complete-record reading unwritable rather than merely
 * discouraged: `count` and `dateRange` are REMOVED, not annotated, so there is no bare number
 * left for the model to copy. Sub-cap facts are returned untouched — their `count` really is
 * the person's count, and hedging those would trade a false claim for a false doubt on 329
 * profiles.
 *
 * Note this needs NO re-fetch to take effect: the stored fact already carries the signal
 * (`count >= 100`). Capturing the FEC API's own `pagination.count` in `fec.ts` is the durable
 * upgrade and turns "at least 100" into the real number, but it only lands on the next run.
 */
export function labelFecTruncationForPrompt(factValue: unknown): unknown {
  if (!factValue || typeof factValue !== "object" || Array.isArray(factValue)) return factValue;
  const fv = factValue as Record<string, unknown>;
  if (typeof fv.count !== "number" || fv.count < FEC_PAGE_CAP) return factValue;

  const { count, dateRange, ...rest } = fv;
  const reported = typeof fv.reportedTotalContributions === "number" ? fv.reportedTotalContributions : null;

  return {
    ...rest,
    recordIsTruncated: true,
    contributionsInThisSample: count,
    ...(reported !== null ? { reportedTotalContributions: reported } : {}),
    ...(typeof dateRange === "string" && dateRange ? { dateRangeOfThisSampleOnly: dateRange } : {}),
    truncationNote:
      `TRUNCATED SAMPLE. Our FEC pull returns at most ${FEC_PAGE_CAP} contributions per person, most recent first. ` +
      `This person has AT LEAST ${count} federal contributions` +
      (reported !== null ? ` (the FEC reports ${reported} in total)` : ` and the true total is unknown and higher`) +
      `. Every figure in this object — the total, the date range, the party breakdown and the top recipients — ` +
      `covers ONLY these ${count} most recent records, not the person's full history. ` +
      `Do NOT state the count, the total or the date range as if it were complete: write "at least", and say the ` +
      `figures cover the most recent ${count} contributions on file.`,
  };
}

/**
 * B-037's write-path half: never hand the model a record we would REFUSE TO RENDER.
 *
 * `isFecRecordImpossible()` (@ba/shared) withholds a person's FEC section when the record's
 * earliest contribution predates their 18th year, because a name-only match that reaches back
 * that far belongs to a different human. That guard lived only at RENDER. So on 2026-09-02 the
 * profile said "we can't prove they're this person's" and the stored summary prose below it said
 * "48 contributions totaling $128,108 from July 23, 1979" — the page publishing the exact claim
 * its own notice withheld, on 12 of 12 withheld people, and a THIRD surface (/compare) besides.
 *
 * Render-side withholds are a filter over bad data: a regeneration, an export, `/api/persons/:id`,
 * `firstSentences()` on /today, or a surface nobody has built yet all republish it. So the figures
 * come out at the INPUT — the same boundary the truncation and units fixes chose, and for the same
 * reason: the faithfulness verifier audits the prose against THIS blob, so a record left in here
 * comes back "faithful" while being a false claim about a named living person's politics.
 *
 * Drops the fact ENTIRELY rather than substituting a caveat: the render already owns the message
 * (and links the reader to the FEC's own records), and a second notice written by the model would
 * be a second thing to keep true. Nothing to say, so say nothing — the same rule as `givingRatio()`
 * and the pipeline-commentary strip.
 *
 * Returns null to mean DROP THIS FACT. Fail-open in the guard's own direction: an unparsable range
 * or a junk birth year returns the fact unchanged, because a false positive here erases a real
 * person's real record.
 */
export function withholdImpossibleFecForPrompt(
  factKey: string,
  factValue: unknown,
  birthYear: number | null | undefined,
): unknown | null {
  if (factKey !== "fec_contributions") return factValue;
  if (!factValue || typeof factValue !== "object" || Array.isArray(factValue)) return factValue;
  const dateRange = (factValue as Record<string, unknown>).dateRange;
  return isFecRecordImpossible(typeof dateRange === "string" ? dateRange : null, birthYear)
    ? null
    : factValue;
}

/** The news fact keys the two fetchers write (newsapi.ts `news_headlines`, gdelt.ts `gdelt_articles`). */
export const NEWS_FACT_KEYS = new Set(["news_headlines", "gdelt_articles"]);

/**
 * B-060: hand the summary model the ARTICLES, never our pipeline's bookkeeping about them.
 *
 * Both news fetchers store `totalResults` (the raw keyword-match count), `validatedResults` (how many
 * passed OUR relevance filter), `averageSentiment`, `topSources` and a derived `dateRange` beside the
 * articles. Handed to the model as SOURCE DATA, those fields came back as prose about our plumbing —
 * measured 2026-09-25 over all 948 stored summaries: 58 sentences "narrate pipeline validation state"
 * ("The supplied NewsAPI results include two validated articles published from July 22 to July 27",
 * "GDELT returned 6 total results, but 0 validated results", "an average sentiment score of -0.0118").
 * None is a fact about the person; every one reads as machine output nobody checked. So they come out
 * at the INPUT, the same boundary the FEC and foundation fixes chose. `dateRange` goes too: it is
 * derived, 103 stored rows carry a BACKWARD window (B-043), and the articles carry their own dates.
 * Per-article `sentiment` and `image` go for the same reason; `title`, `body`, `source`, `date` and
 * `url` stay — `source` is the outlet a journalist attributes to ("The Economic Times reported…").
 *
 * An article list that is EMPTY drops the whole fact (returns null): the system prompt says a missing
 * section is omitted, and a news fact holding zero articles is exactly what produced "No validated news
 * articles were provided in the dataset" on dozens of profiles. Nothing to say, so say nothing.
 * Non-news keys and non-object values pass through untouched.
 */
export function newsFactForPrompt(factKey: string, factValue: unknown): unknown | null {
  if (!NEWS_FACT_KEYS.has(factKey)) return factValue;
  if (!factValue || typeof factValue !== "object" || Array.isArray(factValue)) return factValue;
  const articles = (factValue as Record<string, unknown>).articles;
  if (!Array.isArray(articles) || articles.length === 0) return null;
  return {
    articles: articles.map((a) => {
      if (!a || typeof a !== "object") return a;
      const { sentiment: _s, image: _i, ...kept } = a as Record<string, unknown>;
      return kept;
    }),
  };
}
