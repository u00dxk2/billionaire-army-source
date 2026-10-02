import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

/**
 * ONE currency ladder, enforced by SHAPE across every package.
 *
 * WHY A THIRD GUARD, when two already exist. `2c2db8f` (08-26) fixed the daily-ten fork and
 * pinned it with `!/top\.amount\s*>=\s*1e6/` — a guard keyed to the IDENTIFIER that happened to
 * carry the bug. Seventy lines above it, in the same file, `fmtMoney` held an inline ladder over
 * a variable called `n`, and sailed through untouched for eight days. `e8e4f1e` (09-03) then fixed
 * two more copies and pinned them with regexes keyed to `total` — the same mistake, made the same
 * day it was named.
 *
 * That is this repo's own standing lesson: **a guard keyed to an identifier is blind to a consumer
 * that RE-DERIVES the value — grep the OPERATION's shapes, not the name.** So this test matches the
 * operation: a template literal interpolating a division by a magnitude constant, whatever the
 * variable is called. It is the guard that stops a FOURTH copy being written.
 *
 * It does NOT try to convert the known forks — those write STORED display strings ("~$4.4B" carries
 * a semantic tilde; the M branch rounds differently), so changing them rewrites data across the
 * index and needs its own dated decision. They are listed below as known debt with a reason each.
 * The point of the allowlist is that adding a NEW ladder requires editing this file and writing
 * down why, which is the whole mechanism.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, "..", "..");

/**
 * The OPERATION: `${(<anything> / 1e6)` inside a template literal preceded by a `$`.
 * Deliberately identifier-agnostic — `n`, `total`, `top.amount` and `netWorthNum` all match.
 */
const LADDER_SHAPE = /\$\$\{\s*\([^)]*\/\s*1e[369]\s*\)/;

/**
 * Known ladders, each with the reason it is not a fork. A new entry here is a DECISION, and
 * writing the reason is the cost that makes it one.
 */
const ALLOWED = new Map<string, string>([
  ["shared/src/format-currency.ts", "THE ladder. Every other display path routes here."],
  [
    "shared/src/foundation-endowment.ts",
    "Deliberate sibling: the foundation chip carries its own suffix text and a coarser M branch, and has its own tests. Not a fork — a second canonical function.",
  ],
  [
    "shared/src/political-prose.ts",
    "Deliberate sibling, like foundation-endowment: it re-writes a PROSE figure in the author's own unit ('$4.8 million', not '$4.8M'). Every branch rounds as formatCurrency does or finer, and its tests read each result back through formatCurrency against the chip.",
  ],
  [
    "api/src/routes/persons.ts",
    "KNOWN DEBT (see the fmtMoney comment): coarser than formatCurrency above $1M on purpose for /today chips. Its sub-$1K band now falls through to the shared ladder, which is where the $0K false zero was.",
  ],
  [
    "jobs/src/fetchers/fec.ts",
    "KNOWN DEBT: writes a STORED display string. Converting rewrites data across the index — needs its own dated decision, not a same-day sweep.",
  ],
  [
    "jobs/src/fetchers/propublica-990.ts",
    "KNOWN DEBT: stored display string, same reason as fec.ts.",
  ],
  [
    "jobs/src/fetchers/rtb-seed.ts",
    "KNOWN DEBT: stored net-worth string, and its leading '~' is semantic (estimate), so this is not a pure formatter swap.",
  ],
  [
    "jobs/src/fetchers/wikidata-seed.ts",
    "KNOWN DEBT: stored net-worth string, same reason as rtb-seed.ts.",
  ],
  [
    "jobs/src/fetchers/wikidata.ts",
    "KNOWN DEBT: stored net-worth string, plus one plausibility-guard LOG line that never reaches a reader.",
  ],
  ["jobs/src/score-preview.ts", "Console diagnostics in a local-only script."],
  ["jobs/src/verify-990-attribution.ts", "Console diagnostics in a local-only script."],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("no NEW inline currency ladder — matched by shape, not by variable name", () => {
  const found: string[] = [];

  for (const file of sourceFiles(PACKAGES)) {
    const src = readFileSync(file, "utf8");
    if (!LADDER_SHAPE.test(src)) continue;
    const rel = relative(PACKAGES, file).split(sep).join("/");
    if (!ALLOWED.has(rel)) found.push(rel);
  }

  assert.deepEqual(
    found,
    [],
    `New inline currency ladder(s) — import formatCurrency from @ba/shared instead, or add an entry to ALLOWED in this file WITH the reason it is not a fork:\n  ${found.join("\n  ")}`,
  );
});

test("the allowlist is honest — every entry still holds a ladder", () => {
  // A stale allowlist is worse than none: it silently grants an exemption to a file that no
  // longer needs one, and the next real fork in that file inherits the exemption.
  const stale: string[] = [];
  for (const rel of ALLOWED.keys()) {
    const full = join(PACKAGES, rel);
    let src: string;
    try {
      src = readFileSync(full, "utf8");
    } catch {
      stale.push(`${rel} (file is gone)`);
      continue;
    }
    if (!LADDER_SHAPE.test(src)) stale.push(`${rel} (no ladder left — drop the exemption)`);
  }
  assert.deepEqual(stale, [], `Stale allowlist entries:\n  ${stale.join("\n  ")}`);
});

test("the shape matcher is identifier-agnostic — the property the 08-26 guard lacked", () => {
  assert.ok(LADDER_SHAPE.test("`$${(n / 1e9).toFixed(1)}B`"), "must match a ladder over `n`");
  assert.ok(LADDER_SHAPE.test("`$${(total / 1e6).toFixed(1)}M`"), "must match a ladder over `total`");
  assert.ok(
    LADDER_SHAPE.test("`$${(top.amount / 1e3).toFixed(0)}K`"),
    "must match a ladder over `top.amount` — the 08-26 identifier",
  );
  assert.ok(
    LADDER_SHAPE.test("`~$${(netWorthNum / 1e9).toFixed(1)}B`"),
    "must match through a leading tilde",
  );
  assert.ok(!LADDER_SHAPE.test("const ratio = value / 1e9;"), "plain arithmetic is not a ladder");
});
