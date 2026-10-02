import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePartyBreakdown } from "@ba/shared";

/**
 * B-038's RENDER half, and the shape of what was DELIBERATELY NOT shipped with it.
 *
 * WHAT SHIPPED: the By Party bars state that they account for the whole total, and only when they
 * arithmetically do. A reader who adds the paragraph's party figures and lands short can see which
 * set of figures is complete.
 *
 * WHAT DID NOT: a render-time withhold of a paragraph whose party amounts do not reconcile. Three
 * adversarial rounds reproduced thirteen false withholds against it, the last fundamental — the
 * figures in prose carry no context, so a top recipient's amount cannot be told from a party
 * subtotal. These tests pin the CONSEQUENCE of that ruling: the political prose has exactly one
 * withhold reason (B-037), and the new line is arithmetic rather than an assertion.
 */

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("B-038 — the profile says which figures are complete", () => {
  test("the claim is COMPUTED from the rendered buckets, never asserted", () => {
    // The note may only render when the bars' own sum matches the stated total. An unconditional
    // sentence would be a claim about data nobody checked — on the page whose thesis is the receipt.
    assert.match(PAGE, /const partySum = parties\.reduce\(/);
    assert.match(PAGE, /Math\.abs\(partySum - data\.totalAmount\) < 0\.005/);
    assert.match(PAGE, /\{partiesReconcile && \(/, "the line must be gated on the reconciliation");
  });

  test("the claim is COMPLETENESS, not visual addition — the bars are abbreviated", () => {
    // Reproduced by the adversarial review on the stored Alec Gores fixture: the bars print $214K,
    // $213K, $156K and $518.75, so a sentence claiming they "add up to $584K" is false on screen
    // while true in the data. The exact total is spelled out through the shared formatter instead.
    const note = PAGE.slice(PAGE.indexOf("{partiesReconcile && ("), PAGE.indexOf("</p>", PAGE.indexOf("{partiesReconcile && (")));
    assert.ok(note.includes("proseAmount(data.totalAmount)"), "the exact total, not the abbreviated one");
    assert.ok(!note.includes("formatCurrency"), "an abbreviated figure must not carry this claim");
    assert.match(note, /rounded for display/i, "the rounding must be disclosed where the bars are read");
  });

  test("the reconciliation reads the SAME buckets the bars render", () => {
    // Summing the raw stored breakdown instead of the normalized buckets would be a second, looser
    // copy of the merge policy — the fork this repo keeps catching (B-030, accountabilityScore).
    const parties = PAGE.indexOf("const parties = normalizePartyBreakdown(");
    const sum = PAGE.indexOf("const partySum = parties.reduce(");
    assert.ok(parties > -1 && sum > parties, "partySum must be derived from the normalized buckets");
    assert.doesNotMatch(PAGE, /Object\.values\(data\.partyBreakdown\)[\s\S]{0,80}reduce/);
  });

  test("PROPERTY: the invariant the line depends on actually holds", () => {
    // normalizePartyBreakdown preserves the sum exactly — the property that makes the sentence true
    // rather than optimistic. Asserted here, through the function the page calls.
    const raw = { DEM: 214043.75, DFL: 518.75, REP: 155900, Unknown: 213400, UNK: 94.5, Dem: 10 };
    const sum = normalizePartyBreakdown(raw).reduce((s, b) => s + b.amount, 0);
    const expected = Object.values(raw).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - expected) < 0.005, "folding must not drop or invent money");
  });

  test("the political PROSE keeps exactly one withhold reason — B-037", () => {
    const call = PAGE.slice(PAGE.indexOf("withholdPolitical={"), PAGE.indexOf("/>", PAGE.indexOf("withholdPolitical={")));
    assert.ok(call.includes("isFecRecordImpossible("), "B-037's withhold must survive");
    assert.ok(
      !call.includes("politicalProseDropsBucket(") && !call.includes("readPartyProse("),
      "the B-038 prose withhold was ruled out on 2026-09-11 — see party-prose.ts; re-adding it needs the review re-run",
    );
  });

  test("the summary's political prose still has exactly one render path", () => {
    assert.match(PAGE, /content:\s*withholdPolitical\s*\?\s*undefined\s*:\s*data\.political/);
    assert.equal([...PAGE.matchAll(/data\.political\b/g)].length, 1);
  });
});

/**
 * R-077 — the WIRE-UP of the outdated-record caveat, not the helper (`isPoliticalProseOutdated` is
 * unit-tested in @ba/shared). These fail when the page stops CALLING it, or when the caveat becomes
 * a withhold: the 2026-09-13 adversarial review reproduced three ways a figure-matching version
 * removed CORRECT paragraphs, so this signal may date a paragraph and must never delete one.
 */
describe("R-077 — a summary older than its FEC record says so, and is still shown", () => {
  test("the page calls the SHARED predicate, on the two dates", () => {
    assert.match(
      PAGE,
      /import\s*\{[^}]*\bisPoliticalProseOutdated\b[^}]*\}\s*from\s*["']@ba\/shared["']/s,
      "a local date comparison would fork the rule the shared unit tests pin",
    );
    assert.match(
      PAGE,
      /const politicalOutdated = isPoliticalProseOutdated\(summaryWrittenAt, politicalRecordRefreshedAt\)/,
    );
    assert.match(
      PAGE,
      /const summaryWrittenAt = data\.sectionGeneratedAt\?\.political \?\? data\.generatedAt \?\? fact\.retrievedAt;/,
      "B-045 C2 KEEPS an older political paragraph while the row's generatedAt is today's; reading the row's date would silence this caveat on exactly the prose that needs it. An undated summary still falls back to its fact's retrievedAt rather than silently never firing.",
    );
    assert.match(PAGE, /politicalRecordRefreshedAt=\{politicalFact\?\.retrievedAt \?\? null\}/);
  });

  test("the caveat NEVER withholds — it renders beside the paragraph, which still renders", () => {
    assert.ok(
      !/content:[^\n]*politicalOutdated/.test(PAGE),
      "this signal must not reach the section's content gate — withholding on it was reviewed and rejected 2026-09-13",
    );
    const caveat = PAGE.slice(PAGE.indexOf('{key === "political" && politicalOutdated && ('));
    const body = caveat.slice(0, caveat.indexOf("</p>"));
    assert.ok(body.includes("We refreshed these FEC records on"), "the caveat must say what changed");
    assert.ok(
      body.includes("toLocaleDateString()") && body.includes("summaryWrittenAt"),
      "BOTH dates are rendered — 'out of date' without them is unfalsifiable by a reader",
    );
    assert.ok(
      caveat.indexOf('<p className="summary-text">') < caveat.indexOf("{data.generatedAt &&"),
      "the paragraph itself still renders after the caveat",
    );
  });
});

