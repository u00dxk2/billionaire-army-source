import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sourceLabel } from "@ba/shared";

/**
 * B-032 — the curator must never WRITE "Unknown" as a source name.
 *
 * WHY A SOURCE-LEVEL TEST AND NOT ONLY A BEHAVIOURAL ONE. `sourceLabel()` was already correct and
 * already tested (`feed-source-label.test.ts`) — the display side has derived the host since 08-17.
 * The defect was never the helper; it was that the curator did not CALL it, and kept writing the
 * placeholder into `feed_items.source_name`. A test that only exercises `sourceLabel()` stays green
 * through a revert of the wire-up, which is the exact failure this project has been bitten by
 * ("a falsifier must revert the WIRE-UP, not just the helper"). So this asserts the call sites.
 *
 * The placeholder is not a harmless fallback. `Unknown ↗` rendered over a real link on a hedged
 * allegation about a named living person, and `credibilityTier("Unknown")` scores 0 — an unnamed
 * source ranks as an ordinary tier-0 publisher. On a platform whose thesis is that no claim
 * outruns its citation, that is the thesis failing on the surface that carries it.
 */

const CURATOR = join(dirname(fileURLToPath(import.meta.url)), "feed-curator.ts");
const src = readFileSync(CURATOR, "utf8");

/** Strip line- and block-comments so the prose ABOVE a call site can't satisfy or trip an assertion. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("curator never writes an 'Unknown' placeholder as a source name", () => {
  const body = code(src);
  const offenders = body
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /\bsource(Name)?\s*:/.test(line) && /["']Unknown["']/.test(line));

  assert.deepEqual(
    offenders,
    [],
    `curator assigns the "Unknown" placeholder to a source field at: ${offenders
      .map((o) => `line ${o.n} — ${o.line}`)
      .join(" | ")}. Derive the host with sourceLabel(name, url) instead.`,
  );
});

test("every curator source-name assignment routes through sourceLabel", () => {
  const body = code(src);
  // Object-literal assignments only — a TYPE member (`source: string;`) declares a shape, not a value.
  const TYPE_MEMBER = /:\s*(string|number|boolean|Date|unknown|any|\{)\s*[;,}]?\s*$/;
  const assignments = body
    .split("\n")
    .filter((l) => /^\s*source(Name)?\s*:/.test(l) && !TYPE_MEMBER.test(l));

  // Both ingest adapters (gdelt_articles, news_headlines) plus the feed_items write.
  assert.ok(
    assignments.length >= 3,
    `expected at least 3 source-name assignments (2 ingest adapters + the write), found ${assignments.length}`,
  );

  for (const line of assignments) {
    assert.match(
      line,
      /sourceLabel\(/,
      `source-name assignment bypasses sourceLabel(): ${line.trim()}`,
    );
  }

  assert.match(src, /import \{[^}]*\bsourceLabel\b[^}]*\} from "@ba\/shared"/, "sourceLabel must come from @ba/shared — do not fork a second host parser");
});

test("the live 08-23/08-24 placeholder rows resolve to a real host", () => {
  // Verbatim sourceUrls from cards that shipped with sourceName "Unknown".
  const cases: [string, string][] = [
    ["https://cryptoslate.com/winklevoss-twins-gave-trumps-super-pac-10-mill", "cryptoslate.com"],
    ["https://www.hedgeweek.com/ackman-donates-400m-pershing-square-take-to-", "hedgeweek.com"],
    ["https://news.am/en/news/1054416", "news.am"],
    ["https://timesofindia.indiatimes.com/technology/tech-news/gates-foundat", "timesofindia.indiatimes.com"],
  ];
  for (const [url, host] of cases) {
    assert.equal(sourceLabel("Unknown", url), host);
    assert.equal(sourceLabel(undefined, url), host, "a missing name must behave like the placeholder");
  }
});

test("an unusable URL degrades to a stated gap, never to 'Unknown'", () => {
  assert.equal(sourceLabel("Unknown", "not-a-url"), "Source not recorded");
  assert.equal(sourceLabel(null, null), "Source not recorded");
  // A real publisher string still wins over the host — this fix must not overwrite good data.
  assert.equal(sourceLabel("Fortune", "https://fortune.com/x"), "Fortune");
});
