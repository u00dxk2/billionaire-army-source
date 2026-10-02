import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * B-055: /daily-ten must build its pool through dailyTenPool(), which excludes deceased persons.
 * The behaviour is tested in daily-ten-pool.test.ts; this pins that the ROUTE uses it — the route
 * used to build the pool inline and never read death_year, so the fix is only real at this call site.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "persons.ts");
const src = readFileSync(ROUTE, "utf8");

/** Strip comments so prose about the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function dailyTenHandler(): string {
  const body = code(src);
  const start = body.indexOf('app.get("/daily-ten"');
  assert.ok(start !== -1, "persons.ts must still register /daily-ten");
  const next = body.indexOf("app.get(", start + 1);
  return body.slice(start, next === -1 ? undefined : next);
}

test("/daily-ten builds its pool with dailyTenPool and selects deathYear for it", () => {
  const h = dailyTenHandler();
  assert.match(code(src), /import\s*\{[^}]*\bdailyTenPool\b[^}]*\}\s*from\s*["']\.\.\/daily-ten-pool\.js["']/);
  assert.match(h, /dailyOrder\(\s*dailyTenPool\(/, "the shuffled ids must be the dailyTenPool output");
  assert.match(h, /deathYear:\s*persons\.deathYear/, "the candidate rows must carry deathYear");
});

test("/daily-ten has no second, unfiltered pool path (the old < 10 fallback)", () => {
  // The old fallback read `ids = allIds`, but a new one need not look like that — an adversarial
  // review showed `dailyIds.push(...dailyOrder(candidates.map(...)))` appended after the filtered
  // pick passed a name-based check. So pin the SHAPE instead: the candidate rows are read exactly
  // once (into dailyTenPool) and the ordering runs exactly once.
  const h = dailyTenHandler();
  assert.doesNotMatch(h, /ids\s*=\s*allIds/, "a fallback to the raw index re-admits the deceased");
  assert.equal([...h.matchAll(/\bcandidates\b/g)].length, 2, "candidates: declared once, passed to dailyTenPool once, read nowhere else");
  assert.equal([...h.matchAll(/\bdailyOrder\(/g)].length, 1, "one ordering, over dailyTenPool's output only");
  assert.doesNotMatch(h, /dailyIds\.(push|unshift|splice|concat)\(/, "nothing may top up the ten after the filtered pick");
});
