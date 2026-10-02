/**
 * Feed DISPLAY ranking — the "punch score" (R-040, 2026-07-25).
 *
 * The 2026-07-24 peak-moment render read (docs/peak-moment-render-2026-07-24.md)
 * found that of the 7 cards a new user meets first (home hero + /feed top 6),
 * ~0 fired the fury → clarity → receipt gut-punch, even though every instrument
 * was green. The cause was two ranking systems, neither of which optimizes the
 * moment:
 *
 *   SELECTION — the curator's accountability pre-rank floats ON-AXIS candidates,
 *   but on-axis is a TOPIC test, not a TENSION test: "family considers expanding
 *   its autism philanthropy" is perfectly on-axis and carries zero fury.
 *
 *   DISPLAY — GET /api/feed sorted publishedAt DESC (recency only), so a softer
 *   newer card sat above a hard receipt, and the home hero (which reads the top
 *   of that same list) led with a POSITIVE $6.25B pledge, sourced to an
 *   AGGREGATOR (digg.com), 18 days old.
 *
 * This module scores a published card for the front door. It reuses
 * accountabilityScore() (topic density — the same calibration the curator sorts
 * candidates by) and credibilityTier() (the R-028 low-credibility list), then
 * adds the three factors the frozen R-040 scope names: TENSION (is there a
 * concrete conflict, or is this speculation?), RECENCY (via createdAt — when WE
 * curated it, not when the outlet published it), and PRIMARY-SOURCE QUALITY
 * (an aggregator is not a receipt).
 *
 * It does NOT decide what publishes — the two-pass curator + faithfulness gate
 * remain the quality floor. It only decides what sits on TOP.
 *
 * Deterministic + dependency-free so it can be unit-tested without the API.
 */

import { accountabilityScore } from "./feed-relevance-rank";
import { credibilityTier } from "./feed-source-credibility";
import { eventSignature, jaccardScore } from "./feed-event-signature";

/**
 * Display-time same-event collapse (B-023). Deliberately LOOSER than the ingest
 * guard's CROSS_RUN_EVENT_THRESHOLD (0.40) — and it has to be, because no
 * threshold can separate these bands: measured across 6,903 live pairs, a FALSE
 * positive scores 0.333 while TRUE ones score 0.267 and 0.250. The bands
 * INTERLEAVE. That is why this is not another attempt at calibration.
 *
 * What makes a loose value affordable here is the COST ASYMMETRY, which is the
 * whole reason B-023's fix lives at display rather than at ingest: a false
 * positive costs a card its PROMOTION, not its publication. The card still ships
 * and still appears in the recency stream one slot down. At ingest the same
 * mistake would suppress it for 45 days.
 *
 * Calibrated against the live served front door (2026-08-06, `check:frontdoor`):
 * of 780 pairs across the 40 served cards, exactly 3 sit in 0.20..0.364 — the
 * Buffett/Gates donation pair (0.267), T. Denny Sanford's death (0.273) and
 * Pritzker's bill signing (0.250), all three genuine same-event repeats. So 0.25
 * collapses those three and touches nothing else; the blast radius is measured,
 * not assumed.
 *
 * ponytail: bag-of-words, so a genuine FOLLOW-UP in a running story reads as a
 * re-run and loses its promotion. That is the known ceiling of every same-event
 * check in this codebase and it is not fixable by moving this number. The
 * upgrade path is the B-022 LLM judge over the collapsed set.
 */
export const DISPLAY_EVENT_COLLAPSE_THRESHOLD = 0.25;

/** The subset of a feed row this ranking reads. */
export interface PunchCard {
  id: string;
  headline: string;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  publishedAt?: Date | string | null;
  /** When the curator wrote the card. The R-010 lever — see recencyScore(). */
  createdAt?: Date | string | null;
}

/**
 * Concrete conflict — something HAPPENED and someone is on the hook for it.
 * Word-boundary prefixes, same convention as feed-relevance-rank.ts
 * ("\binvestigat" covers investigate/investigation/investigating).
 */
const TENSION_TERMS = [
  "sue", "sues", "sued", "lawsuit", "litigat", "indict", "subpoena", "probe",
  "investigat", "testif", "settle", "fined", "penalt", "violat", "fraud",
  "scandal", "accus", "alleg", "criticiz", "criticism", "backlash", "outrage",
  "tax avoid", "tax dodg", "loophole", "offshore", "shell compan", "dark money",
  "conflict of interest", "hypocri", "layoff", "union-bust", "price goug",
  "evict", "polluti", "secretly", "quietly", "undisclosed", "refus", "blocked",
  "opposed", "spent against", "cut funding", "pulled funding", "walked back",
];

/**
 * Hedged / not-yet-happened language. A card whose headline is a MAYBE cannot
 * carry a receipt, so it is penalised harder than a merely off-axis one — this
 * is what sinks "considers expanding its autism philanthropy" off the front
 * door. Kept to unambiguous hedges: no "will", no "to" constructions, both of
 * which appear in plenty of concrete headlines.
 */
const HEDGE_TERMS = [
  "consider", "mull", "weigh", "may ", "might ", "could ", "would ", "expected to",
  "reportedly", "rumor", "eyes ", "explor", "in talks", "plans to", "set to",
  "poised to", "is likely", "speculat", "floated", "hinted",
];

/**
 * Republishers / syndicators. A card sourced here is real news arriving through
 * a pipe, but the SOURCE LINE prints on the card and "per digg.com" is not a
 * receipt — so it sinks below the same story from whoever reported it.
 *
 * This is a SEPARATE axis from credibilityTier() (R-028): that list is about
 * documented reliability problems, this one is about original reporting. An
 * aggregator is not being called unreliable.
 */
const AGGREGATOR_DOMAINS = [
  "digg.com", "msn.com", "news.google.com", "news.yahoo.com", "yahoo.com",
  "flipboard.com", "apple.news", "smartnews.com", "newsbreak.com",
  "biztoc.com", "headtopics.com", "onenewspage.com", "newsbreakapp.com",
];

const TENSION_REGEX = TENSION_TERMS.map((t) => new RegExp("\\b" + escapeRegex(t), "i"));
const HEDGE_REGEX = HEDGE_TERMS.map((t) => new RegExp("\\b" + escapeRegex(t), "i"));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Topic density (accountabilityScore) is deliberately DOWN-WEIGHTED for display.
 * It is a "is this on-axis at all" floor, not the punch: the curator's weights
 * give a philanthropy card +6 for the word "foundation" and another +6 for
 * "grant", which is why a $160,000 art-grant announcement could outrank an
 * investor lawsuit under a straight reuse. On-axis is the price of admission;
 * TENSION and MONEY MAGNITUDE decide the order.
 */
const TOPIC_WEIGHT = 0.5;

/** Per-hit weights, capped so one keyword-stuffed headline can't run away with the top slot. */
const TENSION_WEIGHT = 3;
const TENSION_CAP = 3;
const HEDGE_WEIGHT = 4;
const HEDGE_CAP = 2;
const AGGREGATOR_PENALTY = 4;
/** Low-credibility publishers sink hard but are never banned (R-028 philosophy). */
const LOW_CREDIBILITY_PENALTY = 10;

/** Tension counts double in the headline (what the reader actually sees) vs the summary. */
export function tensionScore(headline: string, summary?: string | null): number {
  const h = headline || "";
  const s = summary || "";
  let hits = 0;
  let bodyHits = 0;
  for (const re of TENSION_REGEX) {
    if (re.test(h)) hits++;
    else if (s && re.test(s)) bodyHits++;
  }
  return Math.min(hits, TENSION_CAP) * TENSION_WEIGHT + Math.min(bodyHits, TENSION_CAP);
}

/** Hedges only count in the HEADLINE — a summary that mentions a possibility is fine. */
export function hedgePenalty(headline: string): number {
  const h = headline || "";
  let hits = 0;
  for (const re of HEDGE_REGEX) if (re.test(h)) hits++;
  return Math.min(hits, HEDGE_CAP) * HEDGE_WEIGHT;
}

const MONEY_RE = /\$\s?([\d][\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|[tbmk])?\b/gi;
const MONEY_MULTIPLIER: Record<string, number> = {
  trillion: 1e12, t: 1e12,
  billion: 1e9, b: 1e9,
  million: 1e6, m: 1e6,
  thousand: 1e3, k: 1e3,
};

/** Largest dollar figure in the text, in dollars. 0 if none. */
export function largestDollarAmount(text: string): number {
  let max = 0;
  for (const m of (text || "").matchAll(MONEY_RE)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = m[2] ? MONEY_MULTIPLIER[m[2].toLowerCase()] ?? 1 : 1;
    max = Math.max(max, n * mult);
  }
  return max;
}

/**
 * Money magnitude, read from the HEADLINE ONLY — the figure the reader actually
 * sees. Reading the summary too would score a small gift on the giver's net
 * worth ("a $160,000 grant" + "$5.7 billion fortune"), which is backwards.
 *
 * A headline whose only figure is pocket change relative to a billionaire
 * fortune is PENALISED: a $160,000 art grant from a $5.7B fortune is a press
 * release, not a receipt, and it was outranking real ones.
 *
 * ponytail: absolute thresholds, not a giving-to-wealth RATIO. The ratio is the
 * real thesis but needs the person's net worth joined pre-sort — see the note on
 * punchScore(). Upgrade to the ratio when that join exists.
 */
export function moneyScore(headline: string): number {
  const amount = largestDollarAmount(headline);
  if (amount === 0) return 0;
  if (amount >= 100_000_000) return 3;
  if (amount >= 10_000_000) return 2;
  if (amount >= 1_000_000) return 1;
  return -3;
}

/**
 * A big number only earns its bonus when it sits next to CONFLICT or POLITICAL
 * SPENDING — money is a multiplier on tension, not a virtue in itself.
 *
 * Without this gate the first live run of this ranking promoted three positive
 * giving announcements ("$90 million skilled-trades initiative", "pledges $20
 * million for recreation facility", "philanthropy tops $1 billion") onto the
 * front door on the strength of their figures alone — which is the exact soft
 * hero the render read flagged, rebuilt from a different direction. Those cards
 * are real receipts and still publish; they just don't lead.
 *
 * The pocket-change PENALTY is never gated away: a $160,000 grant does not
 * belong on the front door whether or not anyone is suing.
 */
const POLITICAL_MONEY_RE =
  /\b(super pac|political action committee|megadonor|dark money|campaign|lobby|political (donation|giving|spending)|bankroll)/i;

export function gatedMoneyScore(headline: string, tension: number): number {
  const raw = moneyScore(headline);
  if (raw <= 0) return raw;
  return tension > 0 || POLITICAL_MONEY_RE.test(headline || "") ? raw : 0;
}

/** Domain of a URL, lowercased, no scheme/www. Empty string if unparseable. */
export function urlDomain(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Source quality: aggregator republishers and documented-unreliable publishers
 * sink. Reads BOTH the stored source string (GDELT stores a domain) and the
 * sourceUrl host, because NewsAPI stores a display name that matches neither
 * list.
 */
export function sourceQualityScore(source: string | null | undefined, sourceUrl: string | null | undefined): number {
  const domain = urlDomain(sourceUrl);
  const stored = (source || "").trim().toLowerCase();
  let score = 0;

  const isAggregator = AGGREGATOR_DOMAINS.some(
    (d) => domain === d || domain.endsWith("." + d) || stored === d || stored.endsWith("." + d)
  );
  if (isAggregator) score -= AGGREGATOR_PENALTY;

  if (credibilityTier(stored) === 1 || credibilityTier(domain) === 1) score -= LOW_CREDIBILITY_PENALTY;

  return score;
}

/**
 * Recency, measured from `createdAt` (when the curator wrote the card) and NOT
 * from `publishedAt`.
 *
 * This is the R-010 lever. GDELT's stalest-first rotation re-serves an article
 * 15-45 days after it was published, so a card curated TODAY can carry a
 * publishedAt from two weeks ago; ordering the front door by publishedAt buried
 * today's work (measured 2026-07-19: fresh cards at feed positions
 * 1/24/48/67/68/87). Scoring by createdAt is what lets the R-037 ingest cap be
 * relaxed later without re-opening that burial.
 *
 * Bounded and coarse on purpose: recency is a TIEBREAK-STRENGTH factor here,
 * not the primary key — a hard receipt should not be displaced by a soft card
 * that happens to be a day fresher.
 */
export function recencyScore(card: PunchCard, now: Date): number {
  const stamp = card.createdAt ?? card.publishedAt;
  if (!stamp) return 0;
  const t = stamp instanceof Date ? stamp.getTime() : Date.parse(String(stamp));
  if (!Number.isFinite(t)) return 0;
  const ageDays = (now.getTime() - t) / 86_400_000;
  if (ageDays < 2) return 4;
  if (ageDays < 4) return 3;
  if (ageDays < 8) return 2;
  if (ageDays < 15) return 1;
  if (ageDays < 30) return 0;
  // A card we curated more than a month ago has no business leading a feed whose
  // whole proxy metric is freshness — even a hard receipt.
  return -5;
}

/**
 * Higher = belongs closer to the front door. Can go negative.
 *
 * ponytail: no wealth-contrast term yet (the render read's P1 wanted
 * "large net worth x low giving-ratio"). The card's snapshotted contextData.pbs
 * is unreliable — old cards carry stale v1 0-1 scores (B-005) and the live score
 * is only joined AFTER the rows are chosen, so a contrast term here would score
 * on bad data. Add it when the live score is available pre-sort (a stored
 * punch column, or joining scoreSnapshots into the window query).
 */
export function punchScore(card: PunchCard, now: Date = new Date()): number {
  const tension = tensionScore(card.headline, card.summary);
  return (
    Math.round(accountabilityScore(card.headline, card.summary ?? undefined) * TOPIC_WEIGHT) +
    tension -
    hedgePenalty(card.headline) +
    gatedMoneyScore(card.headline, tension) +
    sourceQualityScore(card.source, card.sourceUrl) +
    recencyScore(card, now)
  );
}

/**
 * Split a recency-ordered window into the cards that get promoted to the front
 * door and the rest, order otherwise preserved.
 *
 * Ties break on createdAt desc (freshest curation first), then on id so the
 * order is stable across requests — an unstable front door would reshuffle the
 * hero on every page load.
 */
export function pickTopSlice<T extends PunchCard>(
  items: T[],
  count: number,
  now: Date = new Date()
): { promoted: T[]; rest: T[] } {
  if (!items?.length || count <= 0) return { promoted: [], rest: items ?? [] };

  const scored = items.map((item) => ({ item, punch: punchScore(item, now) }));
  const ranked = [...scored].sort((a, b) => {
    if (b.punch !== a.punch) return b.punch - a.punch;
    const at = stampMs(a.item), bt = stampMs(b.item);
    if (bt !== at) return bt - at;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });

  // Walk in punch order and promote a card only if it is not the same EVENT as
  // one already promoted (B-023). The ingest guard cannot catch these: it scores
  // a raw article title against an already-published GPT REWRITE, so a pair that
  // is invisible at ingest can be plainly the same story once BOTH sides are
  // rewritten — which is the pair a reader actually sees. Highest punch wins the
  // slot; the loser is not dropped, it just falls back to the recency stream.
  const promoted: T[] = [];
  const promotedSigs: Set<string>[] = [];
  for (const { item } of ranked) {
    if (promoted.length >= count) break;
    const sig = eventSignature(item.headline);
    const dupe = promotedSigs.some(
      (s) => jaccardScore(sig, s) >= DISPLAY_EVENT_COLLAPSE_THRESHOLD
    );
    if (dupe) continue;
    promoted.push(item);
    promotedSigs.push(sig);
  }

  const promotedIds = new Set(promoted.map((p) => p.id));
  return { promoted, rest: items.filter((i) => !promotedIds.has(i.id)) };
}

function stampMs(card: PunchCard): number {
  const stamp = card.createdAt ?? card.publishedAt;
  if (!stamp) return 0;
  const t = stamp instanceof Date ? stamp.getTime() : Date.parse(String(stamp));
  return Number.isFinite(t) ? t : 0;
}
