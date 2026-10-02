import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TRUSTEE_REVIEWED, applyTrusteeReview, normalizeEin } from "./foundation-trustee-review";

const KAISER = "dd311251-3435-47df-a49a-4ac97f43ce51";
const TOM_FORD = "d469e305-a703-461b-aa9b-b83abae9c65f";

test("B-021: an unreviewed person's candidates pass through unchanged", () => {
  const c = [{ ein: 123456789 }, { ein: "987654321" }];
  assert.deepEqual(applyTrusteeReview("not-a-reviewed-id", c), c);
});

test("B-021: a reviewed person keeps ONLY allowed EINs — rejected ones and never-seen namesakes both drop", () => {
  const out = applyTrusteeReview(KAISER, [
    { ein: 731574370, name: "George Kaiser Family Foundation" },
    { ein: 811168111, name: "Kaiser Family Foundation" },
    { ein: 555555555, name: "Kaiser Foundation (a namesake the review never saw)" },
  ]);
  assert.deepEqual(out.map((o) => o.name), ["George Kaiser Family Foundation"]);
});

test("B-021: a reviewed person with nothing allowed gets an EMPTY list, so the fetcher self-heals the row away", () => {
  assert.deepEqual(applyTrusteeReview(TOM_FORD, [{ ein: 936026156 }, { ein: 884301211 }]), []);
});

test("B-021: EINs normalize to 9 digits (ProPublica drops a leading zero)", () => {
  assert.equal(normalizeEin(42103580), "042103580");
  assert.equal(normalizeEin("04-2103580"), "042103580");
});

test("B-021: every review entry is well-formed — 9-digit keys, allowed and rejected disjoint, evidence non-empty", () => {
  for (const [id, r] of Object.entries(TRUSTEE_REVIEWED)) {
    assert.match(id, /^[0-9a-f-]{36}$/, `${r.person}: person id`);
    for (const [ein, why] of [...Object.entries(r.allowed), ...Object.entries(r.rejected)]) {
      assert.match(ein, /^\d{9}$/, `${r.person}: EIN ${ein}`);
      assert.ok(why.includes("http"), `${r.person}: EIN ${ein} carries no source URL`);
    }
    for (const ein of Object.keys(r.allowed)) assert.ok(!(ein in r.rejected), `${r.person}: ${ein} both allowed and rejected`);
  }
});

// Wire-up. The filter proves nothing unless the fetcher applies it to the search result BEFORE the
// zero-match self-heal and BEFORE the insert. Comments stripped so prose cannot satisfy this.
test("B-021: propublica-990.ts filters the search result through applyTrusteeReview before self-heal and insert", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "propublica-990.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const assign = src.indexOf("const foundations = applyTrusteeReview(person.id, findFoundations(orgs, person.name));");
  assert.ok(assign > 0, "the search result is no longer filtered through applyTrusteeReview");
  const selfHeal = src.indexOf("if (foundations.length === 0) {");
  const insert = src.indexOf(".insert(personFacts)");
  assert.ok(selfHeal > assign && insert > assign, "the filter must run before the self-heal check and the insert");
  assert.equal(src.split("findFoundations(orgs, ").length - 1, 1, "a second, unfiltered findFoundations call site exists");
});
