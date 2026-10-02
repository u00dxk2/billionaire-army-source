import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * B-037's DISPLAY leg is wired, and it is gated on the FLAG rather than on an empty summary.
 *
 * The chip strip (2026-09-02) and the prose strip (2026-09-10) together make a withheld card
 * honest and MUTE: `withholdPoliticalProse` returns "" rather than editing the sentence, so the
 * card rendered a headline over a blank <p> and told the reader nothing. The profile explains the
 * same withhold in full. This leg says the short version on the card.
 *
 * THE GATE IS THE PROPERTY UNDER TEST. Measured on the served feed 2026-09-12: 194 cards, 3 with
 * an empty summary, and only ONE of those is withheld — the other two are old cards the curator
 * wrote with no prose. So `!item.summary` alone would print "we're withholding a political figure"
 * on cards nothing was withheld from, which is a false statement about our own data and exactly
 * the class B-037 exists to prevent.
 *
 * Sabotage that must turn this red: swap the condition to `!item.summary`, drop the
 * `politicalWithheld` field from either route in feed.ts, or delete the notice branch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CARD = join(here, "FeedCard.tsx");
const ROUTE = join(here, "..", "..", "..", "api", "src", "routes", "feed.ts");
const TYPES = join(here, "..", "lib", "feed-types.ts");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the card renders a withhold notice, gated on the flag and never on an empty summary", () => {
  const body = code(readFileSync(CARD, "utf8"));

  assert.ok(
    /item\.politicalWithheld/.test(body),
    "FeedCard must branch on item.politicalWithheld",
  );
  assert.ok(
    /feed-card-summary--withheld/.test(body),
    "the notice must carry its own class so it cannot be styled as a sourced sentence",
  );

  // The notice branch must be reached through the FLAG. A branch keyed only on the empty string
  // would caption the two non-withheld empty-summary cards with a withhold that never happened.
  const notice = body.indexOf("feed-card-summary--withheld");
  const gate = body.lastIndexOf("item.politicalWithheld", notice);
  assert.ok(gate !== -1, "the notice must be guarded by item.politicalWithheld, not by !item.summary");
  const between = body.slice(gate, notice);
  assert.ok(
    !/!\s*item\.summary\s*(\?|&&)/.test(between),
    "the notice must not be gated on the empty summary alone",
  );

  // POLARITY, not just presence. The adversarial review (2026-09-12) mutated the condition to
  // `!item.politicalWithheld` and every assertion above still passed — the token was still there.
  // An inverted gate captions every card EXCEPT the withheld one, which is the original defect
  // pointed the other way. Presence is not the property; the branch being taken WHEN withheld is.
  assert.ok(
    /:\s*item\.politicalWithheld\s*\?/.test(body),
    "the notice branch must be reached ON the flag being true (`: item.politicalWithheld ?`)",
  );
  assert.ok(
    !/!\s*item\.politicalWithheld/.test(body),
    "the gate must not be negated — an inverted flag captions the cards nothing was withheld from",
  );
});

test("the notice says why, and points at the record rather than dead-ending", () => {
  const src = readFileSync(CARD, "utf8");
  // Taking responsibility for OUR matching is the wording the profile's notice established and
  // Cycle 16 named as the page at its best — never blaming the FEC, whose records are unchanged.
  assert.ok(/by name only/.test(src), "the notice must name the matching as the reason");
  assert.ok(/profile/.test(src), "the notice must point the reader at the fuller note");
});

test("BOTH served routes expose politicalWithheld from the SAME decision, never re-derived", () => {
  const body = code(readFileSync(ROUTE, "utf8"));

  assert.ok(
    /politicalWithheld:\s*primaryId\s*!=\s*null\s*&&\s*withheldPolitical\.has\(primaryId\)/.test(body),
    "the list route must expose politicalWithheld from withheldPolitical.has(primaryId)",
  );
  // The detail route already holds the decision in a local of the same name, so exposing it is a
  // bare shorthand — assert it is RETURNED, not merely computed.
  const detailReturn = body.slice(body.indexOf("givingRatio: ratio"));
  assert.ok(
    /politicalWithheld,/.test(body.slice(Math.max(0, body.indexOf("givingRatio: ratio") - 400))) ||
      /politicalWithheld,/.test(detailReturn),
    "the detail route must return politicalWithheld",
  );

  assert.ok(
    !/isFecRecordImpossible\(/.test(body.slice(body.indexOf("politicalWithheld:"))),
    "the flag must not re-derive the withhold predicate at the return site",
  );

  // THE PRIMARY PERSON, NOT ANY TAGGED PERSON. The adversarial review mutated the detail route to
  // accept any withheld person on a multi-person card and this file still passed. That mutation
  // publishes a caveat about person B on a card whose figures belong to person A — the same
  // wrong-person class the one-tagged-person guard on the score repair exists for.
  assert.ok(
    /politicalWithheld\s*=\s*personIds\[0\]\s*!=\s*null\s*&&\s*withheldPolitical\.has\(personIds\[0\]\)/.test(body),
    "the detail route must decide on personIds[0] alone, never over all tagged persons",
  );
  assert.ok(
    !/withheldPolitical\.has\(\s*(p|id|person)\b/.test(body) &&
      !/personIds\.some\([^)]*withheldPolitical/.test(body),
    "the withhold decision must not be taken over a set of tagged persons",
  );
});

test("the client type carries the flag as OPTIONAL — an absent flag is not a withhold", () => {
  const body = code(readFileSync(TYPES, "utf8"));
  assert.ok(
    /politicalWithheld\?:\s*boolean/.test(body),
    "FeedItem.politicalWithheld must be optional, so a cached response without it reads as 'nothing withheld'",
  );
});
