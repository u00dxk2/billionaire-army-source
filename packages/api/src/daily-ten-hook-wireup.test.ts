import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The WIRE-UP, not the helper.
 *
 * `politicalDominatesGiving` has its own unit tests in `@ba/shared`, and they would have stayed
 * green through every version of this defect — because the helper was never the thing that broke.
 * This lane has now paid for that distinction three times (the og:image coupling, the B-037
 * withhold, R-041's prose): the rule was written down and correct, and a CALL SITE did not read it.
 *
 * So this asserts the source of the daily-ten route directly. It is a shape test and it says so —
 * it cannot prove the branch produces the right sentence, only that the decision is still delegated
 * to the one calibration and still guarded on the things that make the sentence honest.
 */

const ROUTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "routes", "persons.ts"),
  "utf8",
);

test("the receipt hook asks @ba/shared, and does not re-inline the ratio", () => {
  assert.match(ROUTE, /politicalDominatesGiving\(givingRaw, politicalRaw\)/);
  assert.match(ROUTE, /import \{[^}]*politicalDominatesGiving[^}]*\} from "@ba\/shared"/);
  // A hand-rolled `politicalRaw >= givingRaw * 10` anywhere in this route is the fork this exists
  // to stop — the same shape as the currency ladder that was re-inlined three times.
  assert.doesNotMatch(ROUTE, /politicalRaw\s*[><]=?\s*givingRaw\s*\*/);
  assert.doesNotMatch(ROUTE, /POLITICAL_DOMINANCE_RATIO\s*=/);
});

test("the contrast branch cannot fire without a rendered political figure", () => {
  // `h.political` carries the FORMATTED total the sentence prints. Without the `&& h.political`
  // guard the branch can be reached with `h.political` null and print "undefined to federal
  // politics" — and, worse, it is exactly the shape a B-037-withheld person takes on this route.
  assert.match(ROUTE, /politicalDominatesGiving\(givingRaw, politicalRaw\) && h\.political/);
});

test("the contrast states the political figure through the SHARED formatter, never a raw number", () => {
  // `h.political.total` is `formatCurrency(total)`. Interpolating `politicalRaw` instead would put
  // a raw float on the card — the defect this repo shipped three times in eight days.
  assert.match(ROUTE, /\$\{h\.political\.total\} to federal politics/);
  assert.doesNotMatch(ROUTE, /\$\{politicalRaw\} to federal politics/);
});

test("the B-037 withhold still runs BEFORE politicalRaw is set — order is the safety property", () => {
  // A withheld record must leave politicalRaw at 0 so it can never become a contrast line. That is
  // a property of the ORDER of these two statements, and no helper test can hold it.
  const withhold = ROUTE.indexOf("isFecRecordImpossible(String(val.dateRange");
  const assign = ROUTE.indexOf("politicalRaw = total;");
  assert.ok(withhold > -1 && assign > -1, "both statements must still be present");
  assert.ok(withhold < assign, "the withhold guard must precede the politicalRaw assignment");
});

test("the route DELEGATES philanthropy fact dispatch, and does not re-derive it", () => {
  // The 88-person clobber lived in a factType branch here. It is now one order-independent read in
  // @ba/shared, tested behaviourally over every permutation — a source-shape test cannot hold it.
  assert.match(ROUTE, /readPhilanthropyFacts\(facts, foundationTotals\)/);
  assert.match(ROUTE, /import \{[^}]*readPhilanthropyFacts[^}]*\} from "@ba\/shared"/);
  // A second copy of the dispatch in this route is the fork this exists to stop.
  assert.doesNotMatch(ROUTE, /f\.factKey === "total_giving"/);
  assert.doesNotMatch(ROUTE, /f\.factType === "philanthropy" && typeof val/);
});

test("the direct-giving hook states the CUMULATIVE figure, never the annualised one", () => {
  // `annualGiving` is ANNUALIZED from a lifetime total (CLAUDE.md), so rendering it as a period
  // figure is a false claim about a real person. The card says "$7.0B since 2015".
  assert.match(ROUTE, /Gave \$\{fmtMoney\(directGiving\.amount\)\} \$\{directGiving\.period\}, per \$\{directGiving\.source\}\./);
  // Scoped to a READ of the field, not to the word: the ban fired on this file's own explanatory
  // comment the first time (2026-09-14, and the second such miss in one session).
  assert.doesNotMatch(ROUTE, /val\.annualGiving|\.annualGiving\b\s*\)/);
});

test("a receipt OUTRANKS a promise: direct giving sits above the Giving Pledge tier", () => {
  // Zuckerberg and Omidyar both signed the pledge and have no name-matched foundation, so before
  // this tier their cards led with the promise while a sourced figure sat unused.
  const direct = ROUTE.indexOf("} else if (directGiving) {");
  const pledge = ROUTE.indexOf("} else if (h.givingPledge) {");
  assert.ok(direct > -1 && pledge > -1, "both ladder tiers must still be present");
  assert.ok(direct < pledge, "direct giving must be evaluated BEFORE the pledge");
});

test("a 990 grant line loses the lead ONLY through the shared calibration, and only when curated giving exists", () => {
  // Buffett's card led with "Gave $2K through …" against $60B since 2006 (prod, 2026-09-21).
  assert.match(ROUTE, /import \{[^}]*directGivingDominatesGrants[^}]*\} from "@ba\/shared"/);
  assert.match(ROUTE, /const curatedLeads = directGiving !== null && directGivingDominatesGrants\(givingRaw, directGiving\.annual\);/);
  // The 990 tier is gated on it — without `!curatedLeads` the predicate is computed and ignored.
  assert.match(ROUTE, /if \(givingRaw > 0 && !curatedLeads\) \{/);
  // No second copy of the ratio in the route.
  assert.doesNotMatch(ROUTE, /DIRECT_GIVING_DOMINANCE_RATIO\s*=/);
  assert.doesNotMatch(ROUTE, /\.annual\s*[><]=?\s*givingRaw/);
});

test("a receipt outranks parked assets: the curated tier sits ABOVE the assets tier", () => {
  // Before 2026-09-21 no card could reach the curated tier while holding 990 rows, so this order was
  // untested. Buffett, Soros and any future promotion carry foundation ASSETS: with the tiers swapped
  // they would lead with "Holds $X across N foundations" instead of what they gave.
  const direct = ROUTE.indexOf("} else if (directGiving) {");
  const assets = ROUTE.indexOf("} else if (assetsRaw > 0) {");
  assert.ok(direct > -1 && assets > -1, "both ladder tiers must still be present");
  assert.ok(direct < assets, "direct giving must be evaluated BEFORE parked assets");
});

test("the annualized comparison figure is never RENDERED", () => {
  // It is a lifetime total spread evenly, so printing it would state a rate nobody reported.
  assert.doesNotMatch(ROUTE, /\$\{[^}]*\.annual\b[^}]*\}/);
});

test("the direct-giving hook is ABSENT, never partial", () => {
  // Validation lives WITH the dispatch in @ba/shared and is tested behaviourally there (a boolean
  // amount, "Infinity", 0.0001 and a non-period label are each pinned). The route must not invent a
  // looser acceptance of its own — it takes the validated value or nothing.
  assert.match(ROUTE, /const directGiving = phil\.directGiving;/);
  assert.doesNotMatch(ROUTE, /cumulativeGiving/);
});
