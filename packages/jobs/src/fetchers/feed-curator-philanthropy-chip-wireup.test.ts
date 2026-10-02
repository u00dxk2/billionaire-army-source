import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foundationAssetsChip } from "@ba/shared";

/**
 * A feed card's foundation-assets chip must not depend on the order Postgres returns fact rows in.
 *
 * WHY THIS EXISTS. B-048 (2026-09-14) found that on /today a Giving Pledge row read after a
 * foundation row erased the foundation's giving, because `philanthropy` is a factTYPE shared by
 * foundation_990s, giving_pledge and total_giving — and only the first carries foundations. The
 * fix-then-grep-siblings sweep over `factType === "philanthropy"` found this curator doing the same
 * thing on the FEED: the branch matched the TYPE and assigned the chip unconditionally, so a pledge
 * row read last set it to null. That chip is card context AND is handed to Pass A.
 *
 * THE FIX IS KEY DISPATCH, NOT NULL-SUPPRESSION. The first attempt was `if (chip)`. Adversarial review
 * rejected it: suppressing every null also stops a NEWER foundation record that legitimately renders
 * no chip from clearing a stale one, and the wiring regex for it would have accepted an added
 * `else existing.philanthropy = null`. Only a `foundation_990s` row may set the chip, and it sets it
 * including null.
 *
 * READ WHICH TEST GUARDS WHAT. The BEHAVIOUR tests model the dispatch in `chipAfter()` below — a COPY
 * of the fix, not the curator's loop, which is inline in a job with side effects. Red-armed: with the
 * type branch restored in feed-curator.ts, the behaviour tests stay green and ONLY the WIRING test
 * goes red. So the behaviour tests document the mechanism; the WIRING test is the guard. Do not delete
 * it on the grounds that the behaviour tests "cover" it — they provably do not.
 */

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "feed-curator.ts"), "utf8");

const FOUNDATION = { factKey: "foundation_990s", factValue: { foundations: [{ totalAssets: 9e9, grantsPaid: 14501841217 }] } };
const SMALL_FOUNDATION = { factKey: "foundation_990s", factValue: { foundations: [{ totalAssets: 500_000, grantsPaid: 1 }] } };
const PLEDGE = { factKey: "giving_pledge", factValue: { source: "The Giving Pledge", signatory: true, pledgeName: "X" } };
const DIRECT = { factKey: "total_giving", factValue: { cumulativeGiving: 7e9, periodLabel: "since 2015", source: "CZI" } };

type Row = { factKey: string; factValue: unknown };
const UNSET = Symbol("unset");

/** The curator loop's dispatch, as it now reads: only a foundation_990s row sets the chip, INCLUDING null. */
function chipAfter(rows: Row[]): string | null | typeof UNSET {
  let chip: string | null | typeof UNSET = UNSET;
  for (const r of rows) if (r.factKey === "foundation_990s") chip = foundationAssetsChip(r.factValue);
  return chip;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}

test("BEHAVIOUR: the pledge and curated rows return null, which is exactly what used to clobber", () => {
  assert.equal(foundationAssetsChip(PLEDGE.factValue), null);
  assert.equal(foundationAssetsChip(DIRECT.factValue), null);
  assert.ok(foundationAssetsChip(FOUNDATION.factValue), "the foundation row must produce a chip at all");
});

test("BEHAVIOUR: the chip survives EVERY ordering of foundation, pledge and curated rows", () => {
  for (const order of permutations<Row>([FOUNDATION, PLEDGE, DIRECT])) {
    assert.equal(chipAfter(order), "$9.0B in foundation assets", `order [${order.map((r) => r.factKey)}] lost the chip`);
  }
});

test("BEHAVIOUR: a foundation record that renders NO chip may still clear one — the null-suppression trap", () => {
  // The review's reproduction: suppressing nulls kept a stale $9B chip after a record that renders none.
  // Key dispatch lets the foundation record's own null stand, so the later foundation row wins.
  assert.equal(foundationAssetsChip(SMALL_FOUNDATION.factValue), null, "fixture must render no chip");
  assert.equal(chipAfter([FOUNDATION, SMALL_FOUNDATION]), null);
});

test("WIRING: the context query SELECTS factKey — without it the key branch is dead code", () => {
  /* Round-2 adversarial review, 2026-09-14: the first key-dispatch version read `f.factKey` from a
     query that did not select it, so the branch never ran and EVERY feed card lost its foundation
     context — worse than the clobber it fixed. The key-branch assertion below PASSED on that broken
     code, because it only checks the source string of the branch. This assertion closes that hole. */
  const q = SRC.indexOf("const contextFacts = await db");
  assert.ok(q > 0, "the context-facts query must still exist");
  const projection = SRC.slice(q, SRC.indexOf(".from(personFacts)", q));
  assert.match(projection, /factKey:\s*personFacts\.factKey/, "the projection must select factKey, or f.factKey is undefined and the chip branch never runs");
});

test("WIRING: the chip branch dispatches on the foundation KEY, never the shared philanthropy TYPE", () => {
  assert.match(
    SRC,
    /\} else if \(f\.factKey === "foundation_990s"\) \{/,
    "the chip must be set only from a foundation_990s row",
  );
  assert.doesNotMatch(
    SRC,
    /\} else if \(f\.factType === "philanthropy"\) \{/,
    "branching on the shared TYPE is the B-048 sibling — a pledge row read last erases the chip",
  );
});
