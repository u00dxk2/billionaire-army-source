/**
 * Data Cleanup Script
 *
 * 1. Remove non-billionaires (fictional characters, etc.)
 * 2. Deduplicate person_facts (keep most recent per personId+factType+factKey)
 *
 * Usage: npm run cleanup (or: tsx src/cleanup.ts)
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { isMain } from "./is-main";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }

const db = createDb(databaseUrl);

// Known non-billionaires to remove (Wikidata IDs)
const REMOVE_WIKIDATA_IDS = [
  "Q716636", // Mr. Burns (The Simpsons fictional character)
];

async function removeNonBillionaires() {
  console.log("=== Removing non-billionaires ===\n");

  for (const qid of REMOVE_WIKIDATA_IDS) {
    const result = await db
      .delete(persons)
      .where(eq(persons.wikidataId, qid))
      .returning({ name: persons.name });

    if (result.length > 0) {
      console.log(`  Removed: ${result[0].name} (${qid})`);
    } else {
      console.log(`  Not found: ${qid} (already removed or never existed)`);
    }
  }

  // Also flag persons with suspicious names (for manual review)
  const allPersons = await db.select({ id: persons.id, name: persons.name, wikidataId: persons.wikidataId }).from(persons);
  const suspicious = allPersons.filter(p => {
    const name = p.name.toLowerCase();
    return (
      name.includes("mr. ") ||
      name.includes("mrs. ") ||
      name.includes("fictional") ||
      name.includes("the ") ||
      name.length < 3
    );
  });

  if (suspicious.length > 0) {
    console.log(`\n  Suspicious entries (review manually):`);
    for (const p of suspicious) {
      console.log(`    - ${p.name} (${p.wikidataId || "no QID"})`);
    }
  }

  console.log();
}

async function deduplicatePersonFacts() {
  console.log("=== Deduplicating person_facts ===\n");

  // Find duplicates: same personId + factType + factKey with multiple rows
  const dupes = await db.execute(sql`
    WITH ranked AS (
      SELECT
        id,
        person_id,
        fact_type,
        fact_key,
        retrieved_at,
        ROW_NUMBER() OVER (
          PARTITION BY person_id, fact_type, fact_key
          ORDER BY retrieved_at DESC NULLS LAST, created_at DESC
        ) AS rn
      FROM person_facts
      -- B-045 C2: quarantine rows are one-per-event history, not duplicates; newest-wins would erase them.
      WHERE fact_key <> 'summary_quarantine'
    )
    SELECT id FROM ranked WHERE rn > 1
  `);

  const dupeIds = (dupes as any[]).map((r: any) => r.id);

  if (dupeIds.length === 0) {
    console.log("  No duplicate facts found.\n");
    return;
  }

  // Delete in batches of 100
  let deleted = 0;
  for (let i = 0; i < dupeIds.length; i += 100) {
    const batch = dupeIds.slice(i, i + 100);
    await db.delete(personFacts).where(inArray(personFacts.id, batch));
    deleted += batch.length;
  }

  console.log(`  Removed ${deleted} duplicate fact rows (kept most recent per person+type+key).\n`);
}

async function showStats() {
  console.log("=== Current stats ===\n");

  const personCount = await db.execute(sql`SELECT COUNT(*) as count FROM persons`);
  const factCount = await db.execute(sql`SELECT COUNT(*) as count FROM person_facts`);
  const factBreakdown = await db.execute(sql`
    SELECT fact_type, fact_key, COUNT(*) as count
    FROM person_facts
    GROUP BY fact_type, fact_key
    ORDER BY count DESC
  `);

  const pc = (personCount as any[])[0];
  const fc = (factCount as any[])[0];
  console.log(`  Persons: ${pc.count}`);
  console.log(`  Facts: ${fc.count}`);
  console.log(`\n  Fact breakdown:`);
  for (const row of factBreakdown as any[]) {
    console.log(`    ${row.fact_type}/${row.fact_key}: ${row.count}`);
  }
  console.log();
}

async function main() {
  console.log("Billionaire Army — Data Cleanup\n");

  await showStats();
  await removeNonBillionaires();
  await deduplicatePersonFacts();
  await showStats();

  console.log("Cleanup complete!");
  process.exit(0);
}

// Only run when this file IS the entrypoint. Importing it must never execute
// the script — these scripts mutate prod. See is-main.ts.
if (isMain(import.meta.url)) main();
