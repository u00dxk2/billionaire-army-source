/**
 * NewsAPI.ai (Event Registry) Fetcher
 *
 * Quality supplement to GDELT — provides sentiment analysis and curated sources.
 * Uses tiered rotation to conserve API tokens:
 *   - Tier 1 (top 100 by PBS): every run
 *   - Tier 2 (next 300): every 3rd run
 *   - Tier 3 (remaining ~680): every 10th run
 *
 * Run counter is tracked via a state file. Each run processes ~100-400 persons
 * instead of all 1,083, reducing API usage by 60-90%.
 *
 * Validates articles at fetch time (last name must appear in title) to prevent
 * false positives — no more post-hoc cleanup needed.
 *
 * API docs: https://newsapi.ai/documentation
 * Rate limit: depends on plan. Free tier ~100 requests/day.
 *
 * Usage: npm run fetch:news (or: tsx src/fetchers/newsapi.ts)
 * Requires: NEWSAPI_KEY environment variable
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { coverageWindow } from "@ba/shared";
import { isMain } from "../is-main";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractLastName } from "./name-utils";
import { selectProfileArticles, PROFILE_RELEVANCE_FLOOR } from "./newsapi-relevance";

const NEWSAPI_BASE = "https://newsapi.ai/api/v1";

// Tier thresholds (by rank in PBS-ordered list)
const TIER_1_SIZE = 100; // Every run
const TIER_2_SIZE = 300; // Every 3rd run
// Tier 3 = the rest  // Every 10th run

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.NEWSAPI_KEY;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!apiKey) { console.error("NEWSAPI_KEY is required"); process.exit(1); }

const db = createDb(databaseUrl);

// State file to track run count for tiered rotation
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, ".newsapi-run-count.json");

function getRunCount(): number {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      return data.runCount || 0;
    }
  } catch { /* ignore */ }
  return 0;
}

function saveRunCount(count: number) {
  writeFileSync(STATE_FILE, JSON.stringify({ runCount: count, lastRun: new Date().toISOString() }));
}

interface NewsArticle {
  title: string;
  body?: string;
  url: string;
  source: { title: string; uri: string };
  dateTimePub: string;
  image?: string;
  sentiment?: number;
  relevance?: number;
}

interface NewsApiResponse {
  articles?: {
    results?: NewsArticle[];
    totalResults?: number;
  };
}

async function fetchArticles(personName: string): Promise<{
  articles: {
    title: string;
    body: string | null;
    url: string;
    source: string;
    date: string;
    image: string | null;
    sentiment: number | null;
  }[];
  totalResults: number;
}> {
  const body = {
    action: "getArticles",
    keyword: `"${personName}"`, // Quoted for exact phrase match
    articlesPage: 1,
    // 100, not 20 (B-028, owner-approved 2026-08-11). This is the load-bearing half
    // of the fix and it is measured, not chosen: at 20 an accountability floor empties
    // 4-5 of 8 profiles, at 100 it empties none at any floor 1..5. The binding
    // constraint on a relevance gate here was SUPPLY, not the filter. Same request
    // count, so this costs bandwidth rather than billing.
    articlesCount: 100,
    articlesSortBy: "date",
    articlesSortByAsc: false,
    articlesArticleBodyLen: 500, // First 500 chars of body — enough for AI context without excessive bandwidth
    resultType: "articles",
    dataType: ["news"],
    lang: "eng",
    apiKey,
  };

  const res = await fetch(`${NEWSAPI_BASE}/article/getArticles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BillionaireArmy/0.1",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`NewsAPI error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as NewsApiResponse;
  const results = data.articles?.results || [];

  return {
    articles: results.map((a) => ({
      title: a.title,
      body: a.body || null,
      url: a.url,
      source: a.source?.title || "Unknown",
      date: a.dateTimePub?.split("T")[0] || "",
      image: a.image || null,
      sentiment: a.sentiment ?? null,
    })),
    totalResults: data.articles?.totalResults || 0,
  };
}

async function importAll() {
  const runCount = getRunCount();
  const currentRun = runCount + 1;

  // Determine which tiers to process this run
  const processTier1 = true; // Always
  // ponytail: NEWSAPI_ALL_TIERS=1 forces a full sweep instead of waiting for run #30.
  // B-028 "run the rest" (the owner, 2026-08-21) needed tiers 2+3 now, not in 29 runs.
  const allTiers = process.env.NEWSAPI_ALL_TIERS === "1";
  const processTier2 = allTiers || currentRun % 3 === 0;
  const processTier3 = allTiers || currentRun % 10 === 0;

  const tierLabel = [
    "Tier 1 (top 100)",
    processTier2 ? "Tier 2 (next 300)" : null,
    processTier3 ? "Tier 3 (remaining)" : null,
  ].filter(Boolean).join(" + ");

  console.log(`NewsAPI run #${currentRun} — processing: ${tierLabel}\n`);

  // Get all persons, ordered by PBS score (highest first)
  const allPersons = await db.execute(sql`
    SELECT p.id, p.name, p.wikidata_id,
           COALESCE(s.pbs, 0) as pbs
    FROM persons p
    LEFT JOIN LATERAL (
      SELECT pbs FROM score_snapshots
      WHERE person_id = p.id
      ORDER BY date DESC LIMIT 1
    ) s ON true
    ORDER BY s.pbs DESC NULLS LAST
  `);

  const personList = allPersons as any[];

  // Select persons based on tier
  let toProcess: any[] = [];
  for (let i = 0; i < personList.length; i++) {
    if (i < TIER_1_SIZE) {
      toProcess.push(personList[i]);
    } else if (i < TIER_1_SIZE + TIER_2_SIZE && processTier2) {
      toProcess.push(personList[i]);
    } else if (i >= TIER_1_SIZE + TIER_2_SIZE && processTier3) {
      toProcess.push(personList[i]);
    }
  }

  // ponytail: NEWSAPI_ONLY_NAMES="A|B" re-fetches just those people, mirroring
  // SUMMARY_PERSON_IDS_FILE. Lets a targeted repair skip ~1,000 needless API reads.
  const onlyNames = process.env.NEWSAPI_ONLY_NAMES;
  if (onlyNames) {
    const wanted = new Set(onlyNames.split("|").map((n) => n.trim()).filter(Boolean));
    toProcess = toProcess.filter((row) => wanted.has(row.name));
    console.log(`NEWSAPI_ONLY_NAMES: narrowed to ${toProcess.length} of ${wanted.size} requested name(s)`);
  }

  console.log(`Processing ${toProcess.length} of ${personList.length} persons this run\n`);

  let fetched = 0;
  let skipped = 0;
  // Every person the loop `continue`s past, kept so the summary can report the state of
  // the set this run did NOT touch. See the summary block at the bottom for why.
  const skippedPersons: { id: string; name: string }[] = [];
  let filtered = 0;
  let errors = 0;

  for (const person of toProcess) {
    const nameParts = person.name.split(" ");
    if (nameParts.length < 2) {
      console.log(`  - ${person.name}: skipping (need first + last name)`);
      skippedPersons.push({ id: person.id, name: person.name });
      skipped++;
      continue;
    }

    const lastName = extractLastName(person.name);

    // B-028: the common-surname SKIP that used to sit here is GONE. It guarded the OLD gate
    // (`title.includes(lastName)`), where "Johnson" matched thousands of unrelated people.
    // selectProfileArticles() now also requires the FIRST name in title-or-body, so that
    // collision is handled upstream. MEASURED 2026-08-22, read-only probe over 8 of the 53
    // skipped persons: ZERO wrong-person keeps across Johnson/Smith/Scott/Wang/Jones/Lee/Moore.
    // Keeping the skip was strictly worse — those 53 sat on their pre-fix March 2026 ungated
    // facts, MacKenzie Scott among them, whose re-fetch keeps 10 real receipts ($26B
    // philanthropy, $55M in donated homes). Known residual, same class as this row's
    // investing-advice leak: a sports story dense in on-axis vocabulary can clear floor 3
    // ("Magic Johnson Says LeBron James...").
    console.log(`  Fetching ${person.name} (PBS: ${Number(person.pbs).toFixed(1)})...`);

    try {
      const { articles, totalResults } = await fetchArticles(person.name);

      // The fetch SUCCEEDED, so from here on this person's stale fact is replaced or
      // removed — never left standing. See the delete below.
      const sel = selectProfileArticles(articles, lastName, person.name);
      const topArticles = sel.kept;
      console.log(
        `    ${sel.returned} returned · ${sel.namedOut} not named · ${sel.belowFloor} below axis floor ${PROFILE_RELEVANCE_FLOOR}` +
          (sel.duplicates > 0 ? ` · ${sel.duplicates} duplicate event(s)` : "") +
          ` → ${topArticles.length} kept`
      );

      // B-028: DELETE UNCONDITIONALLY, then insert only if something survived.
      //
      // This is the half of the owner's instruction that is easy to lose — "remove the
      // inappropriate news". The previous code `continue`d past the delete whenever
      // zero articles survived, so a person whose re-fetch found nothing on-axis KEPT
      // their existing junk forever. That is the opposite of self-heal, and it is why
      // a re-fetch alone would have looked like it worked while leaving the worst
      // profiles untouched. SEC and 990 both delete stale facts on a no-match re-run;
      // this fetcher now does too. The delete sits AFTER a successful fetch inside the
      // try, so an API failure still leaves existing data alone.
      await db.delete(personFacts).where(
        and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "news_headlines"))
      );

      if (topArticles.length === 0) {
        console.log(`    nothing on-axis — stale news fact DELETED (self-heal), nothing inserted`);
        filtered++;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      const now = new Date();

      // Compute sentiment from validated articles only
      const sentimentScores = topArticles
        .filter((a) => a.sentiment !== null)
        .map((a) => a.sentiment as number);
      const avgSentiment = sentimentScores.length > 0
        ? sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length
        : null;

      // Source breakdown
      const sourceCount: Record<string, number> = {};
      for (const a of topArticles) {
        sourceCount[a.source] = (sourceCount[a.source] || 0) + 1;
      }
      const topSources = Object.entries(sourceCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      const factValue = {
        articles: topArticles,
        totalResults,
        validatedResults: topArticles.length,
        averageSentiment: avgSentiment,
        topSources,
        // min/max, NOT the first and last ELEMENTS — same defect and same fix as gdelt.ts.
        dateRange: coverageWindow(topArticles.map((a) => a.date)),
      };

      await db.insert(personFacts).values({
        personId: person.id,
        factType: "media",
        factKey: "news_headlines",
        factValue,
        sourceUrl: `https://newsapi.ai/`,
        sourceType: "newsapi",
        retrievedAt: now,
        estimationMethod: "newsapi",
      });

      const sentLabel = avgSentiment !== null
        ? ` (sentiment: ${avgSentiment > 0 ? "+" : ""}${avgSentiment.toFixed(2)})`
        : "";
      console.log(`    + ${topArticles.length}/${totalResults} articles kept from ${topSources.length} sources${sentLabel}`);
      fetched++;

      // Rate limit: conservative 1.5s between requests
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Error: ${msg}`);
      errors++;

      // If rate limited, back off
      if (msg.includes("429") || msg.includes("rate")) {
        console.log("    Rate limited — waiting 30s...");
        await new Promise((r) => setTimeout(r, 30000));
      }
    }
  }

  // Save run counter
  saveRunCount(currentRun);

  console.log(`\nNewsAPI run #${currentRun} complete:`);
  console.log(`  ${fetched} persons enriched`);
  console.log(`  ${filtered} filtered (no relevant articles)`);
  // A COMPLETION NUMBER COMPUTED OVER THE PROCESSED SET SAYS NOTHING ABOUT THE SET THAT WAS
  // SKIPPED BEFORE PROCESSING. On 2026-08-22 this run printed '95 enriched / 924 emptied /
  // 73 skipped / 0 errors' and read as complete, while 53 of those 73 were still serving the
  // March-2026 ungated corpus B-028 was filed about — MacKenzie Scott among them. The skip
  // sits BEFORE the fetch, so a skipped person is never re-fetched and never self-heals; the
  // count alone hides that entirely. So the summary reports the RESIDUAL STATE of the
  // continue-set, not just its size. Any new `continue` added above this loop's write owes
  // the same treatment.
  let residual = "";
  if (skippedPersons.length > 0) {
    const stale = await db
      .select({ retrievedAt: personFacts.retrievedAt })
      .from(personFacts)
      .where(
        and(
          eq(personFacts.factKey, "news_headlines"),
          inArray(
            personFacts.personId,
            skippedPersons.map((s) => s.id)
          )
        )
      );
    const oldest = stale
      .map((r) => new Date(r.retrievedAt).toISOString().slice(0, 10))
      .sort()[0];
    residual = ` (${stale.length} still carry a news fact${oldest ? `, oldest retrieved_at ${oldest}` : ""})`;
  }
  console.log(`  ${skipped} skipped${residual}`);
  console.log(`  ${errors} errors`);
  console.log(`  Next full sweep (all tiers): run #${Math.ceil(currentRun / 10) * 10}`);
  process.exit(0);
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
