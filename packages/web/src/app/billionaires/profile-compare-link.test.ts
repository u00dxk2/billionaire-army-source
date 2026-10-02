import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The profile page must offer a route to /compare.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. /compare shipped at launch and worked; the picker,
 * the sitemap entry, llms.txt and the OG-image files all referenced it. What did not exist
 * was any way for a reader to REACH it from a person's page. Measured 2026-09-06:
 * `grep -rn "/compare" packages/web/src` returned six hits and the only one under
 * `billionaires/` was a COMMENT. So the profile dead-ended at exactly the moment the
 * reader has a giving score in front of them and a reaction to it — the moment the
 * compare surface was built for.
 *
 * That is this repo's recorded failure shape, not a new one: an asset that already exists
 * and is simply not being delivered (the OG receipt nothing handed to the share sheet,
 * R-044/R-083; the dedup judge that had already been asked, B-031). A missing LINK leaves
 * every unit test, typecheck and build green, because nothing in the type system objects
 * to a page that renders fine and goes nowhere.
 *
 * The assertion is deliberately about the LINK's presence and its prefill, not about copy —
 * the wording should be free to change without going red.
 */

const PROFILE_PAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  "[id]",
  "page.tsx",
);

/** Comments are where the old reference lived, so they must not satisfy this check. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the profile page links to /compare (not only in a comment)", () => {
  const code = withoutComments(readFileSync(PROFILE_PAGE, "utf8"));
  assert.ok(
    code.includes("/compare"),
    "billionaires/[id]/page.tsx has no /compare reference outside comments — a reader " +
      "standing on a giving score has no route to the compare surface, which is the exact " +
      "state measured on 2026-09-06 (the only hit under billionaires/ was a comment).",
  );
});

test("the compare link is PREFILLED with the person on screen", () => {
  const code = withoutComments(readFileSync(PROFILE_PAGE, "utf8"));
  assert.match(
    code,
    /\/compare\?a=\$\{person\.id\}/,
    "the compare link must carry ?a=${person.id}. compare/page.tsx renders the `a` person " +
      "in a column and shows 'Pick the second billionaire above' for the empty slot, so a " +
      "prefilled link opens one step from done; a bare /compare link opens blank and throws " +
      "away the only thing we knew about the reader's intent.",
  );
});
