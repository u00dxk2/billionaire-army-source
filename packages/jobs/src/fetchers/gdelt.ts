/**
 * GDELT 2.0 DOC API Fetcher
 *
 * Primary broad news source — free, no API key, no stated rate limits.
 * Searches for articles mentioning each billionaire by exact quoted name.
 * Stores results as person_facts with factType "media", factKey "gdelt_articles".
 *
 * Maximizes value from the free API:
 * - Fetches up to 250 articles per person (API max)
 * - Extracts article body snippets from top articles via direct HTTP fetch
 * - Validates relevance (last name in title)
 * - Stores top 15 validated articles with body snippets where available
 *
 * Built to survive shared-IP rate limiting (GitHub Actions runners get 429'd
 * hard by GDELT, so a full 1,083-person sweep rarely fits in one run):
 * - Persons are processed stalest-first (never-fetched first), so successive
 *   runs rotate through the whole corpus instead of re-grinding the same names
 * - Every attempt is recorded as a fact (even zero-article results), so the
 *   stalest-first ordering actually advances
 * - GDELT_TIME_BUDGET_MINUTES (default 150) triggers a clean summary + exit 0
 *   before the workflow-level timeout kills the job
 *
 * API docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 * Base URL: https://api.gdeltproject.org/api/v2/doc/doc
 * Max records: 250 per query. Rolling 3-month window.
 *
 * Usage: npm run fetch:gdelt (or: tsx src/fetchers/gdelt.ts)
 * No API key required.
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, sql } from "drizzle-orm";
import { coverageWindow } from "@ba/shared";
import { isMain } from "../is-main";
import { extractLastName, COMMON_LAST_NAMES } from "./name-utils";

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

// How many top articles to fetch body snippets for (HTTP requests, but free)
const BODY_FETCH_LIMIT = 5;
// Max chars of body to extract and store
const BODY_SNIPPET_LENGTH = 800;
// How many validated articles to store per person
const ARTICLES_TO_STORE = 15;
// Stop fetching after this many minutes and exit cleanly with a summary
const TIME_BUDGET_MINUTES = Number(process.env.GDELT_TIME_BUDGET_MINUTES || "150");
// How many times to retry a 429'd GDELT call before giving up on the person
const MAX_RATE_LIMIT_RETRIES = 2;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }

const db = createDb(databaseUrl);

interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry?: string;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

/**
 * Parse GDELT date format "20260312T143000Z" -> "2026-03-12"
 */
function parseGdeltDate(seendate: string): string {
  if (!seendate || seendate.length < 8) return "";
  return `${seendate.slice(0, 4)}-${seendate.slice(4, 6)}-${seendate.slice(6, 8)}`;
}

/**
 * Fetch article body snippet by loading the article URL directly.
 * Extracts text content, strips HTML, returns first N chars.
 * Returns null on any failure — this is best-effort.
 */
async function fetchBodySnippet(articleUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(articleUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BillionaireArmy/0.1; +https://billionairearmy.com)",
        "Accept": "text/html",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();

    // Simple HTML to text: strip tags, decode common entities, collapse whitespace
    const text = html
      // Remove script and style blocks
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Remove all HTML tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim();

    if (text.length < 100) return null; // Too short, probably not article content

    return text.slice(0, BODY_SNIPPET_LENGTH);
  } catch {
    return null; // Timeout, network error, etc. — skip silently
  }
}

async function fetchArticles(personName: string): Promise<{
  articles: {
    title: string;
    url: string;
    source: string;
    date: string;
    image: string | null;
  }[];
  totalResults: number;
}> {
  // Maximize: 250 records (API max), sorted by date, English sources
  const query = `"${personName}" sourcelang:english`;
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: "250",
    sort: "DateDesc",
    timespan: "3m",
  });

  const url = `${GDELT_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "BillionaireArmy/0.1" },
  });

  if (!res.ok) {
    throw new Error(`GDELT error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as GdeltResponse;
  const results = data.articles || [];

  return {
    articles: results.map((a) => ({
      title: a.title,
      url: a.url,
      source: a.domain,
      date: parseGdeltDate(a.seendate),
      image: a.socialimage || null,
    })),
    totalResults: results.length,
  };
}

/**
 * fetchArticles with retry on 429 — shared runner IPs get rate limited
 * constantly, and waiting out the backoff usually succeeds.
 */
async function fetchArticlesWithRetry(personName: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchArticles(personName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") && attempt < MAX_RATE_LIMIT_RETRIES) {
        console.log(`    429 rate limited — waiting 30s (retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})...`);
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Replace the person's GDELT fact (delete-before-insert). Called for every
 * completed attempt — including zero-article results — so retrieved_at
 * advances and the stalest-first rotation moves on to other persons.
 */
async function saveGdeltFact(
  personId: string,
  personName: string,
  factValue: Record<string, unknown>
) {
  await db.delete(personFacts).where(
    and(eq(personFacts.personId, personId), eq(personFacts.factKey, "gdelt_articles"))
  );

  await db.insert(personFacts).values({
    personId,
    factType: "media",
    factKey: "gdelt_articles",
    factValue,
    sourceUrl: `https://api.gdeltproject.org/api/v2/doc/doc?query="${encodeURIComponent(personName)}"&mode=ArtList`,
    sourceType: "gdelt",
    retrievedAt: new Date(),
    estimationMethod: "gdelt",
  });
}

/**
 * Deduplicate articles by domain — prefer one article per source for diversity.
 * Among articles from the same domain, keep the most recent.
 */
function deduplicateBySource(articles: {
  title: string;
  url: string;
  source: string;
  date: string;
  image: string | null;
}[]): typeof articles {
  const seen = new Map<string, typeof articles[0]>();
  const unique: typeof articles = [];

  for (const article of articles) {
    const domain = article.source.toLowerCase();
    if (!seen.has(domain)) {
      seen.set(domain, article);
      unique.push(article);
    }
  }
  return unique;
}

async function importAll() {
  const allPersons = await db.execute(sql`
    SELECT p.id, p.name, p.wikidata_id,
           COALESCE(s.pbs, 0) as pbs
    FROM persons p
    LEFT JOIN LATERAL (
      SELECT pbs FROM score_snapshots
      WHERE person_id = p.id
      ORDER BY date DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT retrieved_at FROM person_facts
      WHERE person_id = p.id AND fact_key = 'gdelt_articles'
      ORDER BY retrieved_at DESC LIMIT 1
    ) gf ON true
    ORDER BY gf.retrieved_at ASC NULLS FIRST, s.pbs DESC NULLS LAST
  `);

  const personList = allPersons as any[];
  console.log(`GDELT: Fetching news for ${personList.length} persons (stalest coverage first, ${TIME_BUDGET_MINUTES}m budget)...\n`);

  const startedAt = Date.now();
  let fetched = 0;
  let skipped = 0;
  let errors = 0;
  let bodiesFetched = 0;
  let processed = 0;
  let budgetHit = false;

  for (const person of personList) {
    if (Date.now() - startedAt > TIME_BUDGET_MINUTES * 60_000) {
      budgetHit = true;
      break;
    }
    processed++;
    const nameParts = person.name.split(" ");
    if (nameParts.length < 2) {
      console.log(`  - ${person.name}: skipping (need first + last name)`);
      skipped++;
      continue;
    }

    const lastName = extractLastName(person.name);

    if (COMMON_LAST_NAMES.has(lastName)) {
      console.log(`  - ${person.name}: skipping (common last name "${lastName}")`);
      skipped++;
      continue;
    }

    console.log(`  Fetching ${person.name} (PBS: ${Number(person.pbs).toFixed(1)})...`);

    try {
      const { articles, totalResults } = await fetchArticlesWithRetry(person.name);

      // Validate: last name must appear in article title
      const relevantArticles = articles.filter((a) => {
        const title = a.title.toLowerCase();
        return title.includes(lastName);
      });

      if (relevantArticles.length === 0) {
        console.log(
          articles.length === 0
            ? `    No articles found`
            : `    ${articles.length} articles found but none mention "${lastName}" in title`
        );
        // Record the empty attempt so rotation advances past this person
        await saveGdeltFact(person.id, person.name, {
          articles: [],
          totalResults,
          validatedResults: 0,
          topSources: [],
          dateRange: "",
        });
        skipped++;
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      // Deduplicate by source for diversity, take top N
      const diverse = deduplicateBySource(relevantArticles);
      const topArticles = diverse.slice(0, ARTICLES_TO_STORE);

      // Fetch body snippets for the top articles (free HTTP fetches)
      const articlesWithBodies: {
        title: string;
        body: string | null;
        url: string;
        source: string;
        date: string;
        image: string | null;
      }[] = [];

      let bodyCount = 0;
      for (const article of topArticles) {
        let body: string | null = null;
        if (bodyCount < BODY_FETCH_LIMIT) {
          body = await fetchBodySnippet(article.url);
          if (body) bodyCount++;
          // Small delay between page fetches
          await new Promise((r) => setTimeout(r, 200));
        }
        articlesWithBodies.push({ ...article, body });
      }
      bodiesFetched += bodyCount;

      // Source breakdown
      const sourceCount: Record<string, number> = {};
      for (const a of articlesWithBodies) {
        sourceCount[a.source] = (sourceCount[a.source] || 0) + 1;
      }
      const topSources = Object.entries(sourceCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      const factValue = {
        articles: articlesWithBodies,
        totalResults,
        validatedResults: relevantArticles.length,
        topSources,
        // min/max, NOT the first and last ELEMENTS: GDELT orders by relevance, so positional
        // endpoints are arbitrary and produced a backward or understated window on 20 of 34
        // judged profiles (2026-09-09). Shared with newsapi.ts and the profile render.
        dateRange: coverageWindow(articlesWithBodies.map((a) => a.date)),
      };

      await saveGdeltFact(person.id, person.name, factValue);

      console.log(`    + ${articlesWithBodies.length}/${totalResults} articles (${relevantArticles.length} validated, ${bodyCount} with body) from ${topSources.length} sources`);
      fetched++;

      // Polite delay between GDELT API calls
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Error: ${msg} — person stays stale, retried next run`);
      errors++;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const elapsedMin = Math.round((Date.now() - startedAt) / 60_000);
  console.log(`\nGDELT import ${budgetHit ? `stopped at ${TIME_BUDGET_MINUTES}m time budget` : "complete"} (${elapsedMin}m elapsed):`);
  console.log(`  ${processed}/${personList.length} persons processed${budgetHit ? ` — remaining ${personList.length - processed} are stalest next run` : ""}`);
  console.log(`  ${fetched} persons enriched with news`);
  console.log(`  ${bodiesFetched} article body snippets extracted`);
  console.log(`  ${skipped} skipped (no articles, common name, or no title match)`);
  console.log(`  ${errors} errors`);
  process.exit(0);
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
