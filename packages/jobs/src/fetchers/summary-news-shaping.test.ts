import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newsFactForPrompt } from "./summary-fact-collapse";
import { buildUserPrompt } from "./summary-prompt";

/**
 * B-060. Shaped like Ankur Jain's stored `news_headlines` fact on 2026-09-25, whose summary read
 * "The supplied NewsAPI results include two validated articles published from July 22 to July 27,
 * 2026". Every field below except `articles` is our retrieval bookkeeping, and every one of them came
 * back as prose about our pipeline somewhere in the 948-summary corpus.
 */
const JAIN_NEWS = {
  articles: [
    {
      title: "Ankur Jain steps down from B9 Beverages board",
      body: "Ankur Jain has stepped down from the board…",
      url: "https://example.com/a",
      source: "Indian Television Dot Com",
      date: "2026-07-22",
      image: "https://example.com/a.jpg",
      sentiment: -0.12,
    },
    { title: "Anicut takes control of Jain stake", body: null, url: "https://example.com/b", source: "The Economic Times", date: "2026-07-27", image: null, sentiment: 0.02 },
  ],
  totalResults: 17,
  validatedResults: 2,
  averageSentiment: -0.05,
  topSources: [{ name: "The Economic Times", count: 1 }],
  dateRange: "2026-07-22 to 2026-07-27",
};

const person = (facts: { factKey: string; factValue: unknown; sourceType: string | null }[]) => ({
  name: "Ankur Jain",
  state: null,
  industry: [],
  birthYear: null,
  country: null,
  facts,
});

test("the news fact reaches the model as ARTICLES ONLY — no counts, 'validated', sentiment or derived window", () => {
  const shaped = newsFactForPrompt("news_headlines", JAIN_NEWS) as { articles: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(shaped), ["articles"]);
  assert.equal(shaped.articles.length, 2);
  for (const a of shaped.articles) {
    assert.deepEqual(Object.keys(a).sort(), ["body", "date", "source", "title", "url"]);
  }
  // The outlet survives — it is what a journalist attributes to.
  assert.equal(shaped.articles[1].source, "The Economic Times");
});

test("an EMPTY article list drops the fact — the source of 'No validated news articles were provided'", () => {
  const empty = { articles: [], totalResults: 6, validatedResults: 0, topSources: [], dateRange: "" };
  assert.equal(newsFactForPrompt("gdelt_articles", empty), null);
  assert.equal(newsFactForPrompt("news_headlines", { totalResults: 3 }), null);
});

test("non-news facts and non-object values pass through byte-identical", () => {
  const fec = { count: 3, totalAmount: 100 };
  assert.equal(newsFactForPrompt("fec_contributions", fec), fec);
  assert.equal(newsFactForPrompt("news_headlines", "plain"), "plain");
});

test("WIRE-UP: buildUserPrompt applies it (a helper test alone stays green if nobody calls it)", () => {
  const prompt = buildUserPrompt(person([
    { factKey: "news_headlines", factValue: JAIN_NEWS, sourceType: "newsapi" },
    { factKey: "gdelt_articles", factValue: { articles: [], totalResults: 6, validatedResults: 0 }, sourceType: "gdelt" },
  ]));
  for (const leaked of ["validatedResults", "totalResults", "averageSentiment", "topSources", "dateRange", "sentiment"]) {
    assert.ok(!prompt.includes(leaked), `prompt must not carry ${leaked}`);
  }
  assert.ok(prompt.includes("The Economic Times"));
  assert.ok(!prompt.includes("GDELT ARTICLES"), "an empty GDELT fact must not reach the model at all");
});

test("the generator prompt attributes to the SOURCE and forbids narrating the input (B-060)", () => {
  const src = readFileSync(new URL("./profile-summary.ts", import.meta.url), "utf8");
  const prompt = src.slice(src.indexOf("const SYSTEM_PROMPT"), src.indexOf("const FAITHFULNESS_SYSTEM_PROMPT"));
  assert.ok(/never to the process that gathered it/.test(prompt), "the journalist attribution frame is the fix");
  assert.ok(/never write "supplied", "provided"/.test(prompt), "the explicit ban on narrating the input");
  assert.ok(!/supported by the data provided/.test(prompt), "the 2026-03 framing that invited 'the provided data' must stay gone");
  // A REAL outlet name in an example gets copied: the first draft said "Fortune reported…" and the model
  // attributed Charlie Ergen's MobileX story to Fortune, which appears nowhere in his records.
  assert.ok(/EXACTLY as it appears in that article's "source" field/.test(prompt));
  assert.ok(!/(Fortune|Reuters|Economic Times|Bloomberg|Wall Street Journal) reported/.test(prompt), "no real outlet in an example");
  // Pinned verbatim so the fix cannot silently rewrite rules other checks read (probe-fec-cap, check:party-sum).
  assert.ok(prompt.includes('write "at least N", and say the figures cover only the sampled records.'));
  assert.ok(prompt.includes("A party breakdown is ALL of partyBreakdownUsd or none of it."));
});
