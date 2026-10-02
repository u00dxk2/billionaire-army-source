import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GENERATOR_SYSTEM_PROMPT, GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING, generatorRequest } from "./feed-generator-prompt";

/**
 * R-048 round 2 (2026-09-29): the card writer (Pass A) now carries Pass C's grounding test. It
 * changes the WRITER only. These tests pin three things:
 * (1) the live prompt carries the rule;
 * (2) the dry-run baseline is byte-identical to the prompt that shipped before, so the A/B
 *     measures the rule against its real predecessor;
 * (3) Pass C's own prompt did not move (evangelism-bar BINDING, Pass C stays unloosened).
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const here = dirname(fileURLToPath(import.meta.url));
// Template literals cook CRLF to LF, so normalize before slicing raw source text.
const curatorSrc = readFileSync(join(here, "feed-curator.ts"), "utf8").replace(/\r\n/g, "\n");

/** The raw text of a `const NAME = \`...\`;` template with no interpolation. */
function templateConst(src: string, name: string): string {
  const head = `const ${name} = \``;
  const from = src.indexOf(head);
  assert.ok(from >= 0, `${name} not found in feed-curator.ts`);
  const start = from + head.length;
  const text = src.slice(start, src.indexOf("`;", start));
  assert.ok(!text.includes("${") && !text.includes("\\"), `${name} must stay a plain template for this pin to mean anything`);
  return text;
}

test("the live writer prompt states Pass C's grounding test", () => {
  const p = GENERATOR_SYSTEM_PROMPT;
  assert.match(p, /GROUNDING — an independent fact-checker will REJECT/);
  assert.match(p, /Do NOT add background from your own knowledge, even when it is true/);
  assert.match(p, /Do NOT add a motive, consequence, significance/);
  assert.match(p, /merely shares their name\), the story fails ENTITY — skip it/);
  assert.match(p, /Write a 1-3 sentence summary/);
  assert.match(p, /"summary": "1-3 sentence summary with context data woven in"/);
  assert.doesNotMatch(p, /2-3 sentence/, "a leftover 2-3 demand contradicts the one-sentence allowance");
});

test("the dry-run baseline is byte-identical to the pre-grounding prompt (HEAD 69c44b54 at dfdfa98)", () => {
  assert.equal(GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING.length, 3486);
  assert.equal(sha(GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING), "69c44b54a0683c83ef11f345df9a637103dc07d80d0108027100e7a682f5c897");
  assert.doesNotMatch(GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING, /GROUNDING/);
});

test("Pass C's prompt is byte-identical to before the grounding change", () => {
  const passC = templateConst(curatorSrc, "FAITHFULNESS_SYSTEM_PROMPT");
  assert.equal(sha(passC), "3b7b518569f67d2f907c3f2e6b3dd895a8e2fdf5d140e03f735e151e62b785dd", "Pass C stays unloosened (evangelism-bar BINDING)");
});

test("the request Pass A sends carries the given prompt as its SYSTEM message, and the user prompt as the user message", () => {
  const req = generatorRequest("gpt-5.6-terra", GENERATOR_SYSTEM_PROMPT, "USER-BLOCKS");
  assert.deepEqual(req.messages, [
    { role: "system", content: GENERATOR_SYSTEM_PROMPT },
    { role: "user", content: "USER-BLOCKS" },
  ]);
  assert.equal(req.model, "gpt-5.6-terra");
  assert.deepEqual(req.response_format, { type: "json_object" });
  assert.equal(req.max_completion_tokens, 4000);
  assert.ok(!("temperature" in req), "gpt-5.6-* 400s on any non-default temperature (CLAUDE.md § Models)");
});

test("runGenerator sends generatorRequest's output UNCHANGED, built from its own systemPrompt parameter", () => {
  // Exact statement, so a swapped argument or a post-processed request fails (Codex review).
  assert.match(
    curatorSrc,
    /\n {2}const response = await openai\.chat\.completions\.create\(generatorRequest\(GENERATOR_MODEL, systemPrompt, userPrompt\)\);\n/,
  );
  assert.match(curatorSrc, /async function runGenerator\(systemPrompt: string, userPrompt: string,/);
  const creates = [...curatorSrc.matchAll(/generatorRequest\(/g)];
  assert.equal(creates.length, 1, "exactly one generator request is built in the curator");
});

test("the live Pass A call sends GENERATOR_SYSTEM_PROMPT, and the baseline only inside the dry-run A/B", () => {
  assert.match(curatorSrc, /\nconst SYSTEM_PROMPT = GENERATOR_SYSTEM_PROMPT;\n/);
  assert.match(curatorSrc, /\n {2}const gen = await runGenerator\(SYSTEM_PROMPT, userPrompt, filtered\.length\);\n/);
  // The baseline name appears once in the import and once in the call. That call must sit inside
  // the CURATOR_DRY_RUN-gated A/B block.
  const uses = [...curatorSrc.matchAll(/GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING/g)];
  assert.equal(uses.length, 2, "import + exactly one call site");
  const ab = curatorSrc.match(/\n {2}if \(CURATOR_DRY_RUN && process\.env\.CURATOR_PASSA_GROUNDING_AB === "1"[\s\S]*?\n {2}\}\n/);
  assert.ok(ab, "the grounding A/B block must be gated on CURATOR_DRY_RUN");
  assert.ok(ab[0].includes("GENERATOR_SYSTEM_PROMPT_PRE_GROUNDING"), "a baseline call outside the dry-run A/B would publish ungrounded cards");
});
