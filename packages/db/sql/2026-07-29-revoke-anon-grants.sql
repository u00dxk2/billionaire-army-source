-- B-018 / engineering-health finding F1 (standard rule 10) — 2026-07-29
--
-- WHAT WAS WRONG: the PUBLIC anon key (shipped in the client bundle as
-- NEXT_PUBLIC_SUPABASE_ANON_KEY) held SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all 15
-- public-schema tables, with RLS off and 0 policies. Confirmed over the wire: anon reads
-- returned rows from persons/users/feed_comments/person_facts, and a zero-row PATCH returned
-- 204. That made the review_status moderation gate, the feed_comments.flagged soft-hide, the
-- fail-closed ADMIN_USER_IDS allowlist, and every rate limit bypassable, and made every
-- registered users.email an anonymous read.
--
-- ROOT CAUSE: nobody chose this. Supabase's stock bootstrap runs
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role
-- so every table created by a Drizzle migration over a direct connection inherits anon CRUD.
-- Nothing surfaced it because this app uses Supabase for AUTH ONLY.
--
-- WHY REVOKE INSTEAD OF WRITING POLICIES: verified monorepo-wide 2026-07-29 — 25
-- `supabase.auth.*` call sites and 2 `supabaseAdmin.auth.*`, and ZERO `.from()` / `.rpc()` /
-- `.storage` / `.channel()` calls in any package. All data flows through ba-api via Drizzle.
-- Nothing needs anon or authenticated table access, so denying outright is both smaller and
-- stronger than 15 tables of policies.
--
-- HOW TO APPLY (one-time; idempotent, safe to re-run):
--   sh -c 'psql "$DATABASE_URL" -f packages/db/sql/2026-07-29-revoke-anon-grants.sql'
-- then VERIFY with the committed probe (do not accept "it applied" as evidence):
--   npm run check:rls
--
-- NOT registered in the Drizzle journal on purpose: step 2 makes this a one-time posture
-- change, not a step in the schema chain. `npm run check:rls` is what keeps it closed.

BEGIN;

-- 1. Remove the inherited blanket grants. service_role is deliberately NOT touched — ba-api
--    uses it for auth admin ops and it is server-side only (verified: SERVICE_ROLE is not
--    referenced anywhere in packages/web/src, and ba-web's env holds no service key).
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- 0 functions exist in public today (verified); this makes a future one safe by default.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2. THE DURABILITY HALF — without this the next `npm run db:generate` + `db:migrate` creates
--    a table that inherits the grant again and the finding silently re-opens.
--    ALTER DEFAULT PRIVILEGES only affects defaults created BY the named role. Verified: all
--    15 tables are owned by `postgres`, and `postgres` is the role DATABASE_URL connects as,
--    so this is the entry on our migration path.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- KNOWN RESIDUAL, deliberately not addressed here: a second default-ACL entry is owned by
-- `supabase_admin`, and the `postgres` role is not a member of it, so we cannot alter it. It
-- applies only to objects created BY supabase_admin (Supabase's own internal tooling), not to
-- our migrations. `npm run check:rls` reports it if it ever starts mattering.

-- 3. Belt and suspenders: deny by default even if a future GRANT slips past step 2.
--    Table owners bypass RLS in PostgreSQL, and ba-api connects as the owner (`postgres`), so
--    enabling this does NOT affect the application. With 0 policies, anon/authenticated get
--    nothing even if re-granted.
ALTER TABLE public.commitments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_item_persons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_votes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_ratings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_rewrite_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_rewrites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_facts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_updates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes              ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ROLLBACK, if the site breaks (it should not — see "WHY REVOKE" above):
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- That restores the exposure, so treat it as a diagnostic step, not a resting state.
