import { test } from "node:test";
import assert from "node:assert/strict";
import {
  punchScore,
  pickTopSlice,
  tensionScore,
  hedgePenalty,
  moneyScore,
  gatedMoneyScore,
  largestDollarAmount,
  sourceQualityScore,
  recencyScore,
  urlDomain,
  type PunchCard,
} from "./feed-punch";

// Fixed clock so recency is deterministic. This is the day R-040 shipped, and
// the cards below are the VERBATIM live top-of-feed captured that morning
// (docs/peak-moment-render-2026-07-24.md is the render-read baseline).
const NOW = new Date("2026-07-25T13:00:00Z");

function card(over: Partial<PunchCard> & { id: string; headline: string }): PunchCard {
  return { summary: null, source: null, sourceUrl: null, publishedAt: null, createdAt: null, ...over };
}

// --- the live front door on 2026-07-25, before this ranking existed ---------

const LURIE = card({
  id: "lurie",
  headline: "Jeffrey Lurie family considers expanding its autism philanthropy",
  summary: "The Lurie family may broaden its long-running funding for autism-related work, according to Inside Philanthropy.",
  sourceUrl: "https://www.insidephilanthropy.com/home/the-lurie-family-are-long-time-autism-research-backers",
  publishedAt: "2026-07-20T00:00:00Z",
  createdAt: "2026-07-21T12:46:32Z",
});

const ELLISON_SUED = card({
  id: "ellison",
  headline: "Paramount investor sues Ellison family over alleged Trump-CNN side deal",
  summary: "A Paramount investor has sued the Ellison family over an alleged side deal involving President Trump and CNN.",
  sourceUrl: "https://www.sej.org/headlines/ellisons-sued-paramount-investor-over-alleged-trump-cnn-side-deal",
  publishedAt: "2026-07-16T00:00:00Z",
  createdAt: "2026-07-24T12:47:41Z",
});

const HOFFMAN_PAC = card({
  id: "hoffman",
  headline: "Reid Hoffman gives $10 million to super PAC supporting Texas Senate candidate James Talarico",
  summary: "Reid Hoffman gave $10 million to a super PAC backing James Talarico's Senate campaign in Texas.",
  sourceUrl: "https://www.click2houston.com/news/texas/2026/07/16/billionaire-reid-hoffman-gives-10-million-to-super-pac",
  publishedAt: "2026-07-16T00:00:00Z",
  createdAt: "2026-07-23T12:48:53Z",
});

const THOMA_GRANT = card({
  id: "thoma",
  headline: "Carl and Marilynn Thoma Foundation awards more than $160,000 for Spanish American art grants and fellowships",
  summary: "The Thoma Foundation awarded more than $160,000 in grants and fellowships. Carl Thoma's estimated net worth is $5.7 billion.",
  sourceUrl: "https://artdaily.com/news/198126/Thoma-Foundation-awards-over-160-000",
  publishedAt: "2026-07-15T00:00:00Z",
  createdAt: "2026-07-22T12:47:46Z",
});

// The card the home hero actually led with: positive, aggregator-sourced, stale.
const DELL_PLEDGE = card({
  id: "dell",
  headline: "Michael Dell pledges $6.25 billion to expand school savings accounts",
  summary: "Michael Dell pledged $6.25 billion toward child savings accounts.",
  sourceUrl: "https://digg.com/michael-dell-pledges-6-25-billion",
  publishedAt: "2026-07-06T00:00:00Z",
  createdAt: "2026-07-07T12:46:00Z",
});

test("the speculative philanthropy card loses to the concrete lawsuit", () => {
  // This is the finding: /feed opened on "considers expanding" (zero fury) while
  // a live lawsuit sat below it.
  assert.ok(punchScore(ELLISON_SUED, NOW) > punchScore(LURIE, NOW));
});

test("a hedged headline scores below the same story stated as fact", () => {
  const hedged = card({ id: "a", headline: "Musk may donate $200 million to a super PAC" });
  const concrete = card({ id: "b", headline: "Musk donated $200 million to a super PAC" });
  assert.ok(punchScore(concrete, NOW) > punchScore(hedged, NOW));
});

test("pocket change does not outrank a real receipt", () => {
  // A $160k art grant is on-axis (foundation + grant + fellowship all score) but
  // it is a press release, not a receipt.
  assert.ok(punchScore(HOFFMAN_PAC, NOW) > punchScore(THOMA_GRANT, NOW));
});

test("aggregator sourcing sinks an otherwise identical card", () => {
  const viaAggregator = card({ ...DELL_PLEDGE, id: "agg" });
  const viaPrimary = card({ ...DELL_PLEDGE, id: "primary", sourceUrl: "https://www.propublica.org/article/dell-pledge" });
  assert.ok(punchScore(viaPrimary, NOW) > punchScore(viaAggregator, NOW));
});

test("low-credibility publishers sink hard but are not zeroed out", () => {
  const s = sourceQualityScore(null, "https://www.zerohedge.com/markets/story");
  assert.ok(s <= -10);
  // Still a finite score — a tier-1 card can reach the feed when it is the only
  // coverage (R-028 philosophy: downweight, never ban).
  assert.ok(Number.isFinite(s));
});

test("the positive stale aggregator hero loses to every live receipt", () => {
  // The literal 2026-07-24 render-read failure: this card WAS the hero.
  for (const better of [ELLISON_SUED, HOFFMAN_PAC]) {
    assert.ok(
      punchScore(better, NOW) > punchScore(DELL_PLEDGE, NOW),
      `${better.id} should outrank the Dell pledge hero`
    );
  }
});

test("recency is measured from createdAt, not publishedAt (R-010 lever)", () => {
  // GDELT re-serves old articles, so a card curated TODAY can carry a two-week-old
  // publishedAt. Ordering by publishedAt buried today's curation run.
  const curatedToday = card({
    id: "fresh-curation",
    headline: "Billionaire sued over undisclosed dark money transfer",
    publishedAt: "2026-07-11T00:00:00Z",
    createdAt: "2026-07-25T12:47:00Z",
  });
  const curatedWeeksAgo = card({
    id: "stale-curation",
    headline: "Billionaire sued over undisclosed dark money transfer",
    publishedAt: "2026-07-24T00:00:00Z",
    createdAt: "2026-06-25T12:47:00Z",
  });
  assert.ok(recencyScore(curatedToday, NOW) > recencyScore(curatedWeeksAgo, NOW));
  assert.ok(punchScore(curatedToday, NOW) > punchScore(curatedWeeksAgo, NOW));
});

test("recency cannot flip a soft card above a hard receipt", () => {
  // Bounded on purpose: a day of freshness must not buy the front door.
  const softButFresh = card({
    id: "soft",
    headline: "Foundation announces new philanthropy initiative",
    createdAt: "2026-07-25T12:00:00Z",
  });
  const hardButOlder = card({
    id: "hard",
    headline: "Investor sues billionaire over alleged $400 million tax dodge",
    createdAt: "2026-07-19T12:00:00Z",
  });
  assert.ok(punchScore(hardButOlder, NOW) > punchScore(softButFresh, NOW));
});

test("pickTopSlice promotes without duplicating or dropping cards", () => {
  const items = [LURIE, ELLISON_SUED, HOFFMAN_PAC, THOMA_GRANT, DELL_PLEDGE];
  const { promoted, rest } = pickTopSlice(items, 2, NOW);
  assert.equal(promoted.length, 2);
  assert.equal(rest.length, 3);
  const ids = [...promoted, ...rest].map((i) => i.id);
  assert.equal(new Set(ids).size, items.length, "no card appears twice");
  for (const item of items) assert.ok(ids.includes(item.id), `${item.id} survived`);
  // The lawsuit leads the front door.
  assert.equal(promoted[0].id, "ellison");
});

test("pickTopSlice leaves the remainder in the order it was given", () => {
  const items = [LURIE, ELLISON_SUED, HOFFMAN_PAC, THOMA_GRANT];
  const { rest } = pickTopSlice(items, 1, NOW);
  assert.deepEqual(rest.map((r) => r.id), ["lurie", "hoffman", "thoma"]);
});

test("pickTopSlice is stable when punch and timestamps tie", () => {
  const a = card({ id: "aaa", headline: "Billionaire sued over tax dodge", createdAt: "2026-07-25T00:00:00Z" });
  const b = card({ id: "bbb", headline: "Billionaire sued over tax dodge", createdAt: "2026-07-25T00:00:00Z" });
  const first = pickTopSlice([a, b], 1, NOW).promoted[0].id;
  const second = pickTopSlice([b, a], 1, NOW).promoted[0].id;
  assert.equal(first, second, "the hero must not reshuffle between page loads");
});

test("pickTopSlice handles a feed thinner than the slice", () => {
  const { promoted, rest } = pickTopSlice([ELLISON_SUED], 6, NOW);
  assert.equal(promoted.length, 1);
  assert.deepEqual(rest, []);
  assert.deepEqual(pickTopSlice([], 6, NOW), { promoted: [], rest: [] });
});

// --- component behaviour ---------------------------------------------------

test("tension only counts concrete conflict, and headline beats summary", () => {
  assert.ok(tensionScore("Billionaire indicted over fraud", null) > tensionScore("Billionaire buys a stake", null));
  assert.ok(
    tensionScore("Billionaire indicted", null) > tensionScore("Neutral headline", "the indictment was filed"),
    "a headline hit outweighs a summary hit"
  );
});

test("hedges are ignored in the summary", () => {
  assert.equal(hedgePenalty("Musk donated $200 million"), 0);
  assert.ok(hedgePenalty("Musk may donate $200 million") > 0);
});

test("money magnitude is parsed from long and short forms", () => {
  assert.equal(largestDollarAmount("gives $10 million to a super PAC"), 10_000_000);
  assert.equal(largestDollarAmount("$6.25 billion pledge"), 6_250_000_000);
  assert.equal(largestDollarAmount("$1.2B stake"), 1_200_000_000);
  assert.equal(largestDollarAmount("more than $160,000 for grants"), 160_000);
  assert.equal(largestDollarAmount("no figures here"), 0);
  // The LARGEST figure wins, not the first.
  assert.equal(largestDollarAmount("$500,000 of a $3 billion fortune"), 3_000_000_000);
});

test("money score penalises pocket change and rewards real sums", () => {
  assert.ok(moneyScore("awards more than $160,000 for art grants") < 0);
  assert.equal(moneyScore("gives $10 million to a super PAC"), 2);
  assert.equal(moneyScore("pledges $6.25 billion"), 3);
  assert.equal(moneyScore("no dollar figure at all"), 0);
});

test("a big number alone does not buy the front door", () => {
  // First live run of this ranking promoted three positive giving announcements
  // on figures alone — the soft hero rebuilt from a different direction.
  const positiveGiving = "Bloomberg Philanthropies includes Hamilton County in $90 million skilled-trades initiative";
  assert.equal(gatedMoneyScore(positiveGiving, 0), 0, "no tension, no political spend → no bonus");
  assert.equal(gatedMoneyScore("Hoffman gives $10 million to super PAC", 0), 2, "political money still counts");
  assert.equal(gatedMoneyScore("Investor sues over $400 million transfer", 9), 3, "conflict money still counts");
  assert.equal(
    gatedMoneyScore("Foundation awards more than $160,000 in art grants", 0),
    -3,
    "the pocket-change penalty is never gated away"
  );
});

test("KNOWN CEILING — a bag-of-words hedge test misreads some concrete headlines (R-040)", () => {
  // "could not sit on the sidelines" is a QUOTE, not speculation about the deal,
  // but "could " matches. Pinned deliberately: the fix is a parser or an LLM
  // judge over the ~6 promoted cards, NOT loosening the hedge list (that would
  // let "considers expanding its autism philanthropy" back onto the front door).
  const falseHedge = "Jeff Bezos backs a $41 billion AI bet and says he could not sit on the sidelines";
  assert.ok(hedgePenalty(falseHedge) > 0, "documents the misfire; flip this when it is fixed");
});

test("urlDomain strips scheme and www, and survives junk", () => {
  assert.equal(urlDomain("https://www.Digg.com/story"), "digg.com");
  assert.equal(urlDomain("not a url"), "");
  assert.equal(urlDomain(null), "");
});

test("a card with no timestamps scores without throwing", () => {
  const bare = card({ id: "bare", headline: "Billionaire donates $5 million" });
  assert.equal(recencyScore(bare, NOW), 0);
  assert.ok(Number.isFinite(punchScore(bare, NOW)));
});

// --- B-023: same-event collapse inside the promoted set ---------------------
//
// These two headlines are the VERBATIM live pair from the served front door on
// 2026-08-06 (`npm run check:frontdoor`), scoring 0.267 — well below the ingest
// guard's 0.40, and below even the 0.364 measured floor, so NO threshold at
// ingest could have reached them. The owner ruled 2026-08-04 that they are one
// event. They sat at #4/#5, then #3/#5, and did not age out on their own.

const BUFFETT_A = card({
  id: "buffett-a",
  headline:
    "Buffett Ends Gates Foundation Donations After Two Decades, While Berkshire Holdings Remain Influential",
  sourceUrl: "https://www.reuters.com/buffett-ends-gates-donations",
  createdAt: "2026-08-05T12:00:00Z",
});

const BUFFETT_B = card({
  id: "buffett-b",
  headline:
    "Warren Buffett says Bill Gates knew his foundation would receive no further Buffett donations",
  sourceUrl: "https://www.cnbc.com/buffett-gates-knew",
  createdAt: "2026-08-06T12:00:00Z",
});

test("B-023 — one event does not take two of the six promoted slots", () => {
  const { promoted, rest } = pickTopSlice([BUFFETT_A, BUFFETT_B, LURIE], 6, NOW);
  const ids = promoted.map((p) => p.id);
  assert.equal(
    ids.filter((id) => id.startsWith("buffett")).length,
    1,
    "the front door promoted the same event twice"
  );
  // The loser is DEMOTED, not dropped — that asymmetry is why this fix is safe
  // at display and would not be at ingest.
  assert.ok(
    rest.some((r) => r.id.startsWith("buffett")),
    "the collapsed card must still reach the recency stream"
  );
  assert.equal(promoted.length + rest.length, 3, "no card may vanish");
});

test("B-023 — collapse does not merge two different stories about one person", () => {
  const gatesEpstein = card({
    id: "g1",
    headline: "Gates Foundation staffers told leaders of Epstein risks, review finds",
    createdAt: "2026-08-06T12:00:00Z",
  });
  const gatesPortfolio = card({
    id: "g2",
    headline: "Bill Gates’ foundation keeps 78% of its $34 billion portfolio in four stocks",
    createdAt: "2026-08-06T11:00:00Z",
  });
  const { promoted } = pickTopSlice([gatesEpstein, gatesPortfolio], 6, NOW);
  assert.equal(promoted.length, 2, "a shared surname must not collapse distinct events");
});

test("B-023 — the slot freed by a collapse is refilled, not left empty", () => {
  // Deliberately unrelated to each other AND to the Buffett pair. An earlier
  // draft used one template with a changing number and they all collapsed into
  // each other — correctly, since a signature is content words and the template
  // was the content. Formulaic headlines really are near-duplicates at 0.25.
  const headlines = [
    "Elon Musk’s xAI faces a Delaware subpoena over its funding round",
    "Ken Griffin sells his Chicago tower at a reported loss",
    "Larry Ellison’s health venture misses its enrollment target",
    "Jeff Bezos backs a $41 billion artificial intelligence bet",
    "Michael Bloomberg funds a climate lawsuit against three utilities",
    "Charles Koch quietly exits a refinery partnership in Texas",
  ];
  const filler = (n: number) =>
    card({ id: `f${n}`, headline: headlines[n], createdAt: "2026-08-04T12:00:00Z" });
  const pool = [BUFFETT_A, BUFFETT_B, filler(0), filler(1), filler(2), filler(3), filler(4), filler(5)];
  const { promoted } = pickTopSlice(pool, 6, NOW);
  assert.equal(promoted.length, 6, "a collapsed card must not cost the front door a slot");
  assert.equal(new Set(promoted.map((p) => p.id)).size, 6, "no duplicate ids in the promoted set");
});
