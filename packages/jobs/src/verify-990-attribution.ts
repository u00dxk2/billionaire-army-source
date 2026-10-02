/**
 * B-020 post-check: did the attribution fix actually land in prod?
 *
 * READ-ONLY. Run this AFTER `npm run fetch:990` and BEFORE `npm run score:all`
 * — it is the escalate-if gate on the B-020 sequence. If it exits non-zero,
 * STOP and post a blocker; do not rescore on top of unfixed data.
 *
 * Every pair in KNOWN_WRONG was read live from prod on 2026-08-01, was credited
 * to that person, and was feeding their PBS philanthropy score.
 *
 * Usage: npx tsx src/verify-990-attribution.ts
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and } from "drizzle-orm";
import { isMain } from "./is-main";
import { isPlausiblyOwnFoundation } from "./fetchers/foundation-attribution";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(databaseUrl);

/** person name -> a foundation that must NO LONGER be attached to them. */
const KNOWN_WRONG: [string, RegExp][] = [
  ["George Kaiser", /kaiser foundation hospitals/i],
  ["Tom Ford", /^ford foundation$/i],
  ["Gerald Ford", /^ford foundation$/i],
  ["Hamilton E. James", /james irvine foundation/i],
  ["Thomas James", /james irvine foundation/i],
  ["LeBron James", /james irvine foundation/i],
  ["Ryan Israel", /birthright israel foundation/i],
  ["Peter Kellogg", /w k kellogg foundation/i],
  ["Phil Knight", /^knight foundation$/i],
  ["Warren Buffett", /howard g buffett foundation/i],
];

/** Foundations that must STILL be attached — guards against over-correction. */
const MUST_KEEP: [string, RegExp][] = [
  ["Len Blavatnik", /blavatnik family foundation/i],
  ["Bill Gates", /gates foundation/i],
  ["Michael Bloomberg", /bloomberg family foundation/i],
];

async function main() {
  let failures = 0;
  let checked = 0;

  for (const [name, pattern] of KNOWN_WRONG) {
    const rows = await db
      .select({ v: personFacts.factValue })
      .from(personFacts)
      .innerJoin(persons, eq(persons.id, personFacts.personId))
      .where(and(eq(persons.name, name), eq(personFacts.factKey, "foundation_990s")));
    checked++;
    const names: string[] = rows.flatMap((r: any) => (r.v?.foundations ?? []).map((f: any) => String(f.name ?? "")));
    const hit = names.find((n) => pattern.test(n));
    if (hit) {
      failures++;
      console.log(`  ✗ STILL ATTACHED  ${name} <- ${hit}`);
    } else {
      console.log(`  ✓ gone            ${name}  (${names.length} foundation(s) remain)`);
    }
  }

  console.log("");
  for (const [name, pattern] of MUST_KEEP) {
    const rows = await db
      .select({ v: personFacts.factValue })
      .from(personFacts)
      .innerJoin(persons, eq(persons.id, personFacts.personId))
      .where(and(eq(persons.name, name), eq(personFacts.factKey, "foundation_990s")));
    checked++;
    const names: string[] = rows.flatMap((r: any) => (r.v?.foundations ?? []).map((f: any) => String(f.name ?? "")));
    if (names.some((n) => pattern.test(n))) {
      console.log(`  ✓ kept            ${name} <- ${names.find((n) => pattern.test(n))}`);
    } else {
      failures++;
      console.log(`  ✗ OVER-CORRECTED  ${name} lost a foundation that is genuinely theirs`);
    }
  }

  // Whole-index sweep: nothing stored should fail the guard we just shipped.
  const all = await db
    .select({ name: persons.name, v: personFacts.factValue })
    .from(personFacts)
    .innerJoin(persons, eq(persons.id, personFacts.personId))
    .where(eq(personFacts.factKey, "foundation_990s"));
  let residual = 0;
  let totalGrants = 0;
  for (const r of all as any[]) {
    for (const f of r.v?.foundations ?? []) {
      totalGrants += Number(f.grantsPaid ?? 0);
      if (!isPlausiblyOwnFoundation(String(f.name ?? ""), r.name)) {
        residual++;
        if (residual <= 10) console.log(`  ✗ RESIDUAL        ${r.name} <- ${f.name}`);
      }
    }
  }

  console.log(`\nspot checks: ${checked}, failures: ${failures}`);
  console.log(`stored rows still failing the guard: ${residual}`);
  console.log(`credited giving across the index: $${(totalGrants / 1e9).toFixed(2)}B`);

  const ok = failures === 0 && residual === 0;
  console.log(ok ? "\nPASS — safe to rescore." : "\nFAIL — do NOT rescore. Post a blocker.");
  await db.$client.end();
  process.exitCode = ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main();
}
