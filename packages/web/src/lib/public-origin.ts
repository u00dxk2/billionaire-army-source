// The PUBLIC origin a server redirect must point at — never `new URL(request.url).origin`.
//
// THE DEFECT THIS CLOSES (found 2026-09-27, sign-up audit). Behind Render's proxy,
// `next start` builds `request.url` from its own bind address, so inside a route
// handler `new URL(request.url).origin` is `https://localhost:3000`. /auth/callback
// used that origin for BOTH its redirects, so every email-confirmation click that
// exchanged its code successfully was sent to https://localhost:3000/ — a browser
// SSL error on the new member's own machine, at the exact moment they joined.
// Observed live: GET /auth/callback?error=… answered 307 Location
// https://localhost:3000/login?error=auth. The GoTrue side (Site URL + redirect
// allowlist) was verified correct on 2026-08-08, which is why reading the SUPABASE
// config kept finding a clean flow: the last hop was ours.
//
// Rule: take the host the browser actually used (x-forwarded-host, else host) ONLY
// when it is one of our known public hosts; otherwise fall back to SITE_URL. A
// forged header can therefore only ever pick another of OUR hosts, never an
// attacker's, and an unknown or missing header lands on the production domain.

import { SITE_URL } from "./site";

/** Hosts that serve this app publicly. localhost is honoured only outside production. */
function allowedHosts(nodeEnv: string | undefined): Set<string> {
  const hosts = new Set<string>([
    new URL(SITE_URL).host,
    "billionaire.army",
    "ba-web-1d2a.onrender.com",
  ]);
  if (nodeEnv !== "production") {
    hosts.add("localhost:3000");
    hosts.add("127.0.0.1:3000");
  }
  return hosts;
}

/** First value of a possibly comma-joined proxy header, lower-cased and trimmed. */
function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}

/**
 * Resolve the origin a redirect should use. Pure: pass the request headers and
 * NODE_ENV in, get an origin string (no trailing slash) out. Never returns a host
 * outside the allowlist.
 */
export function publicOrigin(
  headers: { get(name: string): string | null },
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const allowed = allowedHosts(nodeEnv);
  const host =
    firstHeaderValue(headers.get("x-forwarded-host")) ?? firstHeaderValue(headers.get("host"));
  if (host && allowed.has(host)) {
    const isLocal = host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
    return `${isLocal ? "http" : "https"}://${host}`;
  }
  return SITE_URL;
}
