/**
 * B-046 is WIRED: the generator's write helper honours a hand-approval marker, and the row it writes
 * carries the marker forward.
 *
 * The first half is an EXECUTION test, not a source read: it calls the real `applyBlockAtWrite` with
 * a fake `exec` that returns a published row, so a guard that is written but never takes effect goes
 * red. Importing the module creates a DB pool and an OpenAI client but connects to nothing; `main()`
 * sits behind `isMain`, so nothing runs. The dummy env below exists only to get past the module's
 * required-variable checks.
 *
 * The fixtures are chosen so each plausible mis-wiring fails a DIFFERENT assertion:
 *   - the marked section's published text and the candidate differ (identity mapping cannot pass);
 *   - the marked section's published text states $689,538 against Jordan's real record, so a helper
 *     that still hands the preserved section to the figure block records a quarantine entry for it;
 *   - the unmarked section's candidate states the same wrong figure, so a helper that judges ONLY the
 *     preserved sections (a dropped `!`) fails to quarantine it.
 *
 * The second half is a source read of the WRITE, because the insert runs inside `main()`'s
 * transaction and cannot be executed here. Comments are stripped first: a trailing comment that
 * mentions the statement must not satisfy the check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
process.env.OPENAI_API_KEY ??= "sk-test-not-used";

const JORDAN = [
  1, 18, 90, 100, 109, 250, 475, 900, 931, 1145, 1162, 2023, 3794, 10038, 142680, 304670, 311194,
  364868, 383916, 385323, 476916, 846750, 878622, 1181810, 1516288, 2335280, 13078216, 15798819,
  586039423, 752486085, 882989784,
];
const WRONG = "His foundations reported a combined $689,538 in grants paid [IRS].";
const APPROVAL = { by: "the owner", date: "2026-09-12", ruling: "decision-0002" };

const person = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Test Person",
  state: null,
  industry: [],
  birthYear: null,
  country: null,
  facts: [],
};
const published = {
  overview: "OLD overview, still live.",
  philanthropy: `APPROVED text. ${WRONG}`,
  generatedAt: "2026-09-13T16:00:00.000Z",
  sectionGeneratedAt: { philanthropy: "2026-09-12T19:05:00.000Z" },
  approvedSections: { philanthropy: APPROVAL },
};
const candidate = {
  overview: `FRESH overview. ${WRONG}`,
  business: "FRESH business.",
  philanthropy: "FRESH philanthropy that would overwrite the ruling.",
};
const fakeExec = { execute: async () => [{ fact_value: published }] };

test("EXECUTED: the marked section is kept, the unmarked ones are rewritten or judged, and the marker goes forward", async () => {
  const { applyBlockAtWrite } = await import("./profile-summary");
  const out = await applyBlockAtWrite(fakeExec, person, candidate, JORDAN, true);

  assert.equal(out.summary.philanthropy, published.philanthropy, "the hand-approved paragraph must survive");
  assert.equal(out.summary.business, "FRESH business.", "an unmarked section with nothing wrong takes the fresh text");
  assert.equal(out.summary.overview, published.overview, "an unmarked section with a wrong figure is still quarantined");
  assert.deepEqual(
    out.quarantined.map((q) => q.section),
    ["overview"],
    "the figure block must judge exactly the unmarked sections — never the approved one",
  );
  assert.deepEqual(out.approvedSections, { philanthropy: APPROVAL }, "the marker must be returned for the write");
  assert.equal(out.preservedAt.philanthropy, "2026-09-12T19:05:00.000Z", "kept prose keeps its own date");
});

test("EXECUTED: with no marker, the same candidate rewrites the section (the negative control)", async () => {
  const { applyBlockAtWrite } = await import("./profile-summary");
  const unmarked = { ...published, approvedSections: undefined };
  const out = await applyBlockAtWrite({ execute: async () => [{ fact_value: unmarked }] }, person, candidate, JORDAN, true);
  assert.equal(out.summary.philanthropy, candidate.philanthropy);
  assert.deepEqual(out.approvedSections, {});
});

test("EXECUTED, two regenerations: a model-supplied marker never persists and never blocks a correction", async () => {
  const { applyBlockAtWrite } = await import("./profile-summary");
  const unmarked = { ...published, approvedSections: undefined };
  const forged = { ...candidate, philanthropy: `FORGED. ${WRONG}`, approvedSections: { philanthropy: APPROVAL } };
  const first = await applyBlockAtWrite({ execute: async () => [{ fact_value: unmarked }] }, person, forged, JORDAN, true);
  assert.equal("approvedSections" in first.summary, false, "the candidate's own key must not reach the written row");
  assert.deepEqual(first.approvedSections, {});

  // The row exactly as main() writes it, then a second run over it with a fresh candidate.
  const written = {
    ...first.summary,
    ...(Object.keys(first.approvedSections).length > 0 ? { approvedSections: first.approvedSections } : {}),
  };
  const second = await applyBlockAtWrite({ execute: async () => [{ fact_value: written }] }, person, { philanthropy: "CORRECTED." }, JORDAN, true);
  assert.equal(second.summary.philanthropy, "CORRECTED.", "nothing a model wrote may freeze a section");
});

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "profile-summary.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

test("SOURCE: the written row carries the marker forward, inside the profile_summary insert", () => {
  const insert = CODE.indexOf('factKey: "profile_summary",');
  assert.ok(insert > 0, "the profile_summary insert must exist, or the next assertion guards an empty region");
  const region = CODE.slice(insert, CODE.indexOf("});", insert));
  const line = "...(Object.keys(block.approvedSections).length > 0 ? { approvedSections: block.approvedSections } : {}),";
  assert.ok(region.includes(line), "without this spread, a marker protects exactly one regeneration");
  assert.equal(CODE.split(line).length - 1, 1, "written once");
});

test("SOURCE: the one API route that serves raw fact rows strips the marker", () => {
  const api = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../api/src/routes/persons.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  assert.ok(api.includes("facts: facts.map(withoutApprovalMetadata),"), "GET /api/persons/:id must not serve who approved what");
  assert.doesNotMatch(api, /^\s*facts,\s*$/m, "the raw rows must not also be returned unstripped");
});

test("SOURCE: the write locks the PERSON before reading the summary, so overlapping runs serialise", () => {
  // CEILING: this reads source order. The race it guards (two concurrent regenerations of one person,
  // review round 2) needs two DB connections to reproduce and is not executed here.
  const helper = CODE.slice(CODE.indexOf("export async function applyBlockAtWrite("), CODE.indexOf("async function main()"));
  const personLock = helper.indexOf("if (lock) await exec.execute(sql`SELECT id FROM persons WHERE id = ${personData.id} FOR UPDATE`);");
  const summaryRead = helper.indexOf("SELECT fact_value FROM person_facts");
  assert.ok(personLock > 0, "the per-person lock must exist, guarded by `lock` so the dry run takes none");
  assert.ok(personLock < summaryRead, "…and it must come BEFORE the summary read it protects");
});

test("EXECUTED: a locking call issues the person lock first; a dry-run call issues none", async () => {
  const { applyBlockAtWrite } = await import("./profile-summary");
  const seen: string[] = [];
  const recorder = (locked: boolean) => ({
    execute: async (q: any) => {
      const text = JSON.stringify(q?.queryChunks ?? q);
      seen.push(`${locked}:${text.includes("FROM persons") ? "persons" : "facts"}`);
      return text.includes("FROM persons") ? [] : [{ fact_value: published }];
    },
  });
  await applyBlockAtWrite(recorder(true), person, candidate, JORDAN, true);
  await applyBlockAtWrite(recorder(false), person, candidate, JORDAN, false);
  assert.deepEqual(seen, ["true:persons", "true:facts", "false:facts"]);
});

test("SOURCE: the closing log states both counts, including at zero", () => {
  assert.match(CODE, /Hand-approved sections \(B-046\): \$\{approvedKept\} PRESERVED, \$\{approvedIgnored\} marker\(s\) IGNORED/);
});
