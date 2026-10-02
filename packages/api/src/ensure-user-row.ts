import { users } from "@ba/db";
import type { Db } from "@ba/db";

/**
 * Guarantee the caller's `users` row exists, SERVER-side, on every authenticated
 * request (R-043).
 *
 * Every authenticated write (comment, vote, rating, proposal) is FK'd to
 * `public.users`, and the row used to be created only when a CLIENT remembered to
 * POST /api/users/sync first. Nine components did, none checked the response,
 * and a failed or skipped sync surfaced as a foreign-key 500 from the NEXT call —
 * which is how every write for a brand-new user broke once (B-017) with nothing
 * saying so. A server-side invariant enforced by nine clients is nine chances to
 * get it wrong; here it is one insert that cannot be skipped.
 *
 * ON CONFLICT DO NOTHING on the primary key makes it idempotent and safe for two
 * concurrent first requests. Its own module, not inline in auth.ts, because auth.ts
 * calls createClient() at module scope and cannot be imported by a test (the
 * admin-allowlist.ts reason).
 *
 * ponytail: one PK insert per authenticated request, no in-process cache.
 * authenticate() already pays a network call to Supabase per request, so this is
 * marginal; a cache would also go stale if a users row were ever deleted under a
 * live process. Add one only if authenticated traffic makes the insert measurable.
 */
export async function ensureUserRow(
  db: Db,
  user: { id: string; email?: string | null }
): Promise<void> {
  // users.email is NOT NULL. This project only issues email/password and
  // magic-link accounts, so an email-less user should not exist; if one ever
  // does, insert nothing and let the write fail exactly as it did before.
  if (!user.email) return;

  await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email,
      displayName: user.email.split("@")[0],
    })
    .onConflictDoNothing({ target: users.id });
}
