import { createDb, persons, personFacts } from "@ba/db";
import { eq, and } from "drizzle-orm";
import { isMain } from "../is-main";
import { wikimediaThumbUrl } from "./wikimedia-utils";

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

// Plausibility ceiling for a single person's net worth (USD): reject obvious vandalism /
// mis-parses (e.g. a stray extra digit, or a company market-cap pasted as personal wealth)
// rather than overwrite a good fact on a receipts platform.
//
// Re-derived from the real top-of-list (B-006, 2026-06-19): the world #1 is Elon Musk at
// ~$1.14T after SpaceX's Nasdaq IPO (CNBC, 2026-06-12 close $160.95) — he is the first-ever
// trillionaire. The original $500B ceiling was wrong: it would have rejected reality (his
// pre-IPO Forbes figure was already ~$780B, which is what the "vandalized" Wikidata edit
// actually reflected). Set the ceiling to ~2x the current #1 — generous headroom for a
// legitimate record high, while still catching order-of-magnitude vandalism.
const MAX_PLAUSIBLE_NET_WORTH_USD = 2_500e9;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

interface WikidataResult {
  image?: { value: string };
  netWorth?: { value: string };
  description?: { value: string };
  deathDate?: { value: string };
}

async function sparqlQuery(query: string): Promise<any[]> {
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "BillionaireArmy/0.1 (civic accountability platform)" },
  });
  if (!res.ok) {
    throw new Error(`SPARQL query failed: ${res.status} ${res.statusText}`);
  }
  const data: any = await res.json();
  return data.results.bindings;
}

async function fetchPersonData(wikidataId: string): Promise<WikidataResult | null> {
  const query = `
    SELECT ?image ?netWorth ?description ?deathDate WHERE {
      OPTIONAL { wd:${wikidataId} wdt:P18 ?image. }
      OPTIONAL { wd:${wikidataId} wdt:P2218 ?netWorth. }
      OPTIONAL { wd:${wikidataId} schema:description ?description. FILTER(LANG(?description) = "en") }
      OPTIONAL { wd:${wikidataId} wdt:P570 ?deathDate. }
    }
    LIMIT 1
  `;

  const results = await sparqlQuery(query);
  if (results.length === 0) return null;
  return results[0];
}

async function importAll() {
  const allPersons = await db.select().from(persons);
  console.log(`Found ${allPersons.length} persons to enrich from Wikidata`);

  for (const person of allPersons) {
    if (!person.wikidataId) {
      console.log(`  - ${person.name}: no Wikidata ID, skipping`);
      continue;
    }

    console.log(`  Fetching ${person.name} (${person.wikidataId})...`);

    try {
      const data = await fetchPersonData(person.wikidataId);
      if (!data) {
        console.log(`    No data found`);
        continue;
      }

      const now = new Date();
      const sourceUrl = `https://www.wikidata.org/wiki/${person.wikidataId}`;

      // Update death year (B-013: feed-curator eligibility filter reads this — a person with
      // a death year is excluded from candidate matching so a deceased billionaire's row can't
      // be attached to a news story about events after their death).
      if (data.deathDate?.value) {
        const deathYear = new Date(data.deathDate.value).getFullYear();
        if (Number.isFinite(deathYear) && deathYear !== person.deathYear) {
          await db
            .update(persons)
            .set({ deathYear })
            .where(eq(persons.id, person.id));
          console.log(`    + deathYear: ${deathYear}`);
        }
      }

      // Update image
      if (data.image?.value) {
        const thumbUrl = wikimediaThumbUrl(data.image.value);
        await db
          .update(persons)
          .set({ images: [thumbUrl] })
          .where(eq(persons.id, person.id));
        console.log(`    + image`);
      }

      // Store net worth as a person_fact (delete old first)
      if (data.netWorth?.value) {
        const netWorthNum = parseFloat(data.netWorth.value);

        // Curated-override guard: don't let the automated Wikidata fetcher clobber a net-worth
        // fact that was set from a more authoritative source (real-time index / news), e.g. the
        // manually-curated Musk figure. Such facts carry a sourceType other than "wikidata".
        // (B-006: Wikidata's preferred P2218 for Musk is his stale pre-IPO $790B; without this
        // the scheduled run would overwrite the current ~$1.14T post-IPO figure.)
        const [existingNw] = await db
          .select()
          .from(personFacts)
          .where(and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "net_worth")))
          .limit(1);

        if (existingNw && existingNw.sourceType && existingNw.sourceType !== "wikidata") {
          console.log(
            `    = net_worth kept (curated override, source=${existingNw.sourceType}) — Wikidata value ${data.netWorth.value} ignored`
          );
        } else if (!Number.isFinite(netWorthNum) || netWorthNum > MAX_PLAUSIBLE_NET_WORTH_USD) {
          // Plausibility guard: never overwrite a good fact with an implausible Wikidata value
          // (see MAX_PLAUSIBLE_NET_WORTH_USD). Skip the write entirely so the existing fact stands.
          console.log(
            `    ! net_worth ${data.netWorth.value} fails plausibility guard (> $${(MAX_PLAUSIBLE_NET_WORTH_USD / 1e9).toFixed(0)}B) — skipping, kept existing`
          );
        } else {
          const formatted = netWorthNum >= 1e9
            ? `~$${(netWorthNum / 1e9).toFixed(1)}B`
            : `~$${(netWorthNum / 1e6).toFixed(0)}M`;

          await db.delete(personFacts).where(
            and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "net_worth"))
          );

          await db
            .insert(personFacts)
            .values({
              personId: person.id,
              factType: "net_worth",
              factKey: "net_worth",
              factValue: formatted,
              sourceUrl,
              sourceType: "wikidata",
              retrievedAt: now,
              estimationMethod: "wikidata",
            });
          console.log(`    + net_worth: ${formatted}`);
        }
      }

      // Store description as a fact (delete old first)
      if (data.description?.value) {
        await db.delete(personFacts).where(
          and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "description"))
        );

        await db
          .insert(personFacts)
          .values({
            personId: person.id,
            factType: "bio",
            factKey: "description",
            factValue: data.description.value,
            sourceUrl,
            sourceType: "wikidata",
            retrievedAt: now,
            estimationMethod: "wikidata",
          });
        console.log(`    + description`);
      }

      // Rate limit: be polite to Wikidata
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`    Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("Wikidata import complete!");
  process.exit(0);
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
