import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatCurrency } from "@ba/shared";

/**
 * /today must never render a raw float where a dollar belongs.
 *
 * WHY THIS EXISTS. `formatCurrency` was correct the whole time — it lived in
 * `packages/web/src/lib/format.ts` and the profile called it. The daily-ten highlight builder
 * hand-copied its ladder INLINE and dropped the rounding on the last branch, so an FEC total
 * under $1,000 reached /today unformatted. Measured live 2026-08-26 on the served daily-ten:
 * 3 of 10 cards, worst case **"WINRED ($835.6400000000001)"** — while the profile rendered the
 * identical fact as "$835.64".
 *
 * So a test of the helper alone would have stayed GREEN through this entire defect. The
 * load-bearing assertion is the WIRE-UP: that this route calls the shared function rather than
 * re-inlining the ladder. Same wire-up-vs-helper distinction as
 * `daily-ten-commentary-wireup.test.ts`.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "persons.ts");
const src = readFileSync(ROUTE, "utf8");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("daily-ten formats political dollars via the shared ladder, not an inline copy", () => {
  const body = code(src);

  assert.ok(
    /import\s*\{[^}]*\bformatCurrency\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "persons.ts must import formatCurrency from @ba/shared",
  );

  assert.ok(
    /total:\s*formatCurrency\(total\)/.test(body),
    "political.total must go through formatCurrency",
  );

  assert.ok(
    /topRecipient:[^,]*formatCurrency\(top\.amount\)/.test(body),
    "political.topRecipient must go through formatCurrency — this is the field that shipped the raw float",
  );

  // The re-fork guard. The bug was not a wrong function, it was a SECOND copy of the ladder,
  // so pin the shape that copy had: a bare `${...amount}` interpolation with no formatter.
  assert.ok(
    !/\$\{\s*top\.amount\s*\}/.test(body),
    "top.amount must never be interpolated raw — that is the exact shape that shipped $835.6400000000001",
  );
  assert.ok(
    !/top\.amount\s*>=\s*1e6/.test(body),
    "the currency ladder must not be re-inlined here; call formatCurrency instead",
  );
});

test("the live-measured WINRED shape is actually handled", () => {
  // The real value carried by Ray Davis's FEC fact on 2026-08-26.
  const amount = 835.6400000000001;

  assert.equal(formatCurrency(amount), "$835.64");
  assert.ok(
    !/\d\.\d{3,}/.test(formatCurrency(amount)),
    "a formatted dollar must never carry a float tail",
  );

  // FEC amounts accumulate with += over float rows, so drift is expected in the DATA.
  // Containing it at the display layer is the whole point.
  assert.equal(formatCurrency(1765.2999999999997), "$2K");
  assert.equal(formatCurrency(6264.500000000001), "$6K");

  // Ladder boundaries still hold.
  assert.equal(formatCurrency(5_000_000), "$5.0M");
  assert.equal(formatCurrency(999), "$999");
});
