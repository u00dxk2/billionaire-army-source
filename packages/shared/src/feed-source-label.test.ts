import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLabel } from "./feed-source-label";

test("a real stored publisher name wins and is not rewritten to a host", () => {
  assert.equal(sourceLabel("Fortune", "https://fortune.com/2026/08/01/x/"), "Fortune");
  assert.equal(sourceLabel("The Washington Post", "https://www.washingtonpost.com/a"), "The Washington Post");
});

// The live defect, pinned: this exact card rendered `Unknown ↗` at served #7 on 2026-08-17.
test("the curator's Unknown placeholder falls back to the source host", () => {
  assert.equal(
    sourceLabel("Unknown", "https://www.washingtonexaminer.com/news/investigations/4680805/soros-foundation-dissenters-military-war-protest/"),
    "washingtonexaminer.com",
  );
});

test("placeholder variants and empties all fall back", () => {
  for (const p of ["Unknown", "unknown", "  UNKNOWN  ", "", "   ", "n/a", "null", "-"]) {
    assert.equal(sourceLabel(p, "https://example.com/a"), "example.com", `placeholder ${JSON.stringify(p)}`);
  }
  assert.equal(sourceLabel(null, "https://example.com/a"), "example.com");
  assert.equal(sourceLabel(undefined, "https://example.com/a"), "example.com");
});

test("www is stripped but other subdomains are kept", () => {
  assert.equal(sourceLabel("Unknown", "https://www.forbes.com/x"), "forbes.com");
  assert.equal(sourceLabel("Unknown", "https://finance.yahoo.com/x"), "finance.yahoo.com");
  assert.equal(sourceLabel("Unknown", "https://economictimes.indiatimes.com/x"), "economictimes.indiatimes.com");
});

test("no usable name AND no usable url says so plainly — never 'Unknown'", () => {
  // "Unknown" reads as a fact about the source; this is a gap in OUR record and must read that way.
  assert.equal(sourceLabel("Unknown", null), "Source not recorded");
  assert.equal(sourceLabel(null, undefined), "Source not recorded");
  assert.equal(sourceLabel("Unknown", "not a url"), "Source not recorded");
});

test("never throws on a malformed stored url — it runs inside a render path", () => {
  for (const u of ["", "http://", "://x", "javascript:alert(1)"]) {
    assert.doesNotThrow(() => sourceLabel("Unknown", u));
  }
});
