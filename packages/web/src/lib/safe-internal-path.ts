// The ONE guard for any redirect destination that comes from a user-supplied value
// (`?next=`, a future `?returnTo=`). Point every redirect sink at this — a guard
// written inline in one route handler is the thing the next route forgets to call.
//
// The defect it closes (fleet sweep, 2026-09-16): /auth/callback built its
// destination as `${origin}${next}`, so `?next=@evil.com` concatenates to
// `https://billionaire.army@evil.com` — the parser reads everything before the
// at-sign as USERINFO and the host is evil.com. Executed against the WHATWG parser
// on a byte-identical row in another lane, not reasoned about.
//
// Shape borrowed deliberately from the strongest guard in the fleet,
// agentic-news `apps/web/lib/navigation/returnTo.ts`, which found the
// normalisation bypass on 2026-09-13. Read that before "simplifying" this one.
//
// NOTE ON DECODING, which is why checking raw characters is enough: the caller
// passes `searchParams.get("next")`, and that getter has ALREADY percent-decoded.
// `?next=/%09/evil.com` arrives here as a real tab and `?next=/%5Cevil.com` as a
// real backslash, both of which the browser would later strip or normalise into
// `//evil.com`. So the checks below run on the decoded value, where those bytes
// are visible. A caller that hands this the still-encoded string gets a weaker
// check than it looks like.

const INTERNAL_ORIGIN = "https://internal.invalid";

/**
 * Returns `candidate` when it is a safe same-origin path, else `fallback`.
 * FAILS CLOSED: a rejected value never passes through, and the caller never sees
 * the attacker's string. Query and hash on an accepted path are preserved.
 */
export function safeInternalPath(
  candidate: string | null | undefined,
  fallback = "/"
): string {
  const value = (candidate ?? "").trim();

  // Must be an absolute path on this origin. Also what rejects "@evil.com",
  // "https://evil.com" and "evil.com".
  if (!value.startsWith("/")) return fallback;
  // Protocol-relative: "//evil.com" is an external URL to every parser.
  if (value.startsWith("//")) return fallback;

  // Backslashes and C0 control characters (tab, newline, CR included) BEFORE
  // parsing: browsers normalise "\" to "/" and strip tabs/newlines while parsing,
  // so "/\evil.com" and "/\t/evil.com" become "//evil.com" AFTER the checks above
  // have passed. Rejected outright rather than normalised. Checked by code point
  // so the control range needs no lint exception.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x5c || code < 0x20 || code === 0x7f) return fallback;
  }

  // Belt and braces: whatever the parser does, the resolved URL must still be on
  // our origin AND its NORMALISED pathname must not be protocol-relative. A dot
  // segment ("/.//evil.com", "/safe/..//evil.com") keeps the origin internal while
  // normalising the pathname to "//evil.com", which a later hard navigation treats
  // as off-site. No legitimate internal path normalises to "//".
  try {
    const resolved = new URL(value, INTERNAL_ORIGIN);
    if (resolved.origin !== INTERNAL_ORIGIN) return fallback;
    if (resolved.pathname.startsWith("//")) return fallback;
  } catch {
    return fallback;
  }

  return value;
}
