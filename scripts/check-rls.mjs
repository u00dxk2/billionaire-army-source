#!/usr/bin/env node
/**
 * check:rls — does the data layer deny by default? (engineering-health standard rule 10)
 *
 * B-018, 2026-07-29: the PUBLIC anon key held SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all
 * 15 public tables — RLS off, 0 policies — because Supabase's stock bootstrap runs
 * `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`
 * and this repo's tables are created by Drizzle migrations over a direct connection. Nobody
 * chose the grant, and nothing surfaced it because the app never queries Supabase from the
 * client (auth only).
 *
 * The success criterion is NOT "rowsecurity is true" — it is "the public key from the prod
 * bundle can no longer read or write the rows." So the load-bearing half of this check is an
 * actual HTTP request with the anon key. The DB half needs DATABASE_URL and is skipped
 * without it; the anon half needs only public config and always runs.
 *
 * Run: npm run check:rls
 * Exit: 0 = denies by default · 1 = EXPOSED · 2 = could not run (missing config)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// Sensitive by content, not exhaustive — the DB half below enumerates every table, which is
// what catches a NEW table arriving unprotected. These four are the ones whose exposure the
// review actually demonstrated, so they stay pinned by name.
const PROBE_TABLES = ["persons", "users", "feed_comments", "person_facts"];
const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("check:rls: need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  console.error("           These are PUBLIC values; export them (e.g. from .env) before running.");
  process.exit(2);
}

const failures = [];

// --- Half 1: the real criterion. Can the public key read the rows? ---
console.log("anon-key reads (the public key from the prod bundle):");
for (const table of PROBE_TABLES) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
  let res;
  try {
    res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.log(`  ${table.padEnd(16)} UNREACHABLE (${err.message}) — treating as inconclusive`);
    failures.push(`${table}: probe unreachable, exposure UNKNOWN`);
    continue;
  }

  // 200 with an empty array is a PASS: RLS is on and no policy grants anon a row. 401/403 is
  // also a pass (privilege revoked outright — this repo's chosen posture, since Supabase is
  // used for auth only and nothing needs anon table access).
  if (res.status === 401 || res.status === 403) {
    console.log(`  ${table.padEnd(16)} HTTP ${res.status} — denied (privilege revoked)`);
    continue;
  }
  if (res.ok) {
    const rows = await res.json().catch(() => null);
    const n = Array.isArray(rows) ? rows.length : null;
    if (n === 0) {
      console.log(`  ${table.padEnd(16)} HTTP 200, 0 rows — denied (RLS, no matching policy)`);
    } else {
      console.log(`  ${table.padEnd(16)} HTTP 200, ${n ?? "?"} row(s) — ** EXPOSED **`);
      failures.push(`${table}: anon key READ ${n ?? "?"} row(s) over PostgREST`);
    }
    continue;
  }
  console.log(`  ${table.padEnd(16)} HTTP ${res.status} — unexpected, treating as inconclusive`);
  failures.push(`${table}: unexpected HTTP ${res.status}, exposure UNKNOWN`);
}

// --- Half 2: grants + RLS posture across EVERY table (catches a new unprotected table) ---
if (!DATABASE_URL) {
  console.log("\ngrants + RLS sweep: SKIPPED (no DATABASE_URL)");
} else {
  const { default: postgres } = await import("postgres");
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
  try {
    const tables = await sql`
      SELECT tablename, rowsecurity, tableowner FROM pg_tables
      WHERE schemaname = 'public' ORDER BY tablename
    `;
    const rlsOff = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
    console.log(`\nRLS sweep: ${tables.length} tables, ${rlsOff.length} without RLS`);
    if (rlsOff.length) {
      console.log(`  without RLS: ${rlsOff.join(", ")}`);
      failures.push(`RLS disabled on ${rlsOff.length} table(s): ${rlsOff.join(", ")}`);
    }

    const grants = await sql`
      SELECT grantee, privilege_type, count(*)::int AS n
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      GROUP BY grantee, privilege_type
      ORDER BY grantee, privilege_type
    `;
    const writes = grants.filter((g) => WRITE_PRIVS.includes(g.privilege_type));
    const reads = grants.filter((g) => g.privilege_type === "SELECT");
    console.log(`grants to anon/authenticated/PUBLIC: ${grants.length ? "" : "none"}`);
    for (const g of grants) console.log(`  ${g.grantee} ${g.privilege_type} on ${g.n} table(s)`);
    for (const g of writes) {
      failures.push(`${g.grantee} holds ${g.privilege_type} on ${g.n} table(s) — revoke it`);
    }
    for (const g of reads) {
      // A SELECT grant is only safe when RLS is on everywhere to gate it. Given this repo
      // needs NO anon table access at all, flag it rather than reasoning about policies.
      failures.push(`${g.grantee} holds SELECT on ${g.n} table(s) — revoke it (nothing needs it)`);
    }

    // The durability half. Without a default-privileges revoke, the next `npm run db:generate`
    // silently re-grants the new table and this finding re-opens. This is the check that keeps
    // B-018 closed rather than merely fixed once.
    //
    // Scoped to roles that actually OWN tables here, because `ALTER DEFAULT PRIVILEGES` only
    // affects defaults created BY a given role. Supabase ships a `supabase_admin` entry that
    // still grants anon, but `postgres` is not a member of that role so it cannot be altered,
    // and it only applies to objects created by Supabase's own tooling — never by our
    // migrations. Reporting it as a failure would pin this check at exit 1 forever, and a gate
    // that can never read green is one nobody reads. So: fail on the reachable, on-path entries
    // and WARN on the rest. If `supabase_admin` ever starts owning tables in public, the owner
    // set below picks it up and it becomes a failure on its own.
    const defaults = await sql`
      SELECT pg_get_userbyid(d.defaclrole) AS owner, d.defaclacl::text AS acl
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
    `;
    const owners = new Set(tables.map((t) => t.tableowner).filter(Boolean));
    const reGranting = defaults.filter(
      (d) => /\banon=/.test(d.acl || "") || /\bauthenticated=/.test(d.acl || "")
    );
    const onPath = reGranting.filter((d) => owners.has(d.owner));
    const offPath = reGranting.filter((d) => !owners.has(d.owner));

    if (onPath.length) {
      for (const d of onPath) {
        console.log(`default privileges: role ${d.owner} OWNS tables here and still re-grants anon/authenticated`);
        failures.push(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${d.owner} still grants anon/authenticated — the NEXT migration re-exposes`
        );
      }
    } else {
      console.log("default privileges: clean on the migration path (a new table will not be auto-granted)");
    }
    if (offPath.length) {
      const names = offPath.map((d) => d.owner).join(", ");
      console.log(`  note: ${names} also re-grant(s), but own no tables here — unreachable and off our migration path`);
    }
  } finally {
    // A job script that never closes its pool prints NOTHING, not slowly.
    await sql.end();
  }
}

console.log("");
if (failures.length) {
  console.log(`check:rls FAIL — ${failures.length} exposure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("\nFix: packages/db/sql/2026-07-29-revoke-anon-grants.sql (see B-018).");
  // Set exitCode rather than process.exit() — exit() can drop a buffered write on a Windows pipe.
  process.exitCode = 1;
} else {
  console.log("check:rls PASS — the public anon key cannot read or write the rows.");
}
