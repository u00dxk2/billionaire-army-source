/**
 * B-051 — WHEN the voter chose, which is the only ordering the API can trust.
 *
 * POST /api/votes upserts unconditionally, so two in-flight votes on one person commit in whatever
 * order the server happens to process them: a voter who goes Back and changes their verdict while the
 * first request is still in flight can have the OLDER verdict stored. The server cannot recover the
 * intended order — it never saw it — so the client stamps each verdict and the API refuses to
 * overwrite a newer one. The client's clock is the right clock here: both stamps come from the same
 * browser, and a per-session sequence would not survive a reload the way a timestamp does.
 *
 * TRUST IT OR REPLACE IT — never bend it (adversarial review round 3). An earlier version CLAMPED an
 * out-of-range stamp to a bound derived from `now`, which INVERTS the order it exists to preserve: on
 * a clock a day ahead, the newer verdict clamps to T+limit and its older predecessor, arriving a
 * second later, clamps to T+limit+1s and wins. So a stamp outside the window is not repaired, it is
 * discarded for server time — which degrades that client to today's last-arrival-wins behaviour
 * rather than to a wrong order.
 *
 * KNOWN CEILINGS, both bounded and both stated on B-051:
 *   - A client whose clock is outside the window gets NO ordering guarantee (it gets today's).
 *   - Equal stamps pass the API's `stored <= incoming` guard, so a tie resolves by arrival. `<` would
 *     refuse a retry of the same verdict, which is the worse failure: the client would disclose a
 *     save that happened as unconfirmed.
 */
export const VOTE_CAST_AT_TRUST_WINDOW_MS = 5 * 60_000;

export function voteCastAt(clientCastAt: unknown, now: number): Date {
  if (typeof clientCastAt !== "number" || !Number.isFinite(clientCastAt)) return new Date(now);
  return Math.abs(clientCastAt - now) <= VOTE_CAST_AT_TRUST_WINDOW_MS ? new Date(clientCastAt) : new Date(now);
}
