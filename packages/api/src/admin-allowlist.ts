/**
 * Is this user id an admin, given this raw ADMIN_USER_IDS value? (R-042)
 *
 * Its own module, not a function inside auth.ts, for the reason auth.test.ts
 * discovered the hard way: auth.ts calls createClient() at module scope, so
 * merely IMPORTING it throws without Supabase env — the same import-side-effect
 * shape the jobs scripts are guarded against. A gate that cannot be imported
 * cannot be tested, which is part of why this one sat UNKNOWN.
 *
 * The admin gate is two hops: (1) does a bearer token resolve to a userId,
 * (2) is that userId on the allowlist. Only hop 1 needs a real account. Hop 2 is
 * a string decision and it is the half that encodes "fails closed when unset",
 * so it is pinned in admin-allowlist.test.ts. The residual unknown is therefore
 * one integration hop — the two OBSERVED TOGETHER against a deployed route —
 * not the whole gate.
 */
export function isAdminUserId(
  userId: string | undefined | null,
  raw: string | undefined
): boolean {
  const allow = (raw || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return false; // unset/empty => nobody, never everybody
  if (!userId) return false;
  return allow.includes(userId);
}
