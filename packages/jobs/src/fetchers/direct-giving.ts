/**
 * Direct-Giving Importer (R-007)
 *
 * Writes a `total_giving` person_fact for each curated, sourced direct-giving
 * entry (see direct-giving-data.ts). PBS v2 reads it as the annualized giving
 * numerator when it exceeds 990 foundation disbursement — crediting direct-only
 * philanthropists (LLC/DAF/direct gifts leave no 990) the scorer used to zero out.
 *
 * Idempotent: delete-before-insert on (person_id, fact_key='total_giving').
 * After running this, re-score with `npm run score:all` so the change lands.
 *
 * Usage: npm run import:direct-giving (or: tsx src/fetchers/direct-giving.ts)
 * No API key required.
 */

import { createDb, personFacts } from "@ba/db";
import { sql } from "drizzle-orm";
import {
  DIRECT_GIVING,
  DIRECT_GIVING_AS_OF_YEAR,
  annualizedGiving,
  findPersonId,
} from "./direct-giving-data";
import { isMain } from "../is-main";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

async function importDirectGiving() {
  console.log("=== Direct-Giving Import (R-007) ===\n");
  console.log(`Curated entries: ${DIRECT_GIVING.length}`);
  console.log(`Annualization as-of year: ${DIRECT_GIVING_AS_OF_YEAR}\n`);

  const allPersons = (await db.execute(sql`
    SELECT id, name FROM persons
  `)) as { id: string; name: string }[];
  console.log(`Persons in DB: ${allPersons.length}\n`);

  const now = new Date();
  let inserted = 0;
  const unmatched: string[] = [];

  for (const e of DIRECT_GIVING) {
    const personId = findPersonId(e.name, allPersons);
    if (!personId) {
      unmatched.push(e.name);
      continue;
    }

    const annual = Math.round(annualizedGiving(e));

    await db.execute(sql`
      DELETE FROM person_facts
      WHERE person_id = ${personId} AND fact_key = 'total_giving'
    `);

    await db.insert(personFacts).values({
      personId,
      factType: "philanthropy",
      factKey: "total_giving",
      factValue: {
        cumulativeGiving: e.cumulativeUsd,
        annualGiving: annual,
        sinceYear: e.sinceYear,
        periodLabel: e.periodLabel,
        source: e.sourceName,
        note: e.note ?? null,
      },
      sourceUrl: e.sourceUrl,
      sourceType: "direct_giving",
      retrievedAt: now,
      estimationMethod: "manual_curated",
    });
    inserted++;

    const cum = (e.cumulativeUsd / 1e9).toFixed(1);
    const ann = (annual / 1e9).toFixed(2);
    console.log(`  + ${e.name} — $${cum}B ${e.periodLabel} (≈$${ann}B/yr) [${e.sourceName}]`);
  }

  if (unmatched.length) {
    console.log(`\nUnmatched (no confident person match — skipped, not forced):`);
    for (const n of unmatched) console.log(`  - ${n}`);
  }

  console.log(`\nDirect-giving import complete: ${inserted} total_giving facts written.`);
  console.log(`Next: npm run score:all  (so PBS picks up the new giving signal)`);
  process.exit(0);
}

// Guarded 2026-08-19: a bare call here meant IMPORTING this file wrote to prod.
if (isMain(import.meta.url)) importDirectGiving();
