import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The served political chip is REBUILT from the live fact, not read from frozen contextData.
 *
 * The curator froze "$X in political donations" at publish time using an inline copy of the
 * shared currency ladder whose sub-$1K branch dropped its rounding. Fixing the curator only
 * reaches cards published AFTER the fix; every already-published card keeps the raw float —
 * measured 2026-09-03 on the served 40, six cards for MacKenzie Scott reading
 * "$711.5900000000003 in political donations", one PROMOTED at position 1.
 *
 * So the repair has to happen here too, exactly as B-030's foundation chip and the live PBS
 * override already do: rebuild at display time, no prod data write, every old card fixed at once.
 *
 * ORDER IS LOAD-BEARING and is the reason this is a wire-up test rather than a helper test: the
 * B-037 withhold spread must stay AFTER the rebuild, or a rebuilt chip would resurrect a figure
 * whose attribution we withdrew. That is a property of the call site only.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "feed.ts");
const src = readFileSync(ROUTE, "utf8");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("feed.ts rebuilds the political chip through the shared ladder", () => {
  const body = code(src);

  assert.ok(
    /import\s*\{[^}]*\bformatCurrency\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "feed.ts must import formatCurrency from @ba/shared",
  );

  assert.ok(
    /formatCurrency\(total\)\}\s*in political donations/.test(body),
    "the rebuilt chip must go through formatCurrency",
  );

  assert.ok(
    /politicalChips/.test(body),
    "loadGivingRatios must expose the rebuilt political chips to the routes",
  );
});

test("the summary's political total is restated at the live chip's figure, on BOTH routes (2026-09-27)", () => {
  // 16 of the served 204 read a stale total in prose beside a live chip (MacKenzie Scott, promoted
  // #1: "$711.59" beside "$1K"). The repair must be anchored on the FROZEN chip — `ctx.political`,
  // read before the override — and must run INSIDE the B-037 withhold, which removes the paragraph.
  const body = code(src);
  assert.ok(
    /import\s*\{[^}]*\brepairPoliticalProse\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "feed.ts must import repairPoliticalProse from @ba/shared",
  );
  const calls = [...body.matchAll(/repairPoliticalProse\(/g)];
  assert.equal(calls.length, 2, "both the list and detail routes must repair the summary");
  for (const m of calls) {
    const tail = body.slice(m.index!, m.index! + 600);
    assert.match(tail, /ctx\.political,/, "the anchor must be the FROZEN chip, never the rebuilt one");
    const head = body.slice(Math.max(0, m.index! - 400), m.index!);
    assert.match(head, /withholdPoliticalProse/, "the withhold must stay outermost");
  }
  assert.match(body, /politicalTotals\.set\(pid, total\)/, "the live total must be the chip's own `total`");
});

test("the B-037 withhold still wins over the rebuilt chip, on BOTH routes", () => {
  const body = code(src);

  // List route and detail route each assemble contextData; in both, the `political: null`
  // withhold must appear AFTER the rebuild that could otherwise resurrect the figure.
  const rebuilds = [...body.matchAll(/political:\s*politicalChips\.get|political:\s*politicalChip\b/g)];
  assert.equal(rebuilds.length, 2, "both the list and detail routes must rebuild the chip");

  for (const m of rebuilds) {
    const after = body.slice(m.index!);
    const withholdAt = after.search(/political:\s*null/);
    assert.ok(
      withholdAt !== -1,
      "each rebuild must be followed by the B-037 withhold, or a withdrawn figure comes back",
    );
  }
});
