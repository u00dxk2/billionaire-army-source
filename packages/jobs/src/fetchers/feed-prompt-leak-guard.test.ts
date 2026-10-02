import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cardQuotesItsInputs, promptLeakDrops } from "./feed-prompt-leak-guard";

/**
 * B-056 — the write-time prompt-leak guard: its DECISION first, then its WIRE-UP.
 *
 * The wire-up half exists because of this repo's own history: a guard whose call is deleted, or
 * whose drop set the publish loop never consults, leaves every other gate green (B-052's wire-up
 * file records the mutant that proved it). So the second half asserts CALL SITES, not behaviour.
 */

// The card that shipped on 2026-09-22, verbatim, before it was corrected by hand.
const SHIPPED_1A1B49A6 = {
  headline: "Gov. J.B. Pritzker joins federal officials in push on screen safety",
  summary:
    "Illinois Gov. J.B. Pritzker and federal officials discussed efforts to address screen safety, according to local reporting. Pritzker’s estimated net worth is about $3.9 billion; records in the provided data list $2.4 million in political donations and $614 million in foundation assets.",
};

// The same card after the 2026-09-22 correction — the wording this guard must let through.
const CORRECTED_1A1B49A6 = {
  headline: SHIPPED_1A1B49A6.headline,
  summary: SHIPPED_1A1B49A6.summary.replace("records in the provided data list", "public records list"),
};

test("B-056: the card that actually shipped is dropped", () => {
  assert.equal(cardQuotesItsInputs(SHIPPED_1A1B49A6), true);
});

test("B-056: its corrected wording publishes — ordinary sourcing language is not a leak", () => {
  assert.equal(cardQuotesItsInputs(CORRECTED_1A1B49A6), false);
  assert.equal(
    cardQuotesItsInputs({
      headline: "Court unseals provided records in Epstein estate case",
      summary: "Public records do not disclose the amount. No 990 filing reports grants for this foundation.",
    }),
    false,
  );
});

test("B-056: it reads the PROFILE vocabulary too — the phrase the feed-only scan could not see", () => {
  // Profile-observed phrasing the purge list deliberately omits. At write time a false positive
  // costs one unpublished candidate, so this guard may read it; the purge may not.
  assert.equal(
    cardQuotesItsInputs({ headline: "X gives to Y", summary: "No validated news articles were available in the provided dataset." }),
    true,
  );
});

test("B-056: ordinary accountability cards about data, filings and missing coverage PUBLISH", () => {
  // Every line here was measured as a DROP by the first version, which read the whole union of
  // both vocabularies (adversarial review, 2026-09-22). They are the genre this product exists
  // to publish, and a write-time drop is not cheap: nothing records it, so the story returns
  // and is re-dropped every run until the 21-day ingest cap ages it out.
  const newsroomSentences = [
    "Meta fined $5 billion over the data provided to Cambridge Analytica",
    "The SEC said the information provided to investors by Musk was misleading",
    "The dataset provided to researchers exposed 87 million users",
    "The donor was identified in the data as a Koch affiliate",
    "No articles were available to readers after the Post pulled the op-ed",
    "Meta said the provided data was anonymized before it reached advertisers",
    "Palantir said the provided data-sharing agreement with ICE was lawful",
  ];
  for (const summary of newsroomSentences) {
    assert.equal(cardQuotesItsInputs({ headline: "A billionaire and a filing", summary }), false, `dropped a real news sentence: ${summary}`);
  }
});

test("B-056: a non-string summary reads false instead of killing the run", () => {
  // Pass A returns json_object, not a strict schema, so `summary` is only conventionally a
  // string. Throwing here would abort the run BEFORE any insert — the day then publishes nothing.
  const malformed = { headline: "X gives $1M", summary: { text: "records in the provided data list" } as unknown as string };
  assert.equal(cardQuotesItsInputs(malformed), false);
  assert.equal(promptLeakDrops([malformed]).size, 0);
});

test("B-056: a leak in the HEADLINE alone is enough", () => {
  assert.equal(
    cardQuotesItsInputs({ headline: "According to the provided context, Z funds a PAC", summary: "Z gave $1M to a super PAC." }),
    true,
  );
});

test("B-056: drops are POSITIONS in curated, and only the leaking ones", () => {
  const drops = promptLeakDrops([CORRECTED_1A1B49A6, SHIPPED_1A1B49A6, CORRECTED_1A1B49A6, SHIPPED_1A1B49A6]);
  assert.deepEqual([...drops].sort(), [1, 3]);
  assert.equal(promptLeakDrops([]).size, 0);
});

// --- wire-up ------------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "feed-curator.ts"), "utf8");

/**
 * Strip comments first: the B-056 block's own prose names every symbol asserted below.
 *
 * TRAILING comments too, and that is not fussiness — an adversarial review on 2026-09-22 broke
 * the wire-up and appended `// leakDrop.has(idx) handled above`, and the whole-line-only strip
 * left the assertion satisfied by the comment describing the thing it guards. The `[^:]` keeps
 * `https://…` inside string literals intact.
 */
function code(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const body = code(src);
const lines = body.split("\n");
const lineOf = (re: RegExp): number => lines.findIndex((l) => re.test(l));

/**
 * These assertions are EXACT STATEMENTS, not substring greps, and every one of them is a mutant
 * that survived the first version (adversarial review, 2026-09-22): `!leakDrop.has(idx)` inverted
 * the gate so only the leaking card published; `&&` instead of `||` changed precedence;
 * `promptLeakDrops(curated) && new Set()` threw the result away; a shadowing `const leakDrop`
 * in an inner block; a `leakDrop.clear()` after the count line. A grep for the symbol matched
 * all five.
 */
test("B-056 wire-up: the curator imports the guard from ./feed-prompt-leak-guard and CALLS it on curated", () => {
  assert.match(src, /import \{[^}]*\bpromptLeakDrops\b[^}]*\} from "\.\/feed-prompt-leak-guard"/);
  const calls = lines.filter((l) => /^\s*const leakDrop = promptLeakDrops\(curated\);\s*$/.test(l));
  assert.equal(calls.length, 1, "expected exactly one `const leakDrop = promptLeakDrops(curated);` — anything else (a discarded result, an extra binding) is not this wire-up");
});

test("B-056 wire-up: leakDrop is bound ONCE and never mutated afterwards", () => {
  const bindings = lines.filter((l) => /\bconst leakDrop\b/.test(l));
  assert.equal(bindings.length, 1, "a second `const leakDrop` shadows the real one inside a block, and every symbol grep still passes");
  for (const m of ["clear", "delete", "add"]) {
    assert.ok(!new RegExp(`leakDrop\\.${m}\\s*\\(`).test(body), `leakDrop.${m}() mutates the drop set after it is computed: the log and the behaviour then disagree`);
  }
});

test("B-056 wire-up: the PUBLISH loop skips a leaking card, unnegated, before the insert", () => {
  // Two loops open with `for (const [idx, item] of curated.entries())` — the attribution
  // guard's and the publish loop's — so anchor on the verifiers' skip condition (unique: only
  // that line consults rewriteDrop) and read the publish loop around it.
  const verifierSkip = lines.findIndex((l) => /verifier\.rejected\.has\(idx\).*\|\|.*rewriteDrop\.has\(idx\)/.test(l));
  assert.ok(verifierSkip > 0, "could not locate the publish loop's verifier skip condition");
  const loop = lines.slice(0, verifierSkip).reduce((acc, l, i) => (/^\s*for \(const \[idx, item\] of curated\.entries\(\)\) \{\s*$/.test(l) ? i : acc), -1);
  assert.ok(loop >= 0, "could not locate the publish loop header above the skip condition");

  const inLoop = lines.slice(loop + 1, verifierSkip);
  const at = inLoop.findIndex((l) => /^\s*if \(leakDrop\.has\(idx\)\) \{\s*$/.test(l));
  assert.ok(at >= 0, `the publish loop has no exact \`if (leakDrop.has(idx)) {\` before the verifier skip — a negated, re-precedenced or comment-shadowed variant publishes the leaking card. Saw: ${JSON.stringify(inLoop.map((l) => l.trim()).filter(Boolean))}`);
  assert.match(inLoop[at + 1] ?? "", /^\s*leakDropped\+\+;\s*$/, "the leak branch must count into leakDropped, kept apart from the verifiers' figure");
  assert.match(inLoop[at + 2] ?? "", /^\s*continue;\s*$/, "the leak branch must `continue` — without it the card falls through and publishes");

  const insert = lines.findIndex((l, i) => i > verifierSkip && /\.insert\(feedItems\)/.test(l));
  assert.ok(insert > verifierSkip, "the skip must come before the feed_items insert");
});

test("B-056 wire-up: leak drops are NOT counted as 'dropped by verifiers'", () => {
  // check-curator-supply.mjs reads `(\d+) items added(?:, (\d+) dropped by verifiers)?` as the
  // B-027 wipeout denominator. A deterministic guard in that number makes the alarm say "the
  // judges refused everything" on a day no judge refused anything.
  assert.match(body, /let leakDropped = 0;/, "leak drops have no counter of their own");
  const complete = lines.findIndex((l) => /Feed curation complete: \$\{inserted\} items added/.test(l));
  assert.ok(complete > 0, "could not locate the completion line");
  assert.match(lines[complete], /\$\{dropped\} dropped by verifiers/, "the parsed completion line must still report the VERIFIERS' number");
  assert.ok(!lines[complete].includes("leakDropped"), "leakDropped must not be folded into the parsed completion line");
});

test("B-056 wire-up: a leaking card is out of the write-time rewrite-dedup pool too", () => {
  const live = lineOf(/\.filter\(\(\{ idx \}\) => !verifier\.rejected\.has\(idx\)/);
  assert.ok(live >= 0, "could not locate the rewrite-dedup live filter");
  // EXACT conjunction: `|| !leakDrop.has(idx)` instead of `&&` puts every Pass-B-rejected card
  // back in the pool and still contains the symbol a grep would look for.
  assert.match(
    lines[live],
    /^\s*\.filter\(\(\{ idx \}\) => !verifier\.rejected\.has\(idx\) && !faithDrop\.has\(idx\) && !attributionDrop\.has\(idx\) && !leakDrop\.has\(idx\)\);\s*$/,
    `the rewrite-dedup live filter is not the exact four-way conjunction — a card that will never publish can knock a real card out as its "duplicate". Saw: ${lines[live]?.trim()}`,
  );
});

test("B-056 wire-up: the count line prints on EVERY run, not only when something dropped", () => {
  const countLine = lineOf(/console\.log\(`Prompt-leak guard \(B-056\): \$\{curated\.length\} checked, \$\{leakDrop\.size\} dropped/);
  assert.ok(countLine > 0, "the always-printed count line is gone — a run that never checked now looks like a clean one");
  // Its own statement: `if (leakDrop.size > 0) console.log(...)` on ONE line survived the
  // brace count below on 2026-09-22 (mutant M4) — a brace-less condition has no braces to count.
  assert.match(lines[countLine], /^\s*console\.log\(`Prompt-leak guard/, "the count line is guarded by a condition on the same line");
  // ...and the code line above it must END a statement or block, not open a brace-less `if`.
  const prev = lines.slice(0, countLine).reverse().find((l) => l.trim() !== "");
  assert.match(prev ?? "", /[;}]\s*$/, `the line before the count line does not end a statement: "${prev?.trim()}" — a two-line brace-less if would make it conditional`);
  const call = lineOf(/const leakDrop = promptLeakDrops\(curated\)/);
  const between = lines.slice(call + 1, countLine).join("\n");
  const opens = (between.match(/\{/g) ?? []).length;
  const closes = (between.match(/\}/g) ?? []).length;
  assert.equal(opens, closes, "the count line sits inside a block — it must be unconditional, at the guard's own level");
});
