import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * B-065 (2026-09-29). Both served feed routes label a net worth we cannot date — or one over a year
 * old — on the chip, in the prose, and withhold the giving ratio that would divide by it.
 *
 * The predicate is unit-tested in `@ba/shared/net-worth-age.test.ts`; what can only fail HERE is the
 * wire-up (KP-93): a route that still divides with the plain `givingRatio`, a deep-link route that
 * forgot the chip, or a prose label computed and dropped. `/feed/:id` is what a SHARE lands on.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "feed.ts");
const src = readFileSync(ROUTE, "utf8");

function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the ratio divides only through currentGivingRatio — the plain givingRatio is not called", () => {
  const body = code(src);
  assert.ok(/currentGivingRatio\s*\(\s*netWorthFacts\.get\(/.test(body), "ratio must pass the net-worth FACT (with its age)");
  assert.ok(!/(?<![A-Za-z])givingRatio\s*\(/.test(body), "a bare givingRatio( call divides by an undated figure");
});

test("the net-worth rows carry sourceType AND retrievedAt into the age decision", () => {
  const body = code(src);
  assert.ok(/sourceType:\s*personFacts\.sourceType/.test(body));
  assert.ok(/retrievedAt:\s*personFacts\.retrievedAt/.test(body));
  assert.ok(/if \(r\.factKey === "net_worth"\) netWorthFacts\.set\(r\.personId, r\)/.test(body));
});

test("BOTH routes build the chip from cardNetWorthDisplay and serve it", () => {
  const body = code(src);
  assert.equal([...body.matchAll(/cardNetWorthDisplay\s*\(/g)].length, 2, "list and /:id");
  assert.equal([...body.matchAll(/netWorth:\s*nw\.netWorth/g)].length, 2, "contextData.netWorth on both");
  assert.equal([...body.matchAll(/netWorthAsOf:\s*nw\.netWorthAsOf/g)].length, 2, "the label on both");
  assert.equal([...body.matchAll(/gradeUsesStaleNetWorth:\s*nw\.gradeUsesStaleNetWorth/g)].length, 2);
});

test("BOTH routes read the score FEATURES the grade note needs", () => {
  const body = code(src);
  assert.equal([...body.matchAll(/features:\s*scoreSnapshots\.features/g)].length, 2);
});

test("the served prose is NOT relabelled — no inline net-worth matcher on either route (removed after 3 review rounds)", () => {
  const body = code(src);
  assert.ok(!/annotateNetWorthProse/.test(body), "the inline matcher labelled the wrong money three rounds running");
});

test("the served giving ratio is never DEFAULTED — absent, never zero (Codex r3-1 undetected mutant)", () => {
  const body = code(src);
  const served = [...body.matchAll(/givingRatio:\s*([^\n]+)/g)].map((m) => m[1]);
  assert.equal(served.length, 2, "list and /:id each serve one givingRatio");
  for (const expr of served) assert.ok(!/\?\?|\|\|/.test(expr), `no fallback on the served ratio: ${expr}`);
});

test("BOTH routes serve the earlier text figure, so a card whose chip moved still states it (Codex r3-2 #1)", () => {
  const body = code(src);
  assert.equal([...body.matchAll(/netWorthTextFigure:\s*nw\.textFigure/g)].length, 2);
});
