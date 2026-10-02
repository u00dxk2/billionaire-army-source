/**
 * ProPublica Nonprofit Explorer Fetcher
 *
 * Fetches IRS 990 foundation data for billionaires' philanthropic organizations.
 * Stores results as person_facts with type "philanthropy".
 *
 * API docs: https://projects.propublica.org/nonprofits/api
 * No API key required. Rate limit: be reasonable (~1 req/sec).
 *
 * Usage: npm run fetch:990 (or: tsx src/fetchers/propublica-990.ts)
 */

import { readFileSync } from "node:fs";
import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, or, ne, isNull } from "drizzle-orm";
import { isMain } from "../is-main";
import { isPlausiblyOwnFoundation } from "./foundation-attribution";
import { foundationSearchSurname } from "./name-utils";
import { CURATED_990_METHOD, curated990PersonIdsFrom } from "./foundation-curated-guard";
import { applyTrusteeReview } from "./foundation-trustee-review";
// B-021 prerequisite 2: a failed search or filings fetch THROWS (ProPublicaFetchError) instead of
// returning [] — the [] made a 429/5xx read as "matches nothing", and the self-heal below deleted the
// row. The per-person catch at the bottom of the loop is the STOP. See propublica-client.ts.
import { searchNonprofits, getFilings, ProPublicaFetchError, type NonprofitResult } from "./propublica-client";

// B-068, Codex review of 805d491 (P1): the person-level skip reads the curated set ONCE at run
// start, so a curated row committed mid-run was still deletable. Every delete below therefore
// also excludes curated rows in its own WHERE — no timing can make it remove one. (NULL-safe:
// `ne` alone would never match a row whose method is NULL.)
const notCurated990 = or(isNull(personFacts.estimationMethod), ne(personFacts.estimationMethod, CURATED_990_METHOD));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }

const db = createDb(databaseUrl);

function findFoundations(orgs: NonprofitResult[], personName: string): NonprofitResult[] {
  // B-020: this used to be `name.includes(lastName)` + any charitable keyword,
  // which credited Kaiser Permanente's $30.6B to George Kaiser and the Ford
  // Foundation to a fashion designer. The rule now lives in a pure, tested
  // module — see foundation-attribution.ts for why it is deliberately strict.
  return orgs.filter((org) => isPlausiblyOwnFoundation(org.name, personName));
}

async function importAll() {
  let allPersons = await db.select().from(persons);
  // Targeted repair: FETCH_990_PERSON_IDS_FILE (ABSOLUTE path to a JSON array of person ids) pins
  // the run to those persons, mirroring SUMMARY_PERSON_IDS_FILE / SCORE_PERSON_IDS_FILE. Without it
  // the only way to correct a few facts was to re-fetch and rewrite everyone's. The pin's ABSENCE
  // means "everyone", so read the count line on every run; point it at a bogus uuid first to see
  // "0 of N" before any pinned prod run.
  const idFile = process.env.FETCH_990_PERSON_IDS_FILE;
  if (idFile) {
    // Codex review r2: `new Set(<a JSON string>)` is a set of CHARACTERS and `new Set(null)` is empty —
    // both selected nobody and still printed "import complete". A repair list that does not fully
    // resolve is the WRONG list, so anything but an array of id strings that ALL match is refused.
    const parsed: unknown = JSON.parse(readFileSync(idFile, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((x) => typeof x === "string")) {
      throw new Error(`FETCH_990_PERSON_IDS_FILE must hold a non-empty JSON array of person-id strings — refusing, nothing fetched`);
    }
    const want = new Set(parsed.map((s) => s.trim().toLowerCase()));
    const full = allPersons.length;
    allPersons = allPersons.filter((p) => want.has(p.id.toLowerCase()));
    console.log(`Targeted run via FETCH_990_PERSON_IDS_FILE: ${allPersons.length} of ${full} persons (${want.size} id(s) requested)`);
    if (allPersons.length !== want.size) {
      throw new Error(`only ${allPersons.length} of ${want.size} requested id(s) resolved to a person — refusing, nothing fetched`);
    }
  }
  console.log(`Fetching ProPublica 990 data for ${allPersons.length} persons...\n`);

  let fetched = 0;
  let skipped = 0;
  let stopped = 0;

  // B-068: a hand-curated, officer-verified fact is never deleted or overwritten here — both
  // delete paths below would erase it. See foundation-curated-guard.ts.
  const curated990PersonIds = curated990PersonIdsFrom(
    await db
      .select({ personId: personFacts.personId, estimationMethod: personFacts.estimationMethod })
      .from(personFacts)
      .where(eq(personFacts.factKey, "foundation_990s")),
  );
  console.log(`Curated foundation facts kept as-is: ${curated990PersonIds.size} person(s)`);
  let keptCurated = 0;

  for (const person of allPersons) {
    if (curated990PersonIds.has(person.id)) {
      console.log(`  = ${person.name}: curated 990 fact kept (not searched, not deleted)`);
      keptCurated++;
      continue;
    }

    // Strips ONLY the RTB "& family" suffix (see foundationSearchSurname). A bare split made
    // the query "family foundation" for 59 people, which is how three unrelated charities
    // named "Family Foundation" were attached to all of them (2026-09-30), and it meant their
    // real "<Surname> Foundation" was never even searched for. Every other name searches
    // exactly as before.
    const lastName = foundationSearchSurname(person.name);
    if (!lastName) {
      skipped++;
      continue;
    }

    console.log(`  Searching for ${person.name} foundations...`);

    try {
      // Search for foundations by last name + "foundation"
      const orgs = await searchNonprofits(`${lastName} foundation`);
      // B-021: a trustee-reviewed person keeps only the EINs their evidence supports; none allowed
      // means the self-heal below removes their row. See foundation-trustee-review.ts.
      const foundations = applyTrusteeReview(person.id, findFoundations(orgs, person.name));

      if (foundations.length === 0) {
        // SELF-HEAL (B-020). This used to `continue` before the delete below, so
        // a person who stopped matching kept their old fact FOREVER — which
        // would have made the attribution fix a no-op for exactly the worst
        // cases: Tom Ford now matches nothing and would have quietly kept the
        // Ford Foundation's $918M. The SEC matcher already works this way.
        const [removed] = await db
          .delete(personFacts)
          .where(and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "foundation_990s"), notCurated990))
          .returning();
        console.log(
          removed
            ? `    No matching foundations — REMOVED a stale 990 fact (self-heal)`
            : `    No matching foundations found`
        );
        skipped++;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      const foundationData = [];

      for (const foundation of foundations.slice(0, 3)) {
        const filings = await getFilings(foundation.ein);
        const latestFiling = filings[0];

        foundationData.push({
          name: foundation.name,
          ein: foundation.ein,
          city: foundation.city,
          state: foundation.state,
          // IRS activity classification ("what kind of charity is this") —
          // rendered as a human label on the profile foundation card (R-015).
          nteeCode: foundation.ntee_code || null,
          totalAssets: latestFiling?.totassetsend || foundation.total_assets || 0,
          totalRevenue: latestFiling?.totrevenue || foundation.total_revenue || 0,
          totalExpenses: latestFiling?.totfuncexpns || 0,
          // Charitable disbursements (money given OUT) — the real "giving" signal.
          // totexpnsexempt = expenses for exempt purposes on the 990-PF; fall back
          // to total functional expenses. (The old totcntrbgfts field is a public-
          // charity field that doesn't exist on 990-PF filings, so it stored 0.)
          grantsPaid: latestFiling?.totexpnsexempt || latestFiling?.totfuncexpns || 0,
          taxYear: latestFiling?.tax_prd_yr || null,
        });

        await new Promise((r) => setTimeout(r, 500));
      }

      const now = new Date();
      const totalAssets = foundationData.reduce((sum, f) => sum + f.totalAssets, 0);
      const totalGrants = foundationData.reduce((sum, f) => sum + f.grantsPaid, 0);

      // Delete old 990 fact before inserting fresh data
      await db.delete(personFacts).where(
        and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "foundation_990s"), notCurated990)
      );

      await db
        .insert(personFacts)
        .values({
          personId: person.id,
          factType: "philanthropy",
          factKey: "foundation_990s",
          factValue: {
            foundations: foundationData,
            totalFoundationAssets: totalAssets,
            totalGrantsPaid: totalGrants,
          },
          sourceUrl: `https://projects.propublica.org/nonprofits/search?q=${encodeURIComponent(lastName + " foundation")}`,
          sourceType: "propublica_990",
          retrievedAt: now,
          estimationMethod: "proPublica_990",
        });

      const assetsFormatted = totalAssets >= 1e9
        ? `$${(totalAssets / 1e9).toFixed(1)}B`
        : totalAssets >= 1e6
        ? `$${(totalAssets / 1e6).toFixed(0)}M`
        : `$${totalAssets.toLocaleString()}`;

      console.log(`    + ${foundationData.length} foundation(s), assets: ${assetsFormatted}`);
      fetched++;

      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      // STOP for this person: nothing above has written yet (the delete/insert run only after every
      // fetch succeeded), so a failed ProPublica call leaves the stored fact exactly as it was.
      if (err instanceof ProPublicaFetchError) {
        console.error(`    STOPPED (stored 990 fact kept): ${err.message}`);
        stopped++;
      } else {
        console.error(`    Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\nProPublica 990 import complete: ${fetched} enriched, ${skipped} skipped, ${keptCurated} curated kept, ${stopped} stopped on a failed ProPublica call (stored fact kept)`);
  process.exit(0);
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
