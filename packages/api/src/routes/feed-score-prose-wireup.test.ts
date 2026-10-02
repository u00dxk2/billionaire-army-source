import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * R-081. The served summary is repaired so a card cannot contradict its own badge.
 *
 * Measured 2026-09-03 on the served 40: five cards read "has a PBS score of 91.60" three inches
 * from a badge reading "GIVING A (92)", one of them PROMOTED at position 1. R-041 had already
 * ruled the front door does not name the score PBS — the ruling reached the badge and the share
 * text and stopped before the GPT-written prose.
 *
 * The curator fix reaches only cards published after it, so the repair has to happen here too,
 * exactly as B-030's foundation-prose repair and the live PBS override already do: at display
 * time, no prod data write, every already-published card fixed at once.
 *
 * BOTH ROUTES OR NEITHER, and that is a property of the call site only — which is why this is a
 * wire-up test rather than a helper test on `repairScoreProse`. `/feed/[id]` is what a SHARE
 * lands on, so a card contradicting its own badge travels furthest from the route it would be
 * easiest to forget. Cycle 10's lesson in this repo was exactly that: an invariant carefully
 * commented at the two call sites anyone had counted, and there were three.
 */

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), "feed.ts");
const src = readFileSync(ROUTE, "utf8");

/** Strip comments so the prose explaining the wire-up cannot satisfy the assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("feed.ts imports the score repair from @ba/shared rather than restating it", () => {
  const body = code(src);

  assert.ok(
    /import\s*\{[^}]*\brepairScoreProse\b[^}]*\}\s*from\s*["']@ba\/shared["']/s.test(body),
    "feed.ts must import repairScoreProse from @ba/shared",
  );

  // The predicate and the vocabulary live in ONE place. A local regex over "PBS" here would be a
  // second copy of the rule, and this repo's standing anchor (B-037) is a checker that forked one.
  assert.ok(
    !/\/[^\n]*PBS[^\n]*\/[gimsuy]*\.(test|exec|replace)/.test(body),
    "feed.ts must not carry its own PBS-matching regex — import the shared one",
  );
});

test("BOTH served routes repair the summary, not just the list", () => {
  const body = code(src);

  const calls = [...body.matchAll(/repairScoreProse\s*\(/g)];
  assert.equal(
    calls.length,
    2,
    "the list route and the deep-linked /feed/:id route must each repair the summary — " +
      "the deep link is what a share lands on",
  );

  // Both must be assigned to the served `summary` field, not computed and dropped.
  //
  // The window is what allows an OUTER wrapper. B-037's prose withhold now wraps this chain
  // (`summary: (withheld ? withholdPoliticalProse : id)(repairScoreProse(...))`), which is
  // deliberate — a removal has to run last or a repair could restate what it just removed. The
  // property this test exists for is unchanged: the repair is what the route SERVES rather than
  // something computed and dropped. An adjacency-only pattern asserted the composition instead,
  // and went red on a change that satisfied it (2026-09-10).
  // Widened 200 → 320 on 2026-10-02: the not-graded withhold (`withholdScoreProse`) now wraps the
  // B-037 one, outermost, for the same reason — it removes rather than restates.
  const assigned = [...body.matchAll(/summary:[\s\S]{0,320}?repairScoreProse\s*\(/g)];
  assert.equal(assigned.length, 2, "each repair must be what the route actually serves as `summary`");

  // …and the only thing permitted to stand between `summary:` and the repair is the B-037
  // withhold, so this window can never quietly admit a wrapper that discards the repaired text.
  for (const m of assigned) {
    const between = body.slice(m.index!, m.index! + m[0].length);
    assert.ok(
      /summary:\s*repairScoreProse\s*\($/.test(between) || between.includes("withholdPoliticalProse"),
      `only the B-037 and not-graded withholds may wrap the score repair, got: ${between.trim()}`,
    );
  }
});

test("the score repair wraps the foundation repair, so both survive on one sentence", () => {
  const body = code(src);

  // repairFoundationProse corrects a doubled foundation figure in the same sentence. If the score
  // repair replaced that call rather than wrapping it, B-030's fix would be silently reverted.
  const foundationCalls = [...body.matchAll(/repairFoundationProse\s*\(/g)];
  assert.equal(foundationCalls.length, 2, "B-030's prose repair must still run on both routes");

  for (const m of [...body.matchAll(/repairScoreProse\s*\(/g)]) {
    const window = body.slice(m.index!, m.index! + 400);
    assert.ok(
      /repairFoundationProse\s*\(/.test(window),
      "each score repair must compose with the foundation repair, never replace it",
    );
  }
});

test("BOTH routes hand the repair their tagged-person COUNT, so a two-person card is left alone", () => {
  const body = code(src);

  // The live score belongs to the PRIMARY tagged person and the summary can name a different one,
  // so on a multi-person card the repair would print one person's figure under another's name —
  // at a score of 0, a manufactured false zero about someone real. Found by a cold Codex round.
  const guards = [...body.matchAll(/repairScoreProse\s*\([\s\S]{0,400}?(taggedPersonIds|personIds)\.length/g)];
  assert.equal(
    guards.length,
    2,
    "each repair call must pass its route's tagged-person count — dropping the argument would " +
      "not be a type error if a default were ever added, so it is pinned here",
  );
});

test("the repair is fed the LIVE score, never the frozen contextData figure", () => {
  const body = code(src);

  // `live` is the score read from scoreSnapshots on both routes and is what the badge renders.
  // Passing the frozen `ctx.pbs` instead would re-freeze the snapshot this repair exists to unfreeze.
  for (const m of [...body.matchAll(/repairScoreProse\s*\(/g)]) {
    const window = body.slice(m.index!, m.index! + 400);
    assert.ok(
      /\blive\b/.test(window),
      "each repair must be handed the live score, so a rescored person's prose moves with the badge",
    );
    assert.ok(
      !/ctx\.pbs|contextData\.pbs/.test(window),
      "the repair must never read the frozen contextData figure",
    );
  }
});
