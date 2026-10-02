import { test } from "node:test";
import assert from "node:assert/strict";
import { credibilityTier, LOW_CREDIBILITY_DOMAINS } from "./feed-source-credibility";
import { sourceQualityScore } from "./feed-punch";

test("listed domain is tier 1", () => {
  assert.equal(credibilityTier("zerohedge.com"), 1);
  assert.equal(credibilityTier("wsws.org"), 1);
});

test("subdomain of a listed domain is tier 1", () => {
  assert.equal(credibilityTier("www.zerohedge.com"), 1);
});

test("unlisted domains are tier 0", () => {
  assert.equal(credibilityTier("propublica.org"), 0);
  assert.equal(credibilityTier("bloomberg.com"), 0);
  assert.equal(credibilityTier("insidephilanthropy.com"), 0);
});

test("exact-subdomain entry does not smear the parent domain", () => {
  assert.equal(credibilityTier("veropatriot.iheart.com"), 1);
  assert.equal(credibilityTier("wjno.iheart.com"), 0);
  assert.equal(credibilityTier("iheart.com"), 0);
});

test("substring collisions do not match (suffix rule, not includes)", () => {
  // A domain merely CONTAINING a listed name must not match.
  assert.equal(credibilityTier("notzerohedge.com"), 0);
  assert.equal(credibilityTier("zerohedge.com.evil.net"), 0);
});

test("null/empty/display-name sources are tier 0", () => {
  assert.equal(credibilityTier(null), 0);
  assert.equal(credibilityTier(""), 0);
  assert.equal(credibilityTier("The Guardian"), 0);
});

test("newsbusters.org is listed (owner-approved 2026-07-25) and sinks its card", () => {
  // Pinned because the reason lives in a decision, not in the code path: the
  // Soros/jihad-framing card was reaching /feed position 5 beside a PBS "A".
  // Removing this entry is an editorial change, not a refactor.
  assert.equal(credibilityTier("newsbusters.org"), 1);
  assert.equal(credibilityTier("www.newsbusters.org"), 1);
  assert.ok(
    sourceQualityScore("newsbusters.org", "https://www.newsbusters.org/blogs/nb/story") <= -10,
    "the display ranking must feel the tier, not just the curator's pre-rank"
  );
});

test("washingtonexaminer.com is listed (owner-approved 2026-08-17) and sinks its card", () => {
  // Same pinning rationale as newsbusters above: the reason lives in a decision, not in
  // a code path. The card was "Soros-funded group reportedly offers payments to student
  // protesters" — the day's ONLY published card, at /feed position 7. Removing this entry
  // is an editorial change requiring the owner, not a refactor.
  assert.equal(credibilityTier("washingtonexaminer.com"), 1);
  assert.equal(credibilityTier("www.washingtonexaminer.com"), 1);
  assert.ok(
    sourceQualityScore(
      "washingtonexaminer.com",
      "https://www.washingtonexaminer.com/news/investigations/4680805/soros-foundation-dissenters-military-war-protest/"
    ) <= -10,
    "the display ranking must feel the tier, not just the curator's pre-rank"
  );
});

// The entry DEMOTES, it does not block — the penalty is FINITE and ordering-based, not a
// filter. Pinned because the owner was told exactly this when he approved the entry, and
// because someone reading the list later could reasonably mistake it for a publication
// gate and "fix" the fact that these cards still ship.
test("a low-credibility domain is demoted, not excluded — the penalty is finite", () => {
  const url = "https://www.washingtonexaminer.com/news/x";
  const low = sourceQualityScore("washingtonexaminer.com", url);
  const ok = sourceQualityScore("reuters.com", "https://www.reuters.com/news/x");
  assert.ok(Number.isFinite(low), "a tier-1 source must still score a finite number, not -Infinity");
  assert.ok(low < ok, `tier-1 must rank below tier-0 (${low} vs ${ok})`);
});

test("seed list stays small and carries a reason per entry", () => {
  assert.ok(LOW_CREDIBILITY_DOMAINS.length <= 20, "seed list is deliberately small");
  for (const d of LOW_CREDIBILITY_DOMAINS) {
    assert.ok(d.reason.length > 0, `${d.domain} must document its reason`);
  }
});
