/**
 * JSON request-body parsing that tolerates an EMPTY body.
 *
 * Fastify's built-in JSON parser rejects an empty body on
 * `Content-Type: application/json` with a 400, and it does so during PARSING —
 * before preHandler — so the route's auth and handler never run.
 *
 * That broke every authenticated write for a brand-new user: the client call
 * sites POST `/api/users/sync` (which creates the user's row in our `users`
 * table) with the JSON content-type and no body, so it 400'd, the row was never
 * created, and the follow-up write then violated the `user_id` foreign key and
 * returned a 500. Treating an empty body as `{}` is the fix — routes that
 * genuinely need fields still zod-parse `{}` and fail with a proper 400.
 */
export function parseJsonBody(body: string): unknown {
  // Whitespace-only counts as empty: a client that writes "\n" means "no body",
  // and JSON.parse would throw on it just as it does on "".
  if (body.trim() === "") return {};
  return JSON.parse(body);
}
