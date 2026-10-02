import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { publicOrigin } from "@/lib/public-origin";

// This route handles the PKCE signup-confirm `?code=` flow ONLY. Recovery and
// magic-link tokens arrive in the URL *fragment*, which is never sent to the
// server — those must land on a client page (`/reset-password`). See CLAUDE.md
// § Auth before pointing any new auth email flow here.
//
// The cookie adapter below looks duplicated in `middleware.ts`, but the two
// CANNOT be shared: this one reads/writes the request-scoped `cookies()` store
// from `next/headers`, while middleware threads cookies through NextRequest and
// rebuilds a NextResponse on every set. Extracting a common helper means one of
// them silently stops persisting the session. An unused `lib/supabase-server.ts`
// helper sat here for exactly that reason and was removed 2026-07-26 — if you
// need this shape again, copy it, don't unify it with middleware.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // NEVER `new URL(request.url).origin` here: behind Render's proxy it is
  // https://localhost:3000, which sent every confirmed new member to a browser SSL
  // error (2026-09-27). publicOrigin() allowlists the host — see lib/public-origin.ts.
  const origin = publicOrigin(request.headers);
  const code = searchParams.get("code");
  // Never concatenated with `origin`: `?next=@evil.com` would make evil.com the
  // HOST (userinfo), which is the open redirect the 2026-09-16 fleet sweep found.
  // safeInternalPath fails closed to "/" — see packages/web/src/lib/safe-internal-path.ts.
  const next = safeInternalPath(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
