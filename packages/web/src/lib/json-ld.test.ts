import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonLdString } from "./json-ld";

/**
 * The JSON-LD sink guard, tested after the fleet XSS sweep of 2026-09-11 (walking-denver shipped a
 * stored XSS where raw user text reached an inline JSON-LD block through a bare `JSON.stringify`).
 *
 * THIS LANE'S EXPOSURE, stated so the next reader does not have to re-derive it: three inline
 * `application/ld+json` payloads (`layout.tsx`, `billionaires/page.tsx`, `billionaires/[id]/page.tsx`),
 * all three already routed through this helper. Two carry person names, aliases and descriptions —
 * DB-sourced, but `/propose` lets a visitor submit a person, so user text CAN reach them once an
 * admin approves the row. Third-party reachable behind a moderation gate, never self-XSS only.
 */

describe("jsonLdString", () => {
  test("THE ATTACK: a closing script tag in a data value cannot end the element", () => {
    const payload = jsonLdString({ name: "</script><img src=x onerror=alert(1)>" });
    assert.ok(!payload.includes("</script"), "no literal </script may survive into the page");
    assert.ok(payload.includes("\\u003c/script"), "the '<' is escaped as a JSON unicode escape");
  });

  test("the escaped payload still parses back to the SAME data — escaping is not mangling", () => {
    const value = { name: "</script>", description: "a < b & c > d", alternateName: ["x</script>y"] };
    assert.deepEqual(JSON.parse(jsonLdString(value)), value);
  });

  test("the unicode line terminators are escaped, for the day this helper is reused in a real script", () => {
    const payload = jsonLdString({ name: "a\u2028b\u2029c" });
    assert.ok(!/[\u2028\u2029]/.test(payload), "no raw line separator may reach the page");
    assert.equal(JSON.parse(payload).name, "a\u2028b\u2029c", "and the value round-trips intact");
  });

  test("'>' and '&' are deliberately left alone — script content is raw text", () => {
    // Pinned so a later 'hardening' pass does not add escaping that implies HTML entity decoding
    // happens here. It does not: only `</script` ends the element, and `<` is already escaped.
    assert.ok(jsonLdString({ a: "x > y & z" }).includes("x > y & z"));
  });

  test("WIRE-UP: every inline ld+json sink in the app goes through this helper", () => {
    // The helper staying correct is worthless if a page serialises its own payload. Measured
    // 2026-09-11: three sinks, three helper calls.
    const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
    const files = [
      join(appDir, "layout.tsx"),
      join(appDir, "billionaires", "page.tsx"),
      join(appDir, "billionaires", "[id]", "page.tsx"),
    ];
    let sinks = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/application\/ld\+json/g)) {
        sinks++;
        const after = src.slice(match.index, match.index + 400);
        assert.match(
          after,
          /dangerouslySetInnerHTML=\{\{\s*__html:\s*jsonLdString\(/,
          `${file}: an ld+json sink must serialise through jsonLdString`,
        );
        assert.doesNotMatch(
          after,
          /__html:\s*JSON\.stringify\(/,
          `${file}: raw JSON.stringify into a script sink is the XSS hole`,
        );
      }
    }
    assert.equal(sinks, 3, "three known ld+json sinks — a new one must be added here deliberately");
  });
});
