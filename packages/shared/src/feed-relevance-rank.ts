/**
 * Accountability relevance pre-rank for the feed curator (R-010).
 *
 * The curator pulls ~1,300 candidate articles from GDELT/NewsAPI each run but can
 * only afford to send ~20 to the GPT selector. Sorting that pool by RECENCY ALONE
 * (the prior behavior) surfaced mostly news-of-the-day — sports, geopolitics,
 * product launches, celebrity — and starved the gate of the
 * money / giving / political-spending / wealth-power stories the platform exists to
 * surface. So few on-axis candidates reached GPT that net feed supply was ~2/day,
 * and the two-pass gate (correctly) rejected most of what it did see (R-009).
 *
 * This scores each candidate by accountability-keyword signal so the densest
 * on-axis articles reach the selector FIRST. It does NOT decide what publishes —
 * the two-pass curator (Pass A select+rewrite, Pass B refute-verify) remains the
 * quality floor. It only changes WHICH candidates the gate gets to see, lifting the
 * supply of genuine receipts without adding any new data source.
 *
 * Matching uses word-boundary prefixes (`\bdonat` → donate/donation/donor) so
 * stems work but substring collisions don't (`\bgrant` does NOT match "miGRANT").
 *
 * Deterministic + dependency-free so it can be unit-tested without the API.
 */

/**
 * The candidate-layer accountability KINDS.
 *
 * These are NOT Pass A's five published categories (politics / philanthropy /
 * business / sec_filing / controversy) and must never be compared to them as if
 * they were one taxonomy. Pass A's category is assigned by the MODEL, after the
 * rewrite; these are derived lexically from the raw article, before any LLM call.
 * Different instruments, different populations — a candidate-layer count and a
 * published-set count answer different questions and must not be subtracted from
 * each other. (This lane's recurring defect is exactly that: the label and the
 * predicate meaning different things.)
 *
 * Rough correspondence, for reading the two side by side and nothing more:
 *   giving    ~ philanthropy
 *   political ~ politics
 *   wealth    ~ business / rich-list
 *   power     ~ business / controversy (acquisitions, antitrust, tax, influence)
 */
export type CandidateKind = "giving" | "political" | "wealth" | "power";

interface SignalGroup {
  weight: number;
  /** Which candidate-layer kind a hit in this group indicates. */
  kind: CandidateKind;
  terms: string[];
}

// Positive accountability signals. "billionaire" is deliberately absent — every
// article in this corpus is about a billionaire, so it carries no discriminating
// power. Terms are word-boundary PREFIXES (so "acquir" covers acquire/acquired/
// acquisition).
const SIGNAL_GROUPS: SignalGroup[] = [
  // Giving / philanthropy — the strongest on-axis signal (a receipt).
  {
    weight: 3,
    kind: "giving",
    terms: [
      "donat", "philanthrop", "giving pledge", "pledge", "charit", "foundation",
      "endow", "nonprofit", "grant", "scholarship", "relief fund", "gives away",
      "give away", "gave away", "donor-advised", "gift of", "charitable",
    ],
  },
  // Political spending — money as political power.
  {
    weight: 3,
    kind: "political",
    terms: [
      "super pac", "political action committee", "megadonor", "campaign donation",
      "campaign contribution", "campaign finance", "lobby", "dark money", "bankroll",
      "war chest", "political spending", "political giving", "political donation",
    ],
  },
  // Wealth concentration — net worth, fortune, ranking moves.
  {
    weight: 2,
    kind: "wealth",
    terms: [
      "net worth", "fortune", "wealth", "trillionaire", "richest", "wealthiest",
      "shares worth", "stake worth", "fortune grew", "fortune fell",
    ],
  },
  // Wealth-derived power / influence / control / tax.
  {
    weight: 2,
    kind: "power",
    terms: [
      "acquir", "buyout", "takeover", "monopol", "antitrust", "controlling stake",
      "empire", "lobbied", "tax break", "tax avoid", "offshore", "wealth gap",
      "inequality", "stake in", "regulat", "funded", "funding", "bankrolled",
    ],
  },
];

// Clear off-axis noise — penalized so it sinks below genuine on-axis candidates
// even when it incidentally name-drops a billionaire.
const NOISE_TERMS = [
  // sports
  "nfl", "nba", "mlb", "playoff", "touchdown", "quarterback", "coach", "championship",
  "draft pick", "roster", "season opener",
  // celebrity / fashion / lifestyle
  "red carpet", "dress", "outfit", "wore", "fashion", "gown", "premiere", "dating",
  "wedding", "vacation",
  // ceremony / speech
  "commencement", "graduation", "walkout", "valedict",
  // product / gadget
  "hands-on", "specs", "unboxing", "gadget",

  // R-048 branch (A), owner-approved 2026-08-08. The four categories the Pass A
  // prompt already calls off-axis but the pre-rank kept admitting. Chosen by
  // PREVIEWING against live candidates, not by reasoning about wording: iteration
  // 1 of this list left the single clearest stock-pick in the set sitting at slot
  // 1 of the shortlist.
  // stock picks / analyst chatter
  "forward p e", "price target", "is it still a buy", "stock is a buy", "outperform",
  "buy the dip", "best buy of the bunch", "reduces stake in", "portfolio",
  "the stock has lagged", "bull market", "potential bargain", "nasdaq", "nyse",
  // earnings
  "earnings call", "quarterly results", "beats estimates", "revenue jumps",
  "earnings highlights", "q1 2026", "q2 2026", "q3 2026", "q4 2026",
  // rich-list churn — note these are PHRASES. Bare "net worth" is deliberately NOT
  // here: it is the product's own vocabulary and appears in genuine giving stories.
  "net worth falls", "net worth drops", "net worth rises", "richest again",
  "third richest", "trillionaire status", "billionaire index",
  // entertainment
  "box office", "album", "world tour", "film that", "rare photo",
];

const SIGNAL_REGEX: { weight: number; re: RegExp }[] = SIGNAL_GROUPS.flatMap((g) =>
  g.terms.map((t) => ({ weight: g.weight, re: new RegExp("\\b" + escapeRegex(t), "i") }))
);

/**
 * The same regexes, kept grouped so a hit can be attributed to a KIND.
 *
 * Built from SIGNAL_GROUPS by the identical construction as SIGNAL_REGEX above —
 * one vocabulary, two views of it. Do NOT introduce a separate term list for
 * kinds: a second copy of these words would be a fork of the thing it classifies,
 * and this repo has already paid for that lesson more than once.
 */
const SIGNAL_REGEX_BY_KIND: { kind: CandidateKind; weight: number; res: RegExp[] }[] =
  SIGNAL_GROUPS.map((g) => ({
    kind: g.kind,
    weight: g.weight,
    res: g.terms.map((t) => new RegExp("\\b" + escapeRegex(t), "i")),
  }));
const NOISE_REGEX: RegExp[] = NOISE_TERMS.map((t) => new RegExp("\\b" + escapeRegex(normalizeForNoise(t)), "i"));
/** Ticker cashtags ($SYK, $WYNN) — a punctuation-safe marker for a markets story. */
const TICKER_REGEX = /\$[a-z]{2,5}\b/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * GDELT tokenizes punctuation with SPACES around it, so a real headline reads
 * "Forward P / E of 17" and "Q2 2026 Earnings Call Transcript" arrives as
 * "( KMI ) Q2 2026". Any noise term containing punctuation therefore never
 * matched — measured live 2026-08-08, the clearest stock-pick in the candidate
 * set sat at slot 1 of the shortlist while a rule written for it was in force.
 *
 * Applied to the NOISE pass only, deliberately. The SIGNAL pass is byte-identical
 * to what it was, because accountabilityScore() also ranks PUBLISHED cards on the
 * front door via feed-punch, and re-tokenizing the positive terms would reshuffle
 * the live feed as a side effect of a candidate-selection fix.
 */
function normalizeForNoise(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9$]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Higher = more accountability-relevant. Title hits weigh 2x body hits. Off-axis
 * noise subtracts (title -4 / body -2). Can go negative; that's fine — it just
 * sorts such candidates below genuinely on-axis ones.
 */
export function accountabilityScore(title: string, body?: string): number {
  const t = title || "";
  const b = body || "";
  let score = 0;
  for (const { weight, re } of SIGNAL_REGEX) {
    if (re.test(t)) score += weight * 2;
    else if (b && re.test(b)) score += weight;
  }
  const nt = normalizeForNoise(t);
  const nb = normalizeForNoise(b);
  for (const re of [...NOISE_REGEX, TICKER_REGEX]) {
    if (re.test(nt)) score -= 4;
    else if (nb && re.test(nb)) score -= 2;
  }
  return score;
}

/**
 * Which accountability KIND does this raw candidate read as, before any LLM sees it?
 *
 * Why this exists (R-048, 2026-09-07). Across the five curator runs 09-03..09-07 the
 * feed published 7 cards and all 7 were `philanthropy`, while every gate we own read
 * green — because every gate asks whether a card is ON-AXIS and none asks what KIND
 * it is. A feed of seven giving announcements is perfectly on-axis and cannot produce
 * the fury→clarity→receipt moment the product exists for. The display-side guard that
 * gates money on tension cannot help either: it can only rank what selection hands it,
 * and it was handed a monoculture.
 *
 * The published-set kind was only ever knowable AFTER Pass A, because `category` is a
 * field the MODEL fills in during the rewrite. That is why no candidate-layer read
 * existed: at selection time there was nothing to count. This is that count.
 *
 * DELIBERATE LIMITS, stated because they bound every number this produces:
 *  - Lexical, not semantic. It reads the same prefix vocabulary `accountabilityScore`
 *    ranks with, so it inherits that vocabulary's blind spots exactly.
 *  - TITLE-FIRST, body only as a fallback when the title carries no signal at all.
 *    NOT the 2x-title weighting accountabilityScore uses, and the difference is
 *    deliberate — it was measured on 2026-09-07 while this function was being written.
 *    Under summed 2x weighting, the title "Super PAC filing names the donor" beside a
 *    body reading "a charitable foundation grant" classified as GIVING: one political
 *    title hit (6) lost to four giving body hits (12). Bodies are long and titles are
 *    short, so summing across both lets incidental body vocabulary decide the kind.
 *    Scoring a RANK and attributing a KIND are different jobs; only the second needs
 *    the title to win.
 *  - Winner-takes-all within the chosen text. A story genuinely both giving AND
 *    political is reported as one kind — the DOMINANT reading, not the only one.
 *  - THE GROUPS ARE NOT THE SAME SIZE, and this bounds every count: giving carries 17
 *    terms and power 18, against political's 13 and wealth's 10, so the larger groups
 *    get more chances to hit and a summed-hit rule leans their way. That matters here
 *    more than it looks: `giving` is the majority class this read exists to detect, so
 *    the bias runs TOWARD under-reporting the problem, never toward inventing it. Read
 *    a low political/wealth count as a floor. Equalising the lists would change
 *    accountabilityScore's ranking as a side effect and is explicitly not done here.
 *  - Ties break in SIGNAL_GROUPS order (giving, political, wealth, power) — the
 *    existing weight order, not a claim about importance.
 *  - `null` means no positive signal matched. It does NOT mean off-axis: the noise
 *    penalty is not consulted here. Read it as "unclassified", never as "irrelevant".
 */
export function candidateKind(title: string, body?: string): CandidateKind | null {
  const pick = (text: string): CandidateKind | null => {
    if (!text) return null;
    let bestKind: CandidateKind | null = null;
    let bestScore = 0;
    for (const { kind, weight, res } of SIGNAL_REGEX_BY_KIND) {
      let score = 0;
      for (const re of res) if (re.test(text)) score += weight;
      // Strict >, so an earlier group wins a tie — see the tie note above.
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
      }
    }
    return bestKind;
  };
  // The title decides whenever it says anything at all; the body is consulted only
  // for a title that carries no signal, never to overrule one that does.
  return pick(title || "") ?? pick(body || "");
}

/**
 * Count candidates by kind. Returns every kind including zeros, plus `unclassified`,
 * so the parts always sum to the input length.
 *
 * The summing property is the point, not a convenience: this lane's standing rule is
 * that a classified breakdown whose parts do not reach the raw denominator proves the
 * CLASSIFIER never fired, not that the metric is zero. A caller can assert
 * `sum(counts) === total` and know the read is honest.
 */
export function kindMix(
  items: { title: string; body?: string }[]
): { counts: Record<CandidateKind | "unclassified", number>; total: number } {
  const counts: Record<CandidateKind | "unclassified", number> = {
    giving: 0,
    political: 0,
    wealth: 0,
    power: 0,
    unclassified: 0,
  };
  for (const it of items) {
    const k = candidateKind(it.title, it.body);
    counts[k ?? "unclassified"] += 1;
  }
  return { counts, total: items.length };
}

/** Render a kind mix as a stable, log-friendly string: "giving 12 · power 3 · …". */
export function formatKindMix(mix: {
  counts: Record<CandidateKind | "unclassified", number>;
  total: number;
}): string {
  const order: (CandidateKind | "unclassified")[] = [
    "giving",
    "political",
    "wealth",
    "power",
    "unclassified",
  ];
  const parts = order.filter((k) => mix.counts[k] > 0).map((k) => `${k} ${mix.counts[k]}`);
  return `${parts.join(" · ") || "none"} (of ${mix.total})`;
}
