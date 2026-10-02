import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  classifySearchResponse,
  classifyFilingsResponse,
  searchNonprofits,
  getFilings,
  ProPublicaFetchError,
} from "./propublica-client";

const ORG = { ein: 731574370, name: "George Kaiser Family Foundation", city: "Tulsa", state: "OK", ntee_code: "T20", total_revenue: 1, total_assets: 1 };
// The shape ProPublica returned for a no-match search on 2026-10-01: HTTP 404, well-formed body.
const NO_MATCH_BODY = { total_results: 0, organizations: [], num_pages: 0, cur_page: 0 };

function fakeFetch(status: number, body: unknown, opts: { badJson?: boolean; throws?: boolean } = {}) {
  return async () => {
    if (opts.throws) throw new TypeError("fetch failed");
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (opts.badJson) throw new SyntaxError("Unexpected token <");
        return body;
      },
    };
  };
}

test("B-021 p2: a 200 search answer returns its organizations", async () => {
  const orgs = await searchNonprofits("Kaiser foundation", fakeFetch(200, { total_results: 1, organizations: [ORG] }));
  assert.deepEqual(orgs, [ORG]);
});

test("B-020 kept: a SUCCESSFUL no-match search (404 + zero-result body) is an answer of [], so the self-heal still fires", async () => {
  assert.deepEqual(classifySearchResponse(404, NO_MATCH_BODY), { kind: "answer", orgs: [] });
  assert.deepEqual(await searchNonprofits("zzqxqvjk foundation", fakeFetch(404, NO_MATCH_BODY)), []);
});

test("B-021 p2: a FAILED search throws — never [] (which the self-heal would turn into a delete)", async () => {
  for (const status of [429, 500, 502, 503]) {
    await assert.rejects(searchNonprofits("Knight foundation", fakeFetch(status, { error: "x" })), ProPublicaFetchError, `HTTP ${status}`);
  }
  // A 404 that is not a zero-result answer (an HTML error page, or a body claiming results).
  await assert.rejects(searchNonprofits("q", fakeFetch(404, undefined, { badJson: true })), ProPublicaFetchError);
  await assert.rejects(searchNonprofits("q", fakeFetch(404, { total_results: 3, organizations: [] })), ProPublicaFetchError);
  // A 200 whose body is not a search answer.
  await assert.rejects(searchNonprofits("q", fakeFetch(200, undefined, { badJson: true })), ProPublicaFetchError);
  await assert.rejects(searchNonprofits("q", fakeFetch(200, { organizations: [ORG] })), ProPublicaFetchError);
  await assert.rejects(searchNonprofits("q", fakeFetch(200, { total_results: 1 })), ProPublicaFetchError);
  // The network itself failing.
  await assert.rejects(searchNonprofits("q", fakeFetch(0, null, { throws: true })), ProPublicaFetchError);
});

test("Codex r2 F1: an empty list is an answer ONLY when the body says total_results 0", async () => {
  // A count that disagrees with an empty list — the shape that reached the self-heal delete.
  await assert.rejects(searchNonprofits("q", fakeFetch(200, { total_results: 1, organizations: [] })), ProPublicaFetchError);
  // An error field alongside answer-shaped fields, at 200 and at a rejected status.
  await assert.rejects(searchNonprofits("q", fakeFetch(200, { total_results: 0, organizations: [], error: "rate limited" })), ProPublicaFetchError);
  await assert.rejects(searchNonprofits("q", fakeFetch(429, { total_results: 0, organizations: [] })), ProPublicaFetchError);
  await assert.rejects(searchNonprofits("q", fakeFetch(503, { total_results: 2, organizations: [ORG, ORG] })), ProPublicaFetchError);
  // A 200 that says zero results is still the self-heal's answer.
  assert.deepEqual(await searchNonprofits("q", fakeFetch(200, { total_results: 0, organizations: [] })), []);
});

test("Codex r2 F1: a filing without a numeric tax year, or an error body, is a failure", async () => {
  await assert.rejects(getFilings(1, fakeFetch(200, { filings_with_data: [{}] })), ProPublicaFetchError);
  await assert.rejects(getFilings(1, fakeFetch(200, { filings_with_data: [{ tax_prd_yr: 2023 }, { totrevenue: 5 }] })), ProPublicaFetchError);
  await assert.rejects(getFilings(1, fakeFetch(200, { filings_with_data: [], error: "x" })), ProPublicaFetchError);
});

test("B-021 p2 sibling: a failed filings fetch throws instead of [] (which wrote the foundation as $0 grants)", async () => {
  assert.deepEqual(await getFilings(731574370, fakeFetch(200, { filings_with_data: [{ tax_prd_yr: 2023 }] })), [{ tax_prd_yr: 2023 }]);
  assert.deepEqual(classifyFilingsResponse(200, { filings_with_data: [] }), { kind: "answer", filings: [] });
  for (const status of [404, 429, 500]) {
    await assert.rejects(getFilings(1, fakeFetch(status, {})), ProPublicaFetchError);
  }
  await assert.rejects(getFilings(1, fakeFetch(200, { organization: {} })), ProPublicaFetchError);
  await assert.rejects(getFilings(1, fakeFetch(200, undefined, { badJson: true })), ProPublicaFetchError);
  await assert.rejects(getFilings(1, fakeFetch(0, null, { throws: true })), ProPublicaFetchError);
});

// Wire-up. The client proves nothing if fetch:990 keeps its own lenient fetchers or its catch stops
// being the STOP. Comments are stripped first so a sentence ABOUT the old code cannot satisfy or
// fail an assertion (the 2026-09 "source assertion matched the prose" lesson).
const fetcherSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "propublica-990.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("wire-up: fetch:990 imports the throwing client and defines no fetcher of its own", () => {
  assert.match(fetcherSrc, /import\s*\{[^}]*\bsearchNonprofits\b[^}]*\bgetFilings\b[^}]*\bProPublicaFetchError\b[^}]*\}\s*from\s*"\.\/propublica-client"/);
  assert.doesNotMatch(fetcherSrc, /async function (searchNonprofits|getFilings)\b/);
  assert.doesNotMatch(fetcherSrc, /if\s*\(\s*!res\.ok\s*\)\s*return\s*\[\]/);
});

test("wire-up: the self-heal delete runs only on an empty ANSWER, and the catch writes nothing", () => {
  // The B-020 self-heal is still there, inside the empty-foundations branch.
  assert.match(fetcherSrc, /if\s*\(\s*foundations\.length\s*===\s*0\s*\)\s*\{[\s\S]*?\.delete\(personFacts\)/);
  // The catch block: no delete, no insert — the STOP leaves the stored fact as it was.
  const catchBody = fetcherSrc.slice(fetcherSrc.lastIndexOf("} catch (err) {"));
  const end = catchBody.indexOf("\n  }\n");
  const body = catchBody.slice(0, end);
  assert.match(body, /instanceof ProPublicaFetchError/);
  assert.doesNotMatch(body, /\.delete\(|\.insert\(/);
});
