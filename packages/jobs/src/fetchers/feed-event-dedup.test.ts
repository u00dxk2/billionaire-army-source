import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CROSS_RUN_EVENT_THRESHOLD,
  EVENT_JACCARD_THRESHOLD,
  clusterFeedCards,
  eventSignature,
  jaccardScore,
  mergeClusters,
  sameEvent,
  type FeedCard,
} from "./feed-event-dedup";

/**
 * Every string below is verbatim from prod (2026-07-14): raw GDELT article titles and
 * live feed headlines. The cross-run cases are the duplicate cards that actually shipped
 * — the Buffett/Gates pause carded 3 days running, the Dell pledge twice, and the Coxe
 * $100M donation three times over three weeks.
 */

const crossRun = (articleTitle: string, publishedHeadline: string) =>
  sameEvent(
    eventSignature(articleTitle),
    eventSignature(publishedHeadline),
    CROSS_RUN_EVENT_THRESHOLD
  );

// --- intra-run (title vs title): existing calibration, must not drift ---

test("intra-run: two outlets on the same event collapse", () => {
  assert.equal(
    sameEvent(
      eventSignature("Warren Buffett skips donation to Gates Foundation amid Epstein review"),
      eventSignature("Warren Buffett pauses Gates Foundation donation over Epstein ties")
    ),
    true
  );
});

test("intra-run: two unrelated stories about the same person do NOT collapse", () => {
  assert.equal(
    sameEvent(
      eventSignature("Gabe Newell Shoots Down Steam Monopoly Claims As Valve Faces Antitrust Scrutiny"),
      eventSignature("Valve Boss Gabe Newell Donated Over $20 Million to OpenAI")
    ),
    false
  );
});

// --- cross-run (raw article title vs the published GPT rewrite) ---

test("cross-run: catches the Buffett/Gates card that re-shipped the next day", () => {
  assert.equal(
    crossRun(
      "Warren Buffett skips donation to Gates Foundation amid Epstein review",
      "Warren Buffett reportedly skips Gates Foundation donation during Epstein-related review"
    ),
    true
  );
});

test("cross-run: catches the Dell $6.25B pledge re-card two days later", () => {
  assert.equal(
    crossRun(
      "Michael and Susan Dell pledge $6 . 25 billion for children Trump Accounts",
      "Michael and Susan Dell pledge $6.25 billion for investment accounts for 25 million U.S. children"
    ),
    true
  );
});

/**
 * The tightest true positive in the whole corpus (0.438) and the reason the threshold is
 * 0.40 and not 0.45. "healthcare" vs "health"+"care" tokenizes apart, which costs overlap
 * on an otherwise obvious duplicate. If someone raises the threshold, this test fails
 * first — that is the point.
 */
test("cross-run: catches the Coxe $100M donation recirculating 8 days later", () => {
  assert.equal(
    crossRun(
      "Texas big medical boost : Nvidia billionaire Tench Coxe , wife Simone donate $100 million to UT Austin healthcare project",
      "Tench Coxe and his wife donate $100 million to UT Austin health project"
    ),
    true
  );
});

test("cross-run: does NOT collapse two different events for the same person", () => {
  assert.equal(
    crossRun(
      "Valve Boss Gabe Newell Donated Over $20 Million to OpenAI",
      "Gabe Newell disputes Steam monopoly claims as Valve faces antitrust scrutiny"
    ),
    false
  );
});

test("cross-run threshold is looser than intra-run (rewrites dilute overlap)", () => {
  assert.ok(CROSS_RUN_EVENT_THRESHOLD < EVENT_JACCARD_THRESHOLD);
});

test("an empty signature never matches (guards a headline of pure stopwords)", () => {
  assert.equal(sameEvent(eventSignature(""), eventSignature("Elon Musk buys Twitter")), false);
});

// Real dupe pairs that reached the LIVE feed (read 2026-07-19). Each pair shared one
// publishedAt — the same article re-served by GDELT 15-31 days later — but the original
// card had aged out of the then-14-day lookback, so the guard never compared them. The
// window is now 45d (feed-curator.ts); these pin the MATCHER half, so a future tokenizer
// change can't silently un-catch them and re-open the same hole from the other side.
test("cross-run: catches the live dupe pairs the 14-day window let through", () => {
  assert.equal(
    crossRun(
      "Rick Caruso-funded sheriff office site opens in Montecito",
      "Rick Caruso-funded sheriff’s office site opens in Montecito"
    ),
    true
  );
  assert.equal(
    crossRun(
      "Bloomberg Philanthropies backs clean-energy transition investment",
      "Bloomberg Philanthropies investment targets the clean-energy transition"
    ),
    true
  );
  assert.equal(
    crossRun(
      "Boston Building Resources receives $75,000 grant from Cummings Foundation",
      "Cummings Foundation awards Boston Building Resources a $75,000 grant"
    ),
    true
  );
  assert.equal(
    crossRun(
      "Jan Koum foundation gives $36 million to Milken Community School for campus expansion",
      "Koum Family Foundation gives $36 million to expand Los Angeles Jewish school campus"
    ),
    true
  );
});

// KNOWN GAP (B-016 ceiling, filed as R-036) — this live pair is the SAME event (one
// publishedAt, carded 07-04 and again 07-19) but does NOT match at 0.40: bag-of-words has
// no stemming, so "criticizes" and "criticism" tokenize apart, and the second headline
// drops the donation figure that carried most of the shared signal. Asserted FALSE
// deliberately: this documents the gap and will FAIL THE DAY someone adds stemming —
// that failure is the signal to flip it to true, not a regression. Do NOT "fix" it by
// lowering the threshold; the 0.40 calibration has a verified-empty FP band and the Coxe
// true-positive sits at 0.438, so it fails first.
test("cross-run: KNOWN MISS — stemming gap on a live dupe pair (R-036)", () => {
  assert.equal(
    crossRun(
      "Miriam Adelson’s newspaper criticizes Trump despite her $146.6M in political donations",
      "Miriam Adelson-owned newspaper publishes sharp criticism of Trump"
    ),
    false
  );
});

// --- clusterFeedCards: cleanup-script clustering (sourceUrl-first, then event) ---

const card = (id: string, day: string, headline: string, sourceUrl: string | null): FeedCard => ({
  id,
  headline,
  sourceUrl,
  createdAt: new Date(`2026-${day}T00:00:00.000Z`),
  votes: 0,
  comments: 0,
});

test("clusterFeedCards: same sourceUrl collapses the R-036 pair the matcher misses", () => {
  // Verbatim live residue (read 2026-07-20): both cards are the same Daily Beast article,
  // carded 15 days apart, but sameEvent() scores them below 0.40 (criticizes vs criticism).
  const url = "https://www.thedailybeast.com/donald-trumps-megadonor-miriam";
  const clusters = clusterFeedCards([
    card("a", "07-04", "Miriam Adelson’s newspaper criticizes Trump despite her $146.6M in political donations", url),
    card("b", "07-19", "Miriam Adelson-owned newspaper publishes sharp criticism of Trump", url),
  ]);
  // The matcher alone would leave two clusters; the URL check collapses them to one.
  assert.equal(sameEvent(eventSignature("Miriam Adelson’s newspaper criticizes Trump despite her $146.6M in political donations"), eventSignature("Miriam Adelson-owned newspaper publishes sharp criticism of Trump"), CROSS_RUN_EVENT_THRESHOLD), false);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].keep.id, "a"); // earliest kept
  assert.deepEqual(clusters[0].drop.map((c) => c.id), ["b"]);
});

test("clusterFeedCards: a URL carded 3x collapses to one cluster (live Skoll residue)", () => {
  const url = "https://www.insidephilanthropy.com/home/the-10-figure-elepha";
  const clusters = clusterFeedCards([
    card("a", "06-21", "Inside Philanthropy highlights the scale of Jeff Skoll’s giving empire", url),
    card("b", "06-29", "Jeff Skoll’s philanthropy network confronts the size of its own politics", url),
    card("c", "07-14", "Inside Philanthropy examines the billion-dollar influence surrounding Jeff Skoll", url),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].drop.length, 2);
});

test("clusterFeedCards: still collapses same-event cards at DIFFERENT urls (event path intact)", () => {
  const clusters = clusterFeedCards([
    card("a", "07-01", "Warren Buffett skips donation to Gates Foundation amid Epstein review", "https://a.example/1"),
    card("b", "07-02", "Warren Buffett reportedly skips Gates Foundation donation during Epstein-related review", "https://b.example/2"),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].drop[0].id, "b");
});

test("clusterFeedCards: unrelated cards stay separate; null sourceUrl never collapses", () => {
  const clusters = clusterFeedCards([
    card("a", "07-01", "Elon Musk buys another AI startup", null),
    card("b", "07-02", "Jeff Bezos funds a new ocean cleanup effort", null),
  ]);
  assert.equal(clusters.length, 2);
});

/**
 * B-022 overlap proof, measured 2026-08-03 across all 118 live cards / 6,903 pairs
 * (`packages/jobs/src/probe-b022-frontdoor.ts`).
 *
 * The obvious cure for B-022 is "lower CROSS_RUN_EVENT_THRESHOLD until it catches the
 * duplicates that are visibly live." These four verbatim prod headlines are why that can
 * never work: a FALSE positive scores ABOVE two TRUE positives, so the bands below the
 * 0.364 calibration floor are INTERLEAVED, not merely unmeasured. Any threshold low
 * enough to collapse the real Buffett and Pritzker dupes also collapses two genuinely
 * different Haslam gifts.
 *
 * This test fails if someone re-tunes the signature to "fix" B-022 by widening overlap —
 * which is the sixth version of the mistake this repo has made five times with the 990
 * attribution matcher. The LLM same-event-vs-new-development judge is the only path.
 */
const score = (a: string, b: string) => jaccardScore(eventSignature(a), eventSignature(b));

test("B-022: a FALSE positive outranks TRUE positives below the floor — no threshold separates them", () => {
  const koumTrue = score(
    "Jan Koum gives $200 million to Shaare Zedek Medical Center",
    "Jan Koum donates $200 million to expand Jerusalem's Shaare Zedek hospital"
  );
  const haslamFalse = score(
    "Jimmy and Dee Haslam give $25 million to Cleveland Clinic",
    "Dee and Jimmy Haslam donate $130 million to the University of Tennessee"
  );
  const buffettTrue = score(
    "Buffett Ends Gates Foundation Donations After Two Decades, While Berkshire Holdings Remain Influential",
    "Buffett discusses Gates Foundation donations, Epstein regret and estate plans"
  );
  const pritzkerTrue = score(
    "Illinois Gov. JB Pritzker signs laws on birth control access, AI, and early learning",
    "Illinois Gov. J.B. Pritzker signs AI regulation into law amid industry pushback"
  );

  // The inversion IS the finding: a different-events pair sits above two same-event pairs.
  assert.ok(
    haslamFalse > buffettTrue && haslamFalse > pritzkerTrue,
    `expected the Haslam FALSE positive (${haslamFalse.toFixed(4)}) to outrank the Buffett ` +
      `(${buffettTrue.toFixed(4)}) and Pritzker (${pritzkerTrue.toFixed(4)}) TRUE positives`
  );
  // And all of them sit below the live threshold, so today's guard catches none of them.
  for (const s of [koumTrue, haslamFalse, buffettTrue, pritzkerTrue]) {
    assert.ok(s < CROSS_RUN_EVENT_THRESHOLD, `${s.toFixed(4)} should be under the live threshold`);
  }
});

test("B-022: the Jan Koum true positive sits in the 0.364..0.40 margin, not below it", () => {
  // Three cards shipped for this one $200M gift. It is the case that would be caught by
  // moving 0.40 down to the calibration floor — a STANDING-RULING question, not an agent
  // call. Pinned so the margin's cost stays visible if that ruling is ever revisited.
  const koum = score(
    "Jan Koum gives $200 million to Shaare Zedek Medical Center",
    "Jan Koum donates $200 million to expand Jerusalem's Shaare Zedek hospital"
  );
  assert.ok(koum >= 0.36 && koum < CROSS_RUN_EVENT_THRESHOLD, `Jan Koum scored ${koum.toFixed(4)}`);
});

// --- mergeClusters: the judge-driven merge on the destructive cleanup path (B-022) ---

const mkCard = (id: string, day: number): FeedCard => ({
  id,
  headline: id,
  sourceUrl: `https://example.com/${id}`,
  createdAt: new Date(Date.UTC(2026, 5, day)),
  votes: 0,
  comments: 0,
});
const solo = (id: string, day: number) => ({ keep: mkCard(id, day), drop: [] });

test("mergeClusters: no SAME verdicts leaves clustering untouched", () => {
  const out = mergeClusters([solo("a", 1), solo("b", 2)], []);
  assert.equal(out.length, 2);
  assert.deepEqual(out.flatMap((c) => c.drop), []);
});

test("mergeClusters: a SAME pair merges and the EARLIEST card survives", () => {
  const out = mergeClusters([solo("a", 1), solo("b", 2)], [[0, 1]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].keep.id, "a");
  assert.deepEqual(out[0].drop.map((c) => c.id), ["b"]);
});

// The live Jan Koum shape: one $200M gift carded three times, surfaced as two overlapping
// pairs. A pairwise merge would leave two clusters each claiming a card.
test("mergeClusters: overlapping pairs (A~B, B~C) collapse to ONE cluster of three", () => {
  const out = mergeClusters([solo("a", 1), solo("b", 2), solo("c", 3)], [[0, 1], [1, 2]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].keep.id, "a");
  assert.deepEqual(out[0].drop.map((c) => c.id).sort(), ["b", "c"]);
});

test("mergeClusters: a merged cluster inherits the drops the deterministic pass found", () => {
  const out = mergeClusters([{ keep: mkCard("a", 1), drop: [mkCard("a2", 2)] }, solo("b", 3)], [[0, 1]]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].drop.map((c) => c.id).sort(), ["a2", "b"]);
});

test("mergeClusters: unrelated clusters are untouched by a merge elsewhere", () => {
  const out = mergeClusters([solo("a", 1), solo("b", 2), solo("z", 9)], [[0, 1]]);
  assert.equal(out.length, 2);
  assert.ok(out.some((c) => c.keep.id === "z" && c.drop.length === 0));
});
