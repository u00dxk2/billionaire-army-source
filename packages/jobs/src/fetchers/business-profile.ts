/**
 * Business-Profile Importer (R-015 increment 2)
 *
 * Writes a `business_profile` person_fact for each curated, sourced entry in
 * business-data.ts — the plain-language "what their company actually does"
 * layer the profile page renders as a Business section. Covers marquee
 * profiles; extend business-data.ts to grow coverage (the fact shape is
 * source-agnostic, so a future Wikidata/long-tail pass writes the same shape).
 *
 * Idempotent: delete-before-insert on (person_id, fact_key='business_profile').
 *
 * Usage: npm run import:business (or: tsx src/fetchers/business-profile.ts)
 * No API key required.
 */

import { createDb, personFacts } from "@ba/db";
import { sql } from "drizzle-orm";
import { BUSINESS_PROFILES } from "./business-data";
import { findPersonId } from "./direct-giving-data";
import { isMain } from "../is-main";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

async function importBusinessProfiles() {
  console.log("=== Business-Profile Import (R-015) ===\n");
  console.log(`Curated entries: ${BUSINESS_PROFILES.length}\n`);

  const allPersons = (await db.execute(sql`
    SELECT id, name FROM persons
  `)) as { id: string; name: string }[];
  console.log(`Persons in DB: ${allPersons.length}\n`);

  const now = new Date();
  let inserted = 0;
  const unmatched: string[] = [];

  for (const entry of BUSINESS_PROFILES) {
    const personId = findPersonId(entry.name, allPersons);
    if (!personId) {
      unmatched.push(entry.name);
      continue;
    }

    await db.execute(sql`
      DELETE FROM person_facts
      WHERE person_id = ${personId} AND fact_key = 'business_profile'
    `);

    await db.insert(personFacts).values({
      personId,
      factType: "business",
      factKey: "business_profile",
      factValue: { businesses: entry.businesses },
      sourceUrl: entry.businesses[0].sourceUrl,
      sourceType: "curated_business",
      retrievedAt: now,
      estimationMethod: "manual_curated",
    });
    inserted++;

    console.log(
      `  + ${entry.name} — ${entry.businesses.map((b) => b.company).join(", ")}`
    );
  }

  if (unmatched.length) {
    console.log(`\nUnmatched (no confident person match — skipped, not forced):`);
    for (const n of unmatched) console.log(`  - ${n}`);
  }

  console.log(`\nBusiness-profile import complete: ${inserted} facts written.`);
  process.exit(0);
}

// Guarded 2026-08-19: a bare call here meant IMPORTING this file wrote to prod.
if (isMain(import.meta.url)) importBusinessProfiles();
