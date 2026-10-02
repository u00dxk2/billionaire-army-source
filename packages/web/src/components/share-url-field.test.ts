import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * R-083 — every `navigator.share()` call hands the link over in the `url` FIELD.
 *
 * NOT R-072, which is a different open row (a card's headline dropping a hedge its own summary
 * keeps). The 2026-09-05 orchestrator feedback called this work "R-072 / share" and the
 * conflation travelled through two phases before it was caught while attaching commits; this
 * comment is here so the wrong id does not get re-derived from a stale reading of that thread.
 *
 * THE RULE. A share target unfurls the link it is given in `url`. A URL sitting inside the
 * `text` blob is just characters: no preview, no image, no title. R-044 renders a per-card
 * Open Graph image of the receipt — with `og-legibility.ts` pinning its type scale so it
 * survives a ~250px unfurl — and that image is verified live and correct on prod. None of it
 * ever reached a recipient, because both share call sites passed `text` only.
 *
 * WHY A SWEEP AND NOT A COMMENT AT EACH CALL SITE. This is the identical shape as
 * og-image-coupling.test.ts one directory up, and that file's own docblock says why: the rule
 * WAS commented at every call site anyone had counted, and the defect was a call site missing
 * from the hand-maintained mental list. There were two `navigator.share` calls here and I found
 * the second only by grepping. So this test enumerates the components directory itself rather
 * than trusting a list — a third share button added next month is caught by construction.
 *
 * WHAT THIS DOES NOT CHECK, said plainly so a green run is not read as more than it is: that
 * the URL is CORRECT, that the target actually unfurls it, or that the OG image renders. It
 * checks the one thing that was wrong — the field the link is passed in.
 */

const COMPONENTS = dirname(fileURLToPath(import.meta.url));

/** Every source file in components/, so a new share button cannot hide from this. */
function componentSources(): Array<{ name: string; src: string }> {
  return readdirSync(COMPONENTS)
    .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts"))
    .map((name) => ({ name, src: readFileSync(join(COMPONENTS, name), "utf8") }));
}

/**
 * The argument object of each `navigator.share({...})` call in a source file.
 * Brace-matched rather than regex-slurped, so a nested object or a template literal
 * containing `}` cannot truncate the match and produce a false pass.
 */
function shareCallArgs(src: string): string[] {
  const out: string[] = [];
  const NEEDLE = "navigator.share(";
  let from = 0;
  for (;;) {
    const start = src.indexOf(NEEDLE, from);
    if (start === -1) break;
    let i = start + NEEDLE.length;
    let depth = 0;
    let argStart = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") {
        if (depth === 0) argStart = i;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          out.push(src.slice(argStart, i + 1));
          break;
        }
      } else if (depth === 0 && c === ")") {
        // A share call with a non-object argument — record it as empty so the
        // assertion below fails loudly rather than skipping it.
        out.push("");
        break;
      }
    }
    from = start + NEEDLE.length;
  }
  return out;
}

test("every navigator.share call passes the link in the url field", () => {
  const offenders: string[] = [];
  let calls = 0;

  for (const { name, src } of componentSources()) {
    for (const args of shareCallArgs(src)) {
      calls++;
      if (!/\burl\s*:/.test(args)) offenders.push(`${name}: navigator.share(${args || "<non-object arg>"})`);
    }
  }

  // Denominator first: a sweep that found no call sites proves nothing, and would go green
  // forever if this directory were renamed. Exit loud instead of quietly passing.
  assert.ok(
    calls >= 2,
    `share-url sweep examined ${calls} navigator.share call(s) in ${COMPONENTS} — expected at least 2 ` +
      `(FeedCard and DailySwipe). A zero here is an UNREADABLE sweep, not a clean one.`
  );

  assert.deepEqual(
    offenders,
    [],
    `navigator.share called without a url field — the link will not unfurl and R-044's per-card ` +
      `Open Graph receipt never reaches the recipient:\n  ${offenders.join("\n  ")}`
  );
});

test("the clipboard fallback still carries the link inline — it has no url field to use", () => {
  // The other half of the same fix, and the one a careless cleanup would break: passing `url`
  // to navigator.share is only safe because the CLIPBOARD path keeps the link in its text.
  // Strip it there and the copied message has nowhere to go.
  const feedCard = readFileSync(join(COMPONENTS, "FeedCard.tsx"), "utf8");
  const dailySwipe = readFileSync(join(COMPONENTS, "DailySwipe.tsx"), "utf8");

  assert.match(
    feedCard,
    /clipboard\.writeText\(\s*clipboardText\s*\)/,
    "FeedCard's clipboard fallback must write the link-bearing string, not the native-share body"
  );
  assert.match(feedCard, /See the receipt: \$\{receiptUrl\}/, "FeedCard's clipboard text lost its deep link");

  assert.match(
    dailySwipe,
    /clipboard\.writeText\(\s*clipboardText\s*\)/,
    "DailySwipe's clipboard fallback must write the link-bearing string, not the native-share body"
  );
  assert.match(dailySwipe, /See the receipts → \$\{shareUrl\}/, "DailySwipe's clipboard text lost its deep link");
});
