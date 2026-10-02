import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  contextReceiptsFor,
  faithfulnessCardBlock,
  generatorCandidateBlock,
  moneyReceiptLines,
  type ReceiptCandidate,
} from "./feed-receipt-lines";

/**
 * B-063 — ONE labeled receipts string for the card writer (Pass A) and the faithfulness judge
 * (Pass C). On 2026-09-23 the writer saw `FEC: $1.9M in political donations`, the judge saw
 * `$1.9M in political donations`, and both of the day's cards were dropped for saying
 * "FEC records" — a true attribution the judge had no way to trace. 0 published.
 *
 * The behaviour tests read the EMITTED prompt blocks. The first version of this file read the
 * curator's SOURCE and passed under three mutations an adversarial review made (the default
 * flipped to unlabeled; Pass C's prompt bypassing the receipts builder; a quoted string holding
 * the expected code) — so the wire-up assertions below anchor on call syntax only the real
 * call site has, and stay the SECOND line of defence, never the first.
 */

const WEXNER: ReceiptCandidate = {
  article: {
    title: "Ohio politicians keep promise to rebuke Les Wexner by donating $200K in campaign contributions",
    source: "Ideastream",
    date: "2026-09-23",
  },
  personName: "Les Wexner",
  context: { netWorth: "~$9.3B", pbs: "48", political: "$1.9M in political donations", philanthropy: "$4M in foundation assets" },
};
const CARD = { headline: "h", summary: "s" };

/** The money lines a prompt block carries, in order. */
function moneyLinesIn(block: string): string[] {
  return block
    .split(/\n|; /)
    .map((l) => l.replace(/^\s*(Provided context receipts: )?/, "").trim())
    .filter((l) => /(political donations|foundation assets)$/.test(l));
}

test("money receipts carry their source label by default", () => {
  assert.deepEqual(moneyReceiptLines(WEXNER.context), ["FEC: $1.9M in political donations", "990: $4M in foundation assets"]);
});

test("an absent receipt produces no line, labeled or not", () => {
  assert.deepEqual(moneyReceiptLines({}), []);
  assert.deepEqual(moneyReceiptLines({ political: null, philanthropy: "" }), []);
  assert.deepEqual(moneyReceiptLines({ political: "$25 in political donations" }, { labels: false }), ["$25 in political donations"]);
});

test("the generator's emitted block carries the LABELED money lines", () => {
  assert.deepEqual(moneyLinesIn(generatorCandidateBlock(WEXNER, 0)), [
    "FEC: $1.9M in political donations",
    "990: $4M in foundation assets",
  ]);
});

test("Pass C's emitted block, at its DEFAULT, carries the same labeled lines the generator saw", () => {
  const judge = moneyLinesIn(faithfulnessCardBlock(CARD, WEXNER, 0));
  const writer = moneyLinesIn(generatorCandidateBlock(WEXNER, 0));
  assert.deepEqual(judge, writer, "one string, two readers — the judge must read what the writer read");
});

test("the DROP log's receipts (contextReceiptsFor, default) are labeled too", () => {
  assert.match(contextReceiptsFor(WEXNER), /FEC: \$1\.9M in political donations; 990: \$4M in foundation assets$/);
});

test("only an explicit labels=false strips them — the A/B's pre-B-063 control arm", () => {
  assert.deepEqual(moneyLinesIn(faithfulnessCardBlock(CARD, WEXNER, 0, false)), [
    "$1.9M in political donations",
    "$4M in foundation assets",
  ]);
});

// ---- wire-up: the curator must USE these builders. Second line of defence (see header). ----

const CURATOR = join(dirname(fileURLToPath(import.meta.url)), "feed-curator.ts");
const src = readFileSync(CURATOR, "utf8").replace(/\r\n/g, "\n");

/**
 * Remove comments AND the text of string/template literals (keeping `${…}` code), so neither prose
 * nor a quoted copy can satisfy a match. A scanner, not regexes: a backtick inside a `//` comment
 * opened a phantom template under the regex version and swallowed the real call sites.
 */
function code(s: string): string {
  let out = "";
  const stack: ("tpl" | "brace")[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i], nx = s[i + 1];
    const inTpl = stack[stack.length - 1] === "tpl";
    if (inTpl) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") { stack.pop(); out += "`"; i++; continue; }
      if (ch === "$" && nx === "{") { stack.push("brace"); out += "${"; i += 2; continue; }
      i++; continue;
    }
    if (ch === "/" && nx === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (ch === "/" && nx === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== ch && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
      out += ch + ch; i = j + 1; continue;
    }
    if (ch === "`") { stack.push("tpl"); out += "`"; i++; continue; }
    if (ch === "{" && stack.length) { stack.push("brace"); out += ch; i++; continue; }
    if (ch === "}" && stack[stack.length - 1] === "brace") { stack.pop(); out += ch; i++; continue; }
    out += ch; i++;
  }
  return out;
}
const body = code(src);

test("the curator imports the builders from the side-effect-free module", () => {
  assert.match(
    src,
    /import\s*\{[^}]*\bgeneratorCandidateBlock\b[^}]*\bfaithfulnessCardBlock\b[^}]*\}\s*from\s*["']\.\/feed-receipt-lines["']/,
  );
});

test("Pass A's prompt is built by generatorCandidateBlock and sent WITHOUT post-processing", () => {
  // Exact statement: a `.replaceAll("FEC: ", "")` after the join passed the looser pattern (review 2).
  assert.match(body, /const candidateDescriptions = filtered\.map\(\(c, i\) => generatorCandidateBlock\(c, i\)\)\.join\(""\);\n/);
  assert.match(body, /const userPrompt = `[^`]*\$\{candidateDescriptions\}`;/, "the generator's user message must carry the blocks as built");
});

test("Pass C's user message carries faithfulnessCardBlock's output as built", () => {
  assert.match(body, /\.filter\(Boolean\)\n\s*\.join\(""\);\n\n\s*if \(!cards\) return result;/);
  assert.match(body, /const userPrompt = `[^`]*\$\{cards\}`;/);
});

test("the only Pass C calls with a fifth argument are the dry-run A/B re-judges", () => {
  // Review 2: passing CURATOR_DRY_RUN (not a literal false) as the live call's fifth argument
  // disabled production labels and passed the literal-false check. Count ARGUMENTS, not values.
  const calls = [...body.matchAll(/(?<!function )runFaithfulnessVerifier\(([^()]*)\)/g)];
  const five = calls.filter((m) => m[1].split(",").length >= 5);
  assert.equal(five.length, 2, "exactly the two unlabeled A/B calls pass a receiptLabels argument");
  assert.ok(
    body.includes("const faith = await runFaithfulnessVerifier(curated, filtered);"),
    "the live Pass C call takes the defaults — labeled",
  );
});

test("Pass C's prompt is built by faithfulnessCardBlock with the verifier's receiptLabels", () => {
  assert.match(body, /faithfulnessCardBlock\(item,\s*c,\s*i,\s*receiptLabels\)/);
  assert.match(body, /receiptLabels:\s*boolean\s*=\s*true\s*\)\s*:\s*Promise<VerifierResult>/, "the live default must be labeled");
});

test("every Pass C call that passes labels=false sits inside the CURATOR_DRY_RUN-gated A/B block", () => {
  const unlabeled = [...body.matchAll(/runFaithfulnessVerifier\([^)]*,\s*false\s*\)/g)];
  assert.equal(unlabeled.length, 2, "exactly the two unlabeled A/B re-judges pass labels=false");
  const ab = body.match(/if\s*\(\s*CURATOR_DRY_RUN\s*&&\s*process\.env\.CURATOR_PASSC_LABEL_AB\s*===\s*""\s*&&[\s\S]*?\n {2}\}\n/);
  assert.ok(ab, "the A/B block must be gated on CURATOR_DRY_RUN");
  for (const m of unlabeled) assert.ok(ab[0].includes(m[0]), "an unlabeled Pass C call outside the dry-run A/B would judge live cards without labels");
});
