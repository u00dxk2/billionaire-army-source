/**
 * Turn a Supabase auth error into something a person can act on.
 *
 * WHY THIS EXISTS. On 2026-08-06 the owner tried to sign up on prod and got a red
 * box containing the two characters `{}` and nothing else. The page was doing
 * `setError(err.message)`, which is correct-looking code — the message really
 * was the string "{}". GoTrue had returned a 500 whose body names the problem
 * ("Error sending confirmation email"), and the client surfaced an empty object
 * instead. So the ONE moment the product had a real failure to explain, it
 * explained nothing, on the page where a stranger decides whether we are
 * competent.
 *
 * The rule: an error string that carries no information is worse than a generic
 * sentence, because the user cannot tell whether they mistyped something or
 * whether we are broken. Never render a raw error through; run it past this.
 */

/** Strings that LOOK like a message but tell the reader nothing. */
function isUseless(msg: string): boolean {
  const t = msg.trim();
  if (t.length === 0) return true;
  if (t === "{}" || t === "[]" || t === "[object Object]" || t === "null" || t === "undefined") return true;
  // A bare JSON object/array that survived stringification is not a sentence.
  if (/^[[{].*[\]}]$/s.test(t) && !/[a-z]{3}\s+[a-z]{3}/i.test(t)) return true;
  return false;
}

const FALLBACK =
  "Something went wrong on our end — this isn't you. Please try again in a minute, and if it keeps happening email hello@skylarkcreations.com.";

/**
 * Extract a usable sentence from whatever the auth client handed back.
 *
 * Deliberately shape-tolerant rather than typed to one client version: GoTrue
 * puts the human text in `msg`, supabase-js normalises it to `message`, and the
 * 8/06 case proved a version can surface neither. Checking several shapes costs
 * nothing and is the difference between a diagnosis and a blank box.
 */
export function authErrorMessage(err: unknown): string {
  if (err == null) return FALLBACK;

  if (typeof err === "string") return isUseless(err) ? FALLBACK : err;

  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const key of ["message", "msg", "error_description", "error", "hint", "details"]) {
      const v = o[key];
      if (typeof v === "string" && !isUseless(v)) return v;
    }
  }

  return FALLBACK;
}
