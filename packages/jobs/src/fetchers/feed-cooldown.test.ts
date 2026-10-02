import { test } from "node:test";
import assert from "node:assert/strict";
import { isOnCooldown, cooldownKind, sendTier, refusedCooldownRows, faithfulnessCooldownRows, SOURCE_PASS_B, SOURCE_PASS_C, COOLDOWN_MATCH_THRESHOLD } from "./feed-cooldown";
import { eventSignature, jaccardScore, accountabilityScore } from "@ba/shared";

// B-052 made the refusal a ROW rather than a bare title. Pass A rows carry personId null
// (person-blind by design), so the five R-048 fixtures below say so explicitly — and that
// is the assertion, not boilerplate: a Pass A row must still cool across persons.
const passA = (title: string) => ({ title, personId: null });
const SOMEONE = "11111111-1111-1111-1111-111111111111";

// Every headline below is REAL — taken from the 2026-08-05 and 2026-08-07 curator runs
// that motivated R-048. The point of the row is that these specific stories held the
// same top-20 slots day after day, so the fixtures are the evidence, not inventions.

test("a byte-identical re-serve is cooled — the actual starvation loop", () => {
  // This one occupied a slot on 8/03, 8/04, 8/05 and 8/07 and was refused every time.
  const title = "ED P . ROSKI JR . - Orange County Business Journal";
  assert.equal(isOnCooldown(title, SOMEONE, [passA(title)]), true);
});

test("the SAME article under a DIFFERENT person is cooled — why this keys on the event, not the url or the person", () => {
  // Live: attached to Jeff Bezos on 8/05 and to Sergey Brin on 8/07. A person-keyed or
  // url-keyed cooldown misses exactly the re-serve it exists to catch.
  const asBezos = "Bezos Is Third - Richest Again Reclaiming Spot From Google Sergei Brin";
  const asBrin = "Bezos Is Third-Richest Again, Reclaiming Spot From Google's Sergei Brin";
  assert.equal(isOnCooldown(asBrin, SOMEONE, [passA(asBezos)]), true);
});

test("an unrelated story is NOT cooled — the gate has a NO branch", () => {
  assert.equal(
    isOnCooldown("Pritzker signs school cellphone ban to avoid student distractions", SOMEONE, [
      passA("ED P . ROSKI JR . - Orange County Business Journal"),
      passA("15 % Of Israel Englander $240 Billion Millennium Portfolio Sits in Just 10 Stocks"),
    ]),
    false
  );
});

test("two different stories about the same person do not cool each other", () => {
  // Zuckerberg held two distinct slots on 8/07 — a P/E piece and a net-worth piece.
  // Cooling one must not sideline the other, or the cooldown becomes a per-person ban.
  const pe = "Meta Trades at a Forward P / E of 17 , Below Its 5 - Year Average , Making the Stock a Potential Bargain";
  const netWorth = "Zuckerberg Net Worth Drops 18 Billion : Meta AI Spending Shock";
  assert.equal(isOnCooldown(netWorth, SOMEONE, [passA(pe)]), false);
});

test("empty history cools nothing — fail-open on a fresh table", () => {
  // The table is empty until the first post-deploy run writes to it. If this returned
  // true, the very first run after shipping would deprioritize the entire pool.
  assert.equal(isOnCooldown("ED P . ROSKI JR . - Orange County Business Journal", SOMEONE, []), false);
});

// ---------------------------------------------------------------------------
// B-029 — sendTier(). The cooldown applied WITHIN the send window, not across it.
// The owner's ruling, 2026-08-11: "a cooled candidate still sorts below every fresh
// on-axis one but no longer loses its slot to a fresh score-0 candidate."
// Both halves of that sentence are pinned below, because a change that satisfies
// only one of them is the defect in the other direction.
// ---------------------------------------------------------------------------

test("B-029: a cooled ON-AXIS candidate now BEATS a fresh OFF-AXIS one — the whole fix", () => {
  // This is the pair that starved the feed: the on-axis supply was largely the
  // refused set, so under the old ordering every fresh score-0 story outranked it
  // and the 20-slot window filled with material Pass A would refuse anyway.
  assert.ok(sendTier("blind", 3) < sendTier("none", 0), "cooled on-axis must outrank fresh off-axis");
});

test("B-029: a cooled candidate still LOSES to every fresh on-axis one — the half that must not regress", () => {
  // R-048's revealed-preference argument is untouched: a story we already refused
  // is worth less than a fresh one we have never been asked about, ON THE SAME AXIS.
  assert.ok(sendTier("none", 1) < sendTier("blind", 9), "fresh on-axis must outrank cooled on-axis even at a much lower score");
});

test("B-029: off-axis is off-axis at zero AND below — a negative score is not a bonus", () => {
  // accountabilityScore() goes negative on NOISE_TERMS, so `score > 0` is the axis
  // test. A `!== 0` or truthiness test would promote penalised junk to on-axis.
  assert.equal(sendTier("none", 0), sendTier("none", -4), "score 0 and score -4 are both off-axis");
  assert.equal(sendTier("blind", 0), sendTier("blind", -4));
});

test("B-029: the four tiers are distinct and correctly ordered", () => {
  assert.deepEqual(
    [sendTier("none", 5), sendTier("blind", 5), sendTier("none", 0), sendTier("blind", 0)],
    [0, 1, 2, 3],
    "fresh-on-axis < cooled-on-axis < fresh-off-axis < cooled-off-axis"
  );
});

test("B-029: the fix does NOT resurrect a cooled off-axis candidate — it stays last", () => {
  // The failure mode of a too-generous fix: cooled junk climbing back into the window.
  assert.ok(sendTier("blind", 0) > sendTier("none", 0), "cooled off-axis must remain below fresh off-axis");
});

// ---------------------------------------------------------------------------
// B-052 AMENDMENT — the owner, 2026-09-22: "a story a checker refused for
// the same person sinks below off-topic stories for 14 days." Only the PERSON-SCOPED kind
// sinks; Pass A's person-blind rows keep the tiers the 08-11 ruling gave them.
// ---------------------------------------------------------------------------

test("B-052 amendment: a person-scoped refusal sinks below EVERY off-axis candidate", () => {
  // The whole ruling, in the two comparisons that carry it. An on-axis story a verifier
  // refused for THIS person now loses to fresh off-axis material — which is the thing the
  // 08-11 ruling deliberately prevented for Pass A's blind rows, so the two must not be
  // collapsed into one tier.
  assert.ok(sendTier("person", 9) > sendTier("none", 0), "a person-scoped refusal must sink below a fresh off-axis candidate");
  assert.ok(sendTier("person", 9) > sendTier("blind", 0), "...and below a blind-cooled off-axis one");
});

test("B-052 amendment: Pass A's person-blind cooldown is UNCHANGED by the ruling", () => {
  // The half that must not regress: the owner amended the ruling for verifier refusals only.
  assert.equal(sendTier("blind", 3), 1, "a blind-cooled on-axis candidate still sits at tier 1");
  assert.ok(sendTier("blind", 3) < sendTier("none", 0), "and still beats fresh off-axis material");
});

test("B-052 amendment: the five tiers are distinct and correctly ordered", () => {
  assert.deepEqual(
    [sendTier("none", 5), sendTier("blind", 5), sendTier("none", 0), sendTier("blind", 0), sendTier("person", 5)],
    [0, 1, 2, 3, 4],
    "fresh-on-axis < blind-cooled-on-axis < fresh-off-axis < blind-cooled-off-axis < person-scoped",
  );
  assert.equal(sendTier("person", 0), sendTier("person", 9), "a person-scoped refusal sinks regardless of its score");
});

test("B-052 amendment: when BOTH a blind and a person-scoped row match, person WINS", () => {
  // Reading "blind" here would restore the old tier for exactly the story the ruling is about.
  const t = "Two Richmond County graduates earn Earl Woods scholarships for college";
  const kind = cooldownKind(t, ADELSON, [{ title: t, personId: null }, { title: t, personId: ADELSON }]);
  assert.equal(kind, "person");
  assert.equal(sendTier(kind, 8), 4);
});

test("B-052 amendment: the Earl Woods recurrence — the case the ruling closes, with the run logs' own titles", () => {
  // The article title is BYTE-IDENTICAL across 09-21 (35600397944) and 09-22 (35728193024),
  // both printed by the `source article:` line. Refused for Tiger Woods on 09-21 -> sunk below
  // every off-axis candidate on 09-22 instead of being re-sent at on-axis rank.
  const article = "Two Richmond County Graduates Earn Earl Woods Scholarships for College";
  const kind = cooldownKind(article, TIGER, [{ title: article, personId: TIGER }]);
  assert.equal(kind, "person");
  assert.ok(sendTier(kind, 5) > sendTier("none", 0), "the refused story must now sink below a fresh off-axis candidate");
});

test("B-052 amendment: the KNOWN CEILING — a re-worded re-serve of the same event is NOT reached", () => {
  // The Musk counter-case the owner was shown cannot be replayed from the logs: the 09-20 run
  // predates the `source article:` line, so that pair's ARTICLE titles are not on record — the
  // inference-not-a-string-match gap this row already carries. What IS measurable says the
  // ruling does not reach a re-worded re-serve: the 09-21 published card against the 09-22
  // re-serve article scores 0.267, which the curator's own SAME-EVENT line printed too, and
  // the cooldown matches at 0.40. So a same-event story under a different headline still
  // arrives fresh. Under-reaching is the safe direction (it never suppresses a correctly
  // attributed story) — but it is a ceiling, not a guarantee, and this pins the number.
  const published = "Elon Musk joins call to slow artificial-intelligence development";
  const reserve = "Rivals Sam Altman and Elon Musk Rally Behind Dario Amodei Call for a Slowdown in AI Development";
  const score = jaccardScore(eventSignature(published), eventSignature(reserve));
  assert.ok(score < COOLDOWN_MATCH_THRESHOLD, `expected the measured 0.267 to sit below the ${COOLDOWN_MATCH_THRESHOLD} match threshold, got ${score.toFixed(3)}`);
  assert.equal(cooldownKind(reserve, MUSK, [{ title: published, personId: MUSK }]), "none", "a re-worded re-serve is not cooled — the ceiling, stated");
});

test("B-052 amendment: a person-scoped row for ANOTHER person leaves this candidate fresh", () => {
  const t = "Two Richmond County graduates earn Earl Woods scholarships for college";
  assert.equal(cooldownKind(t, BEZOS, [{ title: t, personId: ADELSON }]), "none");
  assert.equal(cooldownKind(t, BEZOS, [{ title: t, personId: null }]), "blind", "a Pass A row still cools the event for everyone");
});

// ---------------------------------------------------------------------------
// B-052 — a candidate a VERIFIER refused was recorded nowhere, so it returned at full
// rank the next time the source re-served it (the Earl Woods Scholarships article was
// refused ENTITY on 09-14 and again on 09-19, five days inside the 14-day window).
// Recording it is only SAFE because the row carries a person: three adversarial rounds
// rejected title-only scopes, each because one person's refusal would sink the story for
// everyone. Both directions are pinned below — a change satisfying one is the defect in
// the other.
// ---------------------------------------------------------------------------

const ADELSON = "22222222-2222-2222-2222-222222222222";
const BEZOS = "33333333-3333-3333-3333-333333333333";
const TIGER = "44444444-4444-4444-4444-444444444444";
const MUSK = "55555555-5555-5555-5555-555555555555";

test("B-052: a Pass B refusal cools the story for THAT person — the Earl Woods recurrence", () => {
  const t = "Earl Woods Scholarship Program names 2026 cohort";
  assert.equal(isOnCooldown(t, ADELSON, [{ title: t, personId: ADELSON }]), true);
});

test("B-052: a Pass B refusal does NOT cool the same story for a DIFFERENT person — why the three title-only scopes were rejected", () => {
  // Pass B ENTITY asks "is THIS billionaire the subject?", and candidates inherit their
  // person from a news fact, so the same article legitimately returns under another
  // person. A title-only row would sink the CORRECTLY attributed version for 14 days.
  const t = "MacKenzie Scott gives $2B to 300 organizations";
  assert.equal(isOnCooldown(t, BEZOS, [{ title: t, personId: ADELSON }]), false);
});

test("B-052: a Pass A row still cools across persons — the R-048 behaviour that must NOT regress", () => {
  // The person leg is additive. If a null personId stopped matching foreign persons, the
  // re-serve R-048 was built for (same article, different person row) would reopen.
  const t = "ED P . ROSKI JR . - Orange County Business Journal";
  assert.equal(isOnCooldown(t, BEZOS, [passA(t)]), true);
});

test("B-052: a Pass B row and a Pass A row in the same window each keep their own scope", () => {
  const scoped = "Adelson family foundation grant filing";
  const blind = "ED P . ROSKI JR . - Orange County Business Journal";
  const cooled = [{ title: scoped, personId: ADELSON }, passA(blind)];
  assert.equal(isOnCooldown(scoped, BEZOS, cooled), false, "the scoped row must not reach Bezos");
  assert.equal(isOnCooldown(blind, BEZOS, cooled), true, "the blind row must still reach Bezos");
});

// --- refusedCooldownRows: the index mapping ---------------------------------
// ⚠ EVERY fixture here REORDERS candidate_index. On 2026-09-19 six tests passed a mutant
// reading filtered[idx] instead of filtered[item.candidate_index] because every fixture
// was identity-mapped — so an identity fixture proves nothing about the mapping at all.

const cand = (title: string, personId: string) => ({ article: { title }, personId });

test("B-052: a refused card records ITS OWN candidate, not the one at its curated position", () => {
  const filtered = [cand("A — innocent", BEZOS), cand("B — innocent", BEZOS), cand("C — refused", ADELSON)];
  const curated = [{ candidate_index: 2 }, { candidate_index: 0 }];
  const rows = refusedCooldownRows(curated, filtered, [0]);
  assert.deepEqual(rows, [{ title: "C — refused", source: SOURCE_PASS_B, personId: ADELSON }]);
});

test("B-052: only the REFUSED cards are cooled — a kept card records nothing", () => {
  const filtered = [cand("kept", BEZOS), cand("refused", ADELSON)];
  const curated = [{ candidate_index: 1 }, { candidate_index: 0 }];
  const rows = refusedCooldownRows(curated, filtered, [0]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "refused");
});

test("B-052: an unresolvable candidate_index records NOTHING rather than a wrong story", () => {
  // The publish loop warns and skips on this; cooling the wrong article is worse than
  // cooling none, because nothing downstream ever revisits the row.
  const filtered = [cand("only", BEZOS)];
  assert.deepEqual(refusedCooldownRows([{ candidate_index: 7 }], filtered, [0]), []);
  assert.deepEqual(refusedCooldownRows([], filtered, [3]), []);
});

test("B-052: the stored title is capped at 300 chars, like the Pass A insert", () => {
  const long = "x".repeat(400);
  const rows = refusedCooldownRows([{ candidate_index: 0 }], [cand(long, BEZOS)], [0]);
  assert.equal(rows[0].title.length, 300);
});

// --- faithfulnessCooldownRows: Pass C drops, person-blind (R-048) ------------
// The title is the real one from the 2026-09-25..29 runs: rewritten by Pass A and dropped by
// Pass C on five consecutive days.
const ONE_BEAD = "One Bead awarded $150 , 000 Cummings Grant – Jamaica Plain Gazette";
const CUMMINGS = "33333333-3333-3333-3333-333333333333";

test("R-048: a Pass C drop writes a pass-c row with NO person — the article is cooled, not the person", () => {
  const filtered = [cand("innocent", BEZOS), cand(ONE_BEAD, CUMMINGS)];
  const curated = [{ candidate_index: 1 }, { candidate_index: 0 }]; // reordered on purpose
  const rows = faithfulnessCooldownRows(curated, filtered, [0]);
  assert.deepEqual(rows, [{ title: ONE_BEAD, source: SOURCE_PASS_C, personId: null }]);
});

test("R-048: a card Pass C kept writes nothing, and an unresolvable index writes nothing", () => {
  const filtered = [cand("kept", BEZOS), cand(ONE_BEAD, CUMMINGS)];
  assert.deepEqual(faithfulnessCooldownRows([{ candidate_index: 0 }, { candidate_index: 1 }], filtered, []), []);
  assert.deepEqual(faithfulnessCooldownRows([{ candidate_index: 9 }], filtered, [0]), []);
});

test("R-048: a Pass C-cooled ON-AXIS story sinks to tier 1, NOT tier 4 — a false drop costs order, not burial", () => {
  const score = accountabilityScore(ONE_BEAD);
  assert.ok(score > 0, `fixture precondition: the One Bead title must be on-axis, scored ${score}`);
  const rows = faithfulnessCooldownRows([{ candidate_index: 0 }], [cand(ONE_BEAD, CUMMINGS)], [0]);
  // Same person the drop was recorded under: still "blind", because the row carries no person.
  const kind = cooldownKind(ONE_BEAD, CUMMINGS, rows);
  assert.equal(kind, "blind");
  assert.equal(sendTier(kind, score), 1, "a Pass C row must sit at tier 1 for an on-axis story");
  assert.ok(sendTier(kind, score) < sendTier("none", 0), "...which still beats every fresh off-axis candidate");
  assert.ok(sendTier(kind, score) > sendTier("none", score), "...and loses to a fresh on-axis one — the change");
});

test("R-048: a Pass C row reaches the same article under a DIFFERENT person — the re-serve it exists for", () => {
  const rows = faithfulnessCooldownRows([{ candidate_index: 0 }], [cand(ONE_BEAD, CUMMINGS)], [0]);
  assert.equal(cooldownKind(ONE_BEAD, BEZOS, rows), "blind");
  assert.equal(cooldownKind("Bezos unveils new rocket engine test", BEZOS, rows), "none", "an unrelated story is not cooled");
});
