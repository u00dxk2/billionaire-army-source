import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeInternalPath } from "./safe-internal-path.js";

const ORIGIN = "https://billionaire.army";

// Each payload goes through the SAME decode the route does — searchParams.get()
// percent-decodes — so the test exercises the bytes the guard actually receives,
// not a hand-decoded approximation of them.
function asNextParam(raw: string): string | null {
  return new URL(`${ORIGIN}/auth/callback?code=x&next=${raw}`).searchParams.get("next");
}

// The four payloads the fleet sweep named, plus the classics. Each is listed with
// what it becomes if it is NOT rejected.
const ATTACKS: [string, string][] = [
  ["@evil.com", "userinfo: origin+next concatenates to https://billionaire.army@evil.com"],
  ["/.//evil.com", "dot segment normalises the pathname to //evil.com"],
  ["/%09/evil.com", "decodes to a tab the browser strips, leaving //evil.com"],
  ["/%5Cevil.com", "decodes to a backslash the parser reads as a slash"],
  ["//evil.com", "protocol-relative"],
  ["https://evil.com", "absolute off-origin"],
  ["/safe/..//evil.com", "dot segments normalise to //evil.com"],
  ["%09//evil.com", "leading tab, stripped by the browser"],
];

for (const [raw, why] of ATTACKS) {
  test(`open redirect refused: ${raw} — ${why}`, () => {
    assert.equal(safeInternalPath(asNextParam(raw)), "/");
  });
}

test("the payload list is REAL, and each payload escapes the way this test says it does", () => {
  // The control that makes the list above evidence rather than decoration — and it
  // keeps the two escape shapes apart, because MEASURING them (2026-09-16) showed
  // they are not the same defect:
  //   HOST escape   — "@evil.com" resolves to host evil.com under `${origin}${next}`.
  //                   That is the live open redirect on THIS server route.
  //   PATH escape   — every other payload keeps our host and normalises the PATHNAME
  //                   to "//evil.com". A 302 to an absolute URL with that pathname
  //                   stays on our host; it turns into an off-site navigation only
  //                   when a path like that reaches a CLIENT-side navigation.
  // Both are rejected by the guard. Claiming all eight are host escapes would have
  // overstated the finding, which is why this control classifies instead of counting.
  const hostEscapes: string[] = [];
  const pathEscapes: string[] = [];
  for (const [raw] of ATTACKS) {
    const next = asNextParam(raw) ?? "";
    try {
      const u = new URL(`${ORIGIN}${next}`);
      if (u.host !== "billionaire.army") hostEscapes.push(raw);
      else if (u.pathname.startsWith("//")) pathEscapes.push(raw);
    } catch {
      hostEscapes.push(`${raw} (<unparseable>)`);
    }
  }
  assert.deepEqual(
    hostEscapes,
    ["@evil.com", "https://evil.com"],
    `the userinfo payload must still reach a foreign host under the old concatenation; got ${JSON.stringify(hostEscapes)}`
  );
  assert.equal(
    hostEscapes.length + pathEscapes.length,
    ATTACKS.length,
    `every listed payload must escape one of the two ways; host=${JSON.stringify(hostEscapes)} path=${JSON.stringify(pathEscapes)}`
  );
});

test("the sentinel origin is not a bypass: //internal.invalid/feed is refused", () => {
  // Arms the protocol-relative PREFIX check specifically. This payload resolves
  // ONTO the sentinel origin the guard parses against, so the origin comparison
  // and the pathname check both pass it — only the "//" prefix rejects it.
  // (Adversarial review, 2026-09-16: deleting that line left every other test green.)
  assert.equal(safeInternalPath(asNextParam("//internal.invalid/feed")), "/");
});

test("an EMBEDDED backslash or DEL is rejected, not just a leading one", () => {
  // Arms the backslash and 0x7f clauses of the control-character loop: these
  // resolve to ordinary internal pathnames, so nothing else in the guard sees them.
  assert.equal(safeInternalPath(asNextParam("/feed%5Cevil.com")), "/");
  assert.equal(safeInternalPath(asNextParam("/feed%7Fevil")), "/");
});

test("control characters are rejected even when they do NOT normalise to //", () => {
  // This is the check that ARMS the control-character branch. Measured 2026-09-16:
  // deleting that branch left every other test in this file green, because the four
  // sweep payloads are all caught by the later "//" pathname check. These two are
  // caught by nothing else — CR/LF (the header-injection shape) and NUL both resolve
  // to an ordinary-looking internal pathname.
  assert.equal(safeInternalPath(asNextParam("/feed%0d%0aX-Injected:%201")), "/");
  assert.equal(safeInternalPath(asNextParam("/fe%00ed")), "/");
});

test("a normal in-domain path keeps its query AND hash", () => {
  assert.equal(safeInternalPath(asNextParam("/feed?tab=new%23top")), "/feed?tab=new#top");
  assert.equal(safeInternalPath(asNextParam("/billionaires/abc")), "/billionaires/abc");
  assert.equal(safeInternalPath("/"), "/");
});

test("an absent or empty value falls back, and the fallback is caller-chosen", () => {
  assert.equal(safeInternalPath(null), "/");
  assert.equal(safeInternalPath(""), "/");
  assert.equal(safeInternalPath(undefined), "/");
  assert.equal(safeInternalPath("@evil.com", "/login?error=auth"), "/login?error=auth");
});

test("the callback route uses the guard and does NOT concatenate origin with next", () => {
  // The guard being correct proves nothing if the route still concatenates
  // (KP-93: a falsifier must revert the WIRE-UP, not just the helper). Matched as
  // a live statement, not a substring: a commented-out call must fail this.
  const src = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
  assert.ok(
    /^\s*(const|let)\s+\w+\s*=\s*safeInternalPath\(/m.test(src) ||
      /safeInternalPath\(/.test(src.replace(/^\s*\/\/.*$/gm, "")),
    "the callback route must resolve `next` through safeInternalPath"
  );
  assert.ok(
    !/\$\{origin\}\$\{next\}/.test(src),
    "the callback route must not build its destination by concatenating origin with a raw next"
  );
  // …and the redirect must CONSUME the guarded value, not merely compute it beside
  // an unguarded one (adversarial review, 2026-09-16: the checks above pass even if
  // the redirect ignores `next`). CEILING, stated rather than papered over: this is
  // still a source read. It cannot prove the deployed handler's Location header —
  // that needs a harness mocking @supabase/ssr and next/headers, and the success
  // branch cannot be reached on prod without a one-time PKCE code from a real browser.
  assert.match(
    src,
    /NextResponse\.redirect\(new URL\(next, origin\)\)/,
    "the success branch must redirect to new URL(next, origin) with the guarded value"
  );
});
