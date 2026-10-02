/**
 * Recompute every person's PBS and write a score_snapshot.
 *
 * TWO THINGS THIS FILE LEARNED ON 2026-08-19, both the hard way:
 *
 * 1. It had NO `isMain` guard and no function at all — the whole body ran at module scope, so
 *    *importing* this file re-scored and wrote 1,092 rows. CLAUDE.md asserts every job script is
 *    behind `isMain(import.meta.url)`; this was one of six that were not. `score-all-guard.test.ts`
 *    now fails any prod-writing script in this package that lacks the guard, so the invariant is
 *    enforced rather than asserted.
 *
 * 2. It could only score EVERYONE. After the B-033 merge, exactly two people had a stale grade
 *    (their fact set grew, `sourceCount` with it), and the only available fix was to rewrite all
 *    1,092 snapshots — a far larger blast radius than the problem. `SCORE_PERSON_IDS_FILE` now
 *    pins the run, mirroring `SUMMARY_PERSON_IDS_FILE` in profile-summary.ts.
 *
 * **The pin's ABSENCE means "score everyone", so its presence must be read in the log line every
 * run, never assumed.** Before any pinned prod run, point it at a bogus uuid and confirm
 * `0 of N persons` — that proves the arg arrives, which is the KP-93 lesson a safety flag exists to
 * satisfy.
 */
import { createDb } from "@ba/db";
import { scoreSnapshots, persons, personFacts } from "@ba/db";
import { computePbs, PBS_VERSION } from "@ba/shared";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { extractPbsSignals } from "./pbs-signals";
import { isMain } from "./is-main";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  const allPersons = await db.select().from(persons);
  const allFacts = await db.select().from(personFacts);

  // Targeted re-score. Falls back to the full run when the env var is absent — so the log line
  // below is the only thing that distinguishes a pinned run from an unpinned one. Read it.
  let personList = allPersons;
  const idFile = process.env.SCORE_PERSON_IDS_FILE;
  if (idFile) {
    const want = new Set<string>(JSON.parse(readFileSync(idFile, "utf8")));
    const full = personList.length;
    personList = personList.filter((p) => want.has(p.id));
    console.log(`Targeted re-score via SCORE_PERSON_IDS_FILE: ${personList.length} of ${full} persons`);
  } else {
    console.log("UNPINNED — scoring every person (SCORE_PERSON_IDS_FILE not set).");
  }
  console.log(`Scoring ${personList.length} persons with PBS ${PBS_VERSION}...`);

  // Group facts by person once (avoids a per-person query).
  const factsByPerson = new Map<string, typeof allFacts>();
  for (const f of allFacts) {
    if (!factsByPerson.has(f.personId)) factsByPerson.set(f.personId, []);
    factsByPerson.get(f.personId)!.push(f);
  }

  const today = new Date().toISOString().split("T")[0];
  const gradeHist: Record<string, number> = {};

  for (const person of personList) {
    const facts = factsByPerson.get(person.id) ?? [];
    const signals = extractPbsSignals(person, facts);
    const { pbs, features } = computePbs(signals);

    await db
      .insert(scoreSnapshots)
      .values({
        personId: person.id,
        date: today,
        pbs: String(pbs.toFixed(2)),
        features,
        sources: [],
      })
      .onConflictDoUpdate({
        target: [scoreSnapshots.personId, scoreSnapshots.date],
        set: { pbs: String(pbs.toFixed(2)), features },
      });

    await db
      .update(persons)
      .set({ lastScoredAt: new Date() })
      .where(eq(persons.id, person.id));

    // rough grade tally for the run summary (bands live in @ba/shared)
    const g = pbs >= 60 ? "A" : pbs >= 45 ? "B" : pbs >= 30 ? "C" : pbs >= 15 ? "D" : "F";
    gradeHist[g] = (gradeHist[g] ?? 0) + 1;
  }

  console.log(`Scoring complete (PBS ${PBS_VERSION}, 0–100 scale).`);
  console.log(`Grade distribution: ${["A", "B", "C", "D", "F"].map((g) => `${g}:${gradeHist[g] ?? 0}`).join(" ")}`);
  await db.$client.end();
}

if (isMain(import.meta.url)) await main();
