import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The owner's ruling, 2026-09-04 (board card resolving needs-decision 2af4444a): retire "PBS" from
 * everything a visitor reads — the score is the GIVING SCORE everywhere — and keep the formal
 * name "Public Benefit Score" on the methodology page alone.
 *
 * WHY A GREP AND NOT A CONSTANT. `@ba/shared/score-vocabulary.ts` already holds the score's
 * reader-facing name for the surfaces that render it as a BADGE, and those surfaces import it.
 * Most of the rest of the site names the score inside an English sentence ("Ranked by giving
 * score. Open formula, adjustable weights."), where a constant cannot carry the grammar. So the
 * name is written out in prose on ~a dozen surfaces, which is exactly the drift the vocabulary
 * module was built to prevent — and the enforcement has to be a sweep over the rendered source
 * rather than a call-site guard. This is the lane's own standing lesson: a guard keyed to an
 * IDENTIFIER is blind to a consumer that re-derives the value, so match the reader-visible
 * OPERATION (the string a visitor sees) rather than the symbol it came from.
 *
 * R-041 previously ruled PBS off the feed card's badge only, and deliberately KEPT it on
 * profile / leaderboard / compare as score-comparison contexts. This ruling supersedes that half.
 *
 * KNOWN CEILING, stated rather than hidden: comments are stripped by a small state machine, not
 * by a parser, so a comment marker inside a string literal could mis-slice a line. It
 * mis-slices toward REPORTING, never toward silence — a mis-stripped line still gets scanned, so
 * the failure mode is a false finding somebody fixes, not a live "PBS" nobody sees.
 */

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The ONE surface allowed to say "Public Benefit Score": the methodology page, which llms.txt
 * already advertises as "the full scoring methodology". Named as a path so the exemption is a
 * decision a reader can audit, not a regex that quietly widens.
 */
const METHODOLOGY_PAGE = join("app", "about", "page.tsx");

/** The internal name in every shape a reader could meet it. */
const INTERNAL_NAME = /\bPBS\b|Public Benefit/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** Source with comments removed — what a visitor can actually end up reading. */
export function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (let line of src.split("\n")) {
    let kept = "";
    while (line.length > 0) {
      if (inBlock) {
        const close = line.indexOf("*/");
        if (close === -1) { line = ""; break; }
        line = line.slice(close + 2);
        inBlock = false;
      } else {
        const open = line.indexOf("/*");
        // `://` is a URL, not a comment. Anything else after `//` is one.
        const lineComment = line.search(/(?<!:)\/\//);
        if (open !== -1 && (lineComment === -1 || open < lineComment)) {
          kept += line.slice(0, open);
          line = line.slice(open + 2);
          inBlock = true;
        } else if (lineComment !== -1) {
          kept += line.slice(0, lineComment);
          line = "";
        } else {
          kept += line;
          line = "";
        }
      }
    }
    out.push(kept);
  }
  return out.join("\n");
}

test("no web surface a visitor reads names the score 'PBS' or 'Public Benefit'", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(WEB_SRC)) {
    const rel = relative(WEB_SRC, file);
    if (rel === METHODOLOGY_PAGE) continue;
    for (const [i, line] of stripComments(readFileSync(file, "utf8")).split("\n").entries()) {
      if (INTERNAL_NAME.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `reader-facing "PBS" survives:\n${offenders.join("\n")}`);
});

test("the exemption is not dead weight — the methodology page still carries the formal name", () => {
  const src = readFileSync(join(WEB_SRC, METHODOLOGY_PAGE), "utf8");
  assert.match(stripComments(src), /Public Benefit Score/);
});

test("the sweep can fail — positive control on each comment shape", () => {
  // Every shape below is a COMMENT and must be stripped; the bare code line must survive.
  assert.doesNotMatch(stripComments('// says PBS here'), INTERNAL_NAME);
  assert.doesNotMatch(stripComments('/* says PBS here */'), INTERNAL_NAME);
  assert.doesNotMatch(stripComments('/*\n * says PBS here\n */'), INTERNAL_NAME);
  assert.doesNotMatch(stripComments('{/* says PBS here */}'), INTERNAL_NAME);
  assert.match(stripComments('<dt>PBS</dt> // trailing'), INTERNAL_NAME);
  // A URL must not be mistaken for a line comment and swallow what follows it.
  assert.match(stripComments('href="https://x.test" title="Public Benefit Score"'), INTERNAL_NAME);
});
