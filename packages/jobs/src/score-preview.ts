/**
 * R-007 read-only PBS preview. Reads prod persons + facts, computes the CURRENT
 * score (direct giving ignored) vs the PROPOSED score (curated direct giving
 * injected in-memory from direct-giving-data.ts), and prints the before/after
 * for each curated name plus the whole-population grade-distribution shift.
 *
 * Writes NOTHING — no score_snapshots, no person_facts. Use it to calibrate
 * before running `import:direct-giving` + `score:all` for real.
 *
 * Usage: tsx src/score-preview.ts
 */
import { createDb, persons, personFacts } from "@ba/db";
import { computePbs, pbsGrade } from "@ba/shared";
import { extractPbsSignals } from "./pbs-signals";
import {
  DIRECT_GIVING,
  annualizedGiving,
  findPersonId,
} from "./fetchers/direct-giving-data";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

const allPersons = await db.select().from(persons);
const allFacts = await db.select().from(personFacts);

const factsByPerson = new Map<string, typeof allFacts>();
for (const f of allFacts) {
  if (!factsByPerson.has(f.personId)) factsByPerson.set(f.personId, []);
  factsByPerson.get(f.personId)!.push(f);
}

// Map curated entries → personId → annualized direct giving.
const directByPerson = new Map<string, { name: string; annual: number }>();
const personLite = allPersons.map((p) => ({ id: p.id, name: p.name }));
for (const e of DIRECT_GIVING) {
  const id = findPersonId(e.name, personLite);
  if (id) directByPerson.set(id, { name: e.name, annual: annualizedGiving(e) });
}

const band = (n: number) =>
  n >= 60 ? "A" : n >= 45 ? "B" : n >= 30 ? "C" : n >= 15 ? "D" : "F";
const curHist: Record<string, number> = {};
const propHist: Record<string, number> = {};
const moved: string[] = [];

for (const person of allPersons) {
  const facts = factsByPerson.get(person.id) ?? [];
  const base = extractPbsSignals(person, facts);

  // CURRENT = direct giving ignored (matches live scoring before R-007 facts land).
  const cur = computePbs({ ...base, directGivingAnnual: 0 });
  // PROPOSED = inject curated annualized direct giving.
  const inject = directByPerson.get(person.id)?.annual ?? 0;
  const prop = computePbs({ ...base, directGivingAnnual: inject });

  curHist[band(cur.pbs)] = (curHist[band(cur.pbs)] ?? 0) + 1;
  propHist[band(prop.pbs)] = (propHist[band(prop.pbs)] ?? 0) + 1;

  if (band(cur.pbs) !== band(prop.pbs) || Math.abs(cur.pbs - prop.pbs) > 0.5) {
    moved.push(
      `  ${person.name}: ${cur.pbs.toFixed(1)} (${pbsGrade(cur.pbs).letter}) → ` +
        `${prop.pbs.toFixed(1)} (${pbsGrade(prop.pbs).letter})` +
        (inject > 0 ? `  [direct ≈ $${(inject / 1e9).toFixed(2)}B/yr]` : ""),
    );
  }
}

console.log("=== R-007 PBS preview (read-only, no writes) ===\n");
console.log(`Persons: ${allPersons.length}  |  curated direct-giving matched: ${directByPerson.size}/${DIRECT_GIVING.length}\n`);

console.log("Curated direct-giving entries:");
for (const e of DIRECT_GIVING) {
  const id = findPersonId(e.name, personLite);
  console.log(
    `  ${id ? "✓" : "✗ NO MATCH"} ${e.name} — $${(e.cumulativeUsd / 1e9).toFixed(1)}B ${e.periodLabel} (≈$${(annualizedGiving(e) / 1e9).toFixed(2)}B/yr)`,
  );
}

console.log("\nGrade distribution (current → proposed):");
for (const g of ["A", "B", "C", "D", "F"]) {
  console.log(`  ${g}: ${curHist[g] ?? 0} → ${propHist[g] ?? 0}`);
}

console.log(`\nMoved scores (${moved.length}):`);
for (const m of moved) console.log(m);

process.exit(0);
