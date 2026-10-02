import { test } from "node:test";
import assert from "node:assert/strict";
import { hedgePenalty } from "./feed-punch";
import { isReportedClaim, reportedMarkerHit } from "./feed-hedge-marker";

/**
 * R-062 — RESOLVED 2026-08-24. The marker shipped; read how before editing anything here.
 *
 * On 2026-08-17 a visible "REPORTED" marker was built on `hedgePenalty(headline) > 0` and NOT
 * shipped, because measuring it against the 152 live cards showed it firing on 23 — roughly 7 of
 * them wrongly. This file pinned both halves of that measurement.
 *
 * THE FIX WAS NOT A BETTER HEDGE DETECTOR. It was a SECOND, narrower one: `isReportedClaim()`
 * (`feed-hedge-marker.ts`), an explicit second-hand-sourcing list. So the `hedgePenalty`
 * assertions below still pass and are still CORRECT — that function was never wrong, it was
 * wrong *for this job*. The earlier version of this comment predicted "any real fix must flip
 * them to false"; that prediction assumed the fix would live inside `hedgePenalty`, and it did
 * not. Left standing as a reminder that a rationale can be accurate, unchanged, and false about
 * a system that moved.
 *
 * The category error worth remembering: `hedgePenalty` is a RANKING input, and ranking can afford
 * to be loose — a false hedge costs a card some position. A visible label INVERTS the cost
 * asymmetry, because it publishes a claim about a named living person's card. Same reasoning the
 * two dedup thresholds already carry in CLAUDE.md.
 *
 * WHAT WOULD REOPEN THIS: a false positive from `isReportedClaim` on a live card. The bar was
 * ZERO on prod, not "better than before" — re-run `npm run preview:hedge-marker` and JUDGE the
 * printed headlines. The fix direction is then to REMOVE a term, never to add sentence parsing.
 */

const fires = (h: string) => hedgePenalty(h) > 0;

test("TRUE POSITIVES — genuinely unverified or not-yet-happened claims", () => {
  for (const h of [
    "Soros-funded group reportedly offers payments to student protesters",
    "Citadel Securities reportedly invests $400 million in Crypto.com",
    "Jeff Bezos reportedly explores purchase of a 30% stake in Liverpool FC",
    "Warren Buffett reportedly skips Gates Foundation donation during Epstein-related review",
    "Nelson Peltz’s Trian reportedly explores financing a private takeover of Wendy’s",
    "Glazer family considers selling its Manchester United stake",
    "Barry Diller may need a higher bid to close a deal for MGM Resorts",
  ]) {
    assert.equal(fires(h), true, `should fire: ${h}`);
  }
});

/**
 * MEASURED FALSE POSITIVES, all live cards on 2026-08-17. In every one the hedge word sits inside
 * an ATTRIBUTION ("warns", "says", "argues") or a NEGATION ("not expected to"), so the sentence is
 * a verified statement ABOUT someone's position — exactly the class a "Reported" badge must not
 * touch. They are asserted `true` because that is what hedgePenalty CORRECTLY does as a ranking
 * input — this is the record of why it could not be the label's basis, not an open defect. The
 * shipped marker's behaviour on these exact headlines is the `isReportedClaim` test far below.
 */
test("FALSE POSITIVES for a LABEL — attributed or negated hedges, which hedgePenalty cannot distinguish", () => {
  for (const h of [
    "Ray Dalio warns that a U.S. wealth tax could carry broader economic risks",
    "Bill Ackman argues New York City pied-à-terre tax could lower property values",
    "John Morgan says children who reject prenups would receive limited annual inheritance",
    "Warren Buffett says Bill Gates knew his foundation would receive no further Buffett donations",
    "Mark Walter’s Lakers sale is not expected to change Dodgers operations",
    "Trump EPA methane rollback could benefit billionaire Jeffery Hildebrand",
    "Jeff Bezos backs a $41 billion AI bet and says he could not sit on the sidelines",
  ]) {
    assert.equal(fires(h), true, `currently fires (this is the DEFECT, not the spec): ${h}`);
  }
});

test("CORRECTLY SILENT — concrete sourced receipts, which is why the ranking use is fine", () => {
  for (const h of [
    "Mark Zuckerberg sold $428M in Meta stock (SEC Form 4, Mar 8)",
    "Ronald Lauder’s political giving exceeds $70 million, including support for Trump",
    "Sergey Brin spends more than $100 million opposing California’s proposed billionaire tax",
    "Melinda French Gates says her $600 million donation is meant to draw more ultrawealthy donors to the cause",
  ]) {
    assert.equal(fires(h), false, `should stay silent: ${h}`);
  }
});

// A filed lawsuit is a documented event and the filing IS the receipt. "alleges" is deliberately
// absent from HEDGE_TERMS; pinned so nobody adds it and labels the most defensible card class.
test("a filed-lawsuit headline stays silent — the filing is the receipt", () => {
  assert.equal(fires("Paramount investor sues Ellison family over alleged Trump-CNN side deal"), false);
});

// ---------------------------------------------------------------------------
// isReportedClaim — the detector that actually ships the visible marker (R-062).
// ---------------------------------------------------------------------------

/**
 * THE LOAD-BEARING TEST. Every headline here is a MEASURED live false positive of the rejected
 * hedgePenalty basis — attributed or negated statements that are verified facts about someone's
 * position. A "Reported" badge on any of them is a false claim about OUR OWN sourcing, on a named
 * living person's card. If this test goes red, the marker must come off the card, not be tuned.
 */
test("isReportedClaim is SILENT on every measured false positive of the rejected basis", () => {
  for (const h of [
    "Ray Dalio warns that a U.S. wealth tax could carry broader economic risks",
    "Bill Ackman argues New York City pied-à-terre tax could lower property values",
    "John Morgan says children who reject prenups would receive limited annual inheritance",
    "Warren Buffett says Bill Gates knew his foundation would receive no further Buffett donations",
    "Mark Walter’s Lakers sale is not expected to change Dodgers operations",
    "Trump EPA methane rollback could benefit billionaire Jeffery Hildebrand",
    "Jeff Bezos backs a $41 billion AI bet and says he could not sit on the sidelines",
    // Further live cards the wide basis marked and the narrow one must not (2026-08-24 run).
    "Glazer family considers selling its Manchester United stake",
    "Barry Diller may need a higher bid to close a deal for MGM Resorts",
    "Michael Saylor’s company plans to match government-funded Trump accounts for children",
    "Jeffrey Lurie family considers expanding its autism philanthropy",
    "Arthur Blank Foundation president Fay Twersky plans to retire",
    "Federal $696 million rail grant could advance Justin Ishbia’s South Loop development",
  ]) {
    assert.equal(isReportedClaim(h), false, `must NOT be labelled Reported: ${h}`);
  }
});

test("isReportedClaim fires on second-hand sourcing — live cards, verbatim", () => {
  for (const h of [
    "Soros-funded group reportedly offers payments to student protesters",
    "Citadel Securities reportedly invests $400 million in Crypto.com",
    "Jeff Bezos reportedly explores purchase of a 30% stake in Liverpool FC",
    "Warren Buffett reportedly skips Gates Foundation donation during Epstein-related review",
    "Nelson Peltz’s Trian reportedly explores financing a private takeover of Wendy’s",
    "DOJ reportedly examines Andreessen Horowitz over board-director practices",
    "Michael Dell reportedly gives $750 million to the University of Texas",
  ]) {
    assert.equal(isReportedClaim(h), true, `should be labelled Reported: ${h}`);
  }
});

/**
 * The property that makes the explicit list immune to the attribution/negation class: these terms
 * mark the REPORTER's sourcing, so they survive being attributed. An attributed "could" is a fact
 * about a position; an attributed "reportedly" is still unverified.
 */
test("an attribution does not rescue a second-hand claim — the asymmetry the list relies on", () => {
  assert.equal(isReportedClaim("Ray Dalio says a wealth tax could carry risks"), false);
  assert.equal(isReportedClaim("Ray Dalio says the fund reportedly lost $2 billion"), true);
});

test("a filed-lawsuit headline stays silent under the marker too — the filing is the receipt", () => {
  assert.equal(isReportedClaim("Paramount investor sues Ellison family over alleged Trump-CNN side deal"), false);
  // "alleges"/"alleged" must never enter the list; pinned so nobody labels the most defensible class.
  assert.equal(isReportedClaim("SEC alleges accounting fraud at the firm"), false);
});

test("the marker degrades safely rather than throwing on absent input", () => {
  assert.equal(isReportedClaim(null), false);
  assert.equal(isReportedClaim(undefined), false);
  assert.equal(isReportedClaim(""), false);
});

test("reportedMarkerHit names WHICH term fired, so a match is reviewable without decoding a regex", () => {
  assert.equal(reportedMarkerHit("Citadel reportedly invests $400 million"), "reportedly");
  assert.equal(reportedMarkerHit("Ray Dalio warns a wealth tax could carry risks"), null);
});

/**
 * The adjectival + leading forms (added 2026-08-24). Every headline below is verbatim from the live
 * feed on that date; all 8 were silent under the adverb-only list and all 8 are true positives.
 */
test("isReportedClaim fires on the ADJECTIVAL and LEADING report forms — live cards, verbatim", () => {
  for (const h of [
    "Peter Thiel takes reported $76 million stake in Argentine oil producer Vista Energy",
    "Carl Icahn’s reported $34-a-share Caesars offer followed a year of talks",
    "Sam Altman heads to the White House after reported AI security incident",
    "Report revisits Bill Gates’s Energy Department security clearance under Obama",
    "Democrats seek investigation into FIFA talks and a reported Kushner business deal",
    "Elon Musk pursues reported $4 billion funding round after major decline in paper wealth",
    "Report examines George Soros-funded journalism course’s treatment of jihad",
    "Reid Hoffman responds to reported DOJ probe into nonprofit he funds",
  ]) {
    assert.equal(isReportedClaim(h), true, `should be labelled Reported: ${h}`);
  }
});

/**
 * THE TWO SHAPES THAT MUST STAY SILENT. These are the boundary of the list, and both are live
 * headlines — this is the test that fails first if anyone widens the pattern to a bare "report".
 */
test("a report as a DOCUMENT, and NAMED attribution, both stay silent", () => {
  // 1. The foundation published a thing. Nothing about it is unverified.
  assert.equal(
    isReportedClaim("Samueli Foundation releases a report aimed at helping donors make giving decisions"),
    false,
  );
  // 2. A named publication standing behind a claim IS this site's normal sourcing. Labelling it
  //    "Reported" would tell the reader to trust our BEST citations less.
  assert.equal(
    isReportedClaim("Diane Hendricks gave $25 million to MAGA Inc., Urban Milwaukee reports"),
    false,
  );
  // Named attribution stays silent even in the summary-shaped form that motivated the same rule.
  assert.equal(isReportedClaim("Fortune reports that Sergey Brin has spent more than $100 million"), false);
});

test("the adverb and the adjective are independent, not overlapping", () => {
  // \breported\b must not match "reportedly" — there is no word boundary before the "ly".
  assert.equal(/\breported\b/i.test("Soros-funded group reportedly offers payments"), false);
  assert.equal(isReportedClaim("Soros-funded group reportedly offers payments"), true);
});
