/**
 * Wikidata Billionaire Seeder
 *
 * Queries Wikidata for people with net worth (P2218) >= $1B and any U.S. connection,
 * then upserts them into the persons table. Run once to populate, then periodically
 * to pick up new entries.
 *
 * Usage: npm run seed:wikidata (or: tsx src/fetchers/wikidata-seed.ts)
 */

import { createDb, persons } from "@ba/db";
import { wikimediaThumbUrl } from "./wikimedia-utils";
import { resolveBirthYear } from "./wikidata-birth-year";
import { findMergeDuplicate } from "../person-match";
import { isMain } from "../is-main";

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

interface BillionaireResult {
  person: { value: string };
  personLabel: { value: string };
  netWorth: { value: string };
  image?: { value: string };
  description?: { value: string };
  birthDate?: { value: string };
  birthPrecision?: { value: string };
  genderLabel?: { value: string };
  countryLabel?: { value: string };
}

async function sparqlQuery(query: string): Promise<any[]> {
  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "BillionaireArmy/0.1 (civic accountability platform; contact: hello@skylarkcreations.com)",
      Accept: "application/sparql-results+json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SPARQL query failed: ${res.status} ${res.statusText}\n${text}`);
  }
  const data: any = await res.json();
  return data.results.bindings;
}

function extractWikidataId(uri: string): string {
  return uri.split("/").pop() || uri;
}

async function discoverBillionaires(): Promise<BillionaireResult[]> {
  // Find people with net worth >= 1 billion USD.
  // Look for U.S. connections: citizenship, residence, headquarters, or birthplace.
  // Two queries: one for U.S. citizens/residents, one for people with U.S. business presence.

  const query = `
    SELECT DISTINCT ?person ?personLabel ?netWorth ?image ?description ?birthDate ?birthPrecision ?genderLabel ?countryLabel ?stateLabel
    WHERE {
      ?person wdt:P2218 ?netWorth.
      FILTER(?netWorth >= 1000000000)

      # Must have some U.S. connection
      {
        ?person wdt:P27 wd:Q30.       # U.S. citizen
      } UNION {
        ?person wdt:P551 ?residence.   # place of residence
        ?residence wdt:P17 wd:Q30.     # in the U.S.
      } UNION {
        ?person wdt:P19 ?birthPlace.   # born in
        ?birthPlace wdt:P17 wd:Q30.    # the U.S.
      } UNION {
        # Founder or CEO of a company headquartered in the U.S.
        ?person (wdt:P112|wdt:P169) ?company.
        ?company wdt:P159 ?hq.
        ?hq wdt:P17 wd:Q30.
      }

      OPTIONAL { ?person wdt:P18 ?image. }
      OPTIONAL { ?person schema:description ?description. FILTER(LANG(?description) = "en") }
      # The PRECISION is load-bearing: YEAR() over a century-precision date returned 2000 for
      # "born in the 20th century" (B-037 preview, 2026-09-26). birthYearFromWikidata() reads both.
      OPTIONAL {
        ?person p:P569 ?birthStatement.
        # BestRank = the statements wdt: would have returned (preferred if any, else normal).
        ?birthStatement a wikibase:BestRank; psv:P569 ?birthNode.
        ?birthNode wikibase:timeValue ?birthDate; wikibase:timePrecision ?birthPrecision.
      }
      OPTIONAL { ?person wdt:P21 ?gender. ?gender rdfs:label ?genderLabel. FILTER(LANG(?genderLabel) = "en") }
      OPTIONAL { ?person wdt:P27 ?country. ?country rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "en") }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?netWorth)
  `;

  console.log("Querying Wikidata for billionaires with U.S. connections...");
  return await sparqlQuery(query);
}

async function seedBillionaires() {
  const results = await discoverBillionaires();
  console.log(`Found ${results.length} results from Wikidata\n`);

  // Deduplicate by Wikidata ID (SPARQL can return multiple rows per person from UNION). Birth
  // statements are COLLECTED across all of a person's rows first: keeping only the first row made
  // the stored year depend on row order when a person carries more than one P569 statement.
  const seen = new Map<string, BillionaireResult>();
  const birthStatements = new Map<string, Array<{ timeValue?: string; precision?: string }>>();
  for (const r of results) {
    const id = extractWikidataId(r.person.value);
    if (!seen.has(id)) {
      seen.set(id, r);
    }
    if (r.birthDate?.value) {
      const list = birthStatements.get(id) ?? [];
      list.push({ timeValue: r.birthDate.value, precision: r.birthPrecision?.value });
      birthStatements.set(id, list);
    }
  }

  console.log(`${seen.size} unique billionaires after deduplication\n`);

  // B-009 guard: load existing rows so we can skip INSERTing a person who already
  // exists under a different Wikidata Q-id (onConflictDoNothing only catches an
  // exact Q-id match; a second Wikidata entity for the same human would otherwise
  // re-create a duplicate the dedupe tool just merged away). Father/son pairs are
  // protected by classify() inside findMergeDuplicate (they return EXCLUDE).
  const existingPersons = await db
    .select({ name: persons.name, birthYear: persons.birthYear })
    .from(persons);

  let created = 0;
  let existing = 0;
  let dupSkipped = 0;

  for (const [wikidataId, data] of seen) {
    const name = data.personLabel.value;

    // Skip if name is just the Q-ID (unresolved label)
    if (name.startsWith("Q") && /^Q\d+$/.test(name)) {
      console.log(`  - ${wikidataId}: skipping (no English label)`);
      continue;
    }

    const netWorthNum = parseFloat(data.netWorth.value);
    const images: string[] = [];
    if (data.image?.value) {
      images.push(wikimediaThumbUrl(data.image.value));
    }

    const gender = data.genderLabel?.value || null;
    const country = data.countryLabel?.value || null;
    const birthYear = resolveBirthYear(birthStatements.get(wikidataId) ?? []);

    // Determine U.S. presence entries
    const usPresence: { type: string; details: string }[] = [];
    if (country === "United States of America") {
      usPresence.push({ type: "residence", details: "United States" });
    }

    // B-009: this Q-id is new (onConflictDoNothing would insert), but the PERSON
    // may already exist under a different Q-id or name spelling. Skip if so.
    const dupOf = findMergeDuplicate({ name, birthYear }, existingPersons);
    if (dupOf) {
      console.log(`  ~ ${name} (${wikidataId}) — skip, already present as "${dupOf.name}"`);
      dupSkipped++;
      continue;
    }

    try {
      const [inserted] = await db
        .insert(persons)
        .values({
          wikidataId,
          name,
          birthYear,
          country: country === "United States of America" ? "US" : country,
          state: null,
          gender,
          images,
          industry: [],
          usPresence: usPresence.length > 0 ? usPresence : [{ type: "other", details: "U.S. economic presence" }],
          badges: { givingPledge: false, claimedPage: false, goalAdopted: false },
        })
        .onConflictDoNothing({ target: persons.wikidataId })
        .returning();

      if (inserted) {
        const netWorthFormatted = netWorthNum >= 1e9
          ? `$${(netWorthNum / 1e9).toFixed(1)}B`
          : `$${(netWorthNum / 1e6).toFixed(0)}M`;
        console.log(`  + ${name} (${wikidataId}) — ${netWorthFormatted}`);
        created++;
        // Keep the in-memory set current so two distinct Q-ids for the same
        // person in ONE run don't both insert.
        existingPersons.push({ name, birthYear });
      } else {
        console.log(`  = ${name} (${wikidataId}) — already exists`);
        existing++;
      }
    } catch (err) {
      console.error(`  ! ${name} (${wikidataId}): ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nSeed complete: ${created} new, ${existing} existing, ${dupSkipped} skipped (dup of existing person under another Q-id/spelling)`);
  console.log("Run 'npm run fetch:wikidata' next to enrich with photos, net worth facts, and descriptions.");
  process.exit(0);
}

// Guarded 2026-08-19: a bare call here meant IMPORTING this file wrote to prod.
if (isMain(import.meta.url)) seedBillionaires();
