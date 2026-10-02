/**
 * pgboss queue worker.
 *
 * Guarded 2026-08-19: every line below used to run at module scope, so importing this file
 * connected to prod, started a queue consumer, and registered a handler that writes
 * score_snapshots — and a missing DATABASE_URL called `process.exit(1)` on whoever imported it.
 * CLAUDE.md asserts every job script sits behind `isMain(import.meta.url)`; this was one of six
 * that did not. `job-script-guard.test.ts` now enforces it.
 */
import PgBoss from "pg-boss";
import { createDb } from "@ba/db";
import { scoreSnapshots, persons, personFacts } from "@ba/db";
import { computePbs } from "@ba/shared";
import { eq } from "drizzle-orm";
import { extractPbsSignals } from "./pbs-signals";
import { isMain } from "./is-main";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const boss = new PgBoss(databaseUrl);

  await boss.start();
  console.log("pgboss worker started");

  // Score recalculation job
  await boss.work("score.recalculate", async ([job]) => {
    const { personId } = job.data as { personId: string };

    const personRows = await db.select().from(persons).where(eq(persons.id, personId));
    if (personRows.length === 0) {
      console.warn(`score.recalculate: person ${personId} not found`);
      return;
    }
    const facts = await db
      .select()
      .from(personFacts)
      .where(eq(personFacts.personId, personId));

    // Same signal extraction + scoring as the batch scorer (score-all.ts) — kept
    // in @ba/shared + pbs-signals.ts so the two paths can't diverge.
    const signals = extractPbsSignals(personRows[0], facts);
    const { pbs, features } = computePbs(signals);

    const today = new Date().toISOString().split("T")[0];

    await db
      .insert(scoreSnapshots)
      .values({
        personId,
        date: today,
        pbs: String(pbs.toFixed(2)),
        features,
        sources: [],
      })
      .onConflictDoUpdate({
        target: [scoreSnapshots.personId, scoreSnapshots.date],
        set: {
          pbs: String(pbs.toFixed(2)),
          features,
        },
      });

    await db
      .update(persons)
      .set({ lastScoredAt: new Date() })
      .where(eq(persons.id, personId));

    console.log(`Scored ${personId}: PBS=${pbs.toFixed(2)}`);
  });

  console.log("Workers registered. Listening for jobs...");
}

if (isMain(import.meta.url)) await main();
