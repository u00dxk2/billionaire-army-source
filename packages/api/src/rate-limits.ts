// Per-route rate-limit configs (@fastify/rate-limit is registered with
// global: false in server.ts, so ONLY routes that opt in via
// config.rateLimit are limited — GET/SSR reads stay unlimited because all
// server-side page renders arrive from the single ba-web egress IP and a
// global per-IP cap would throttle the whole site as one client).
//
// Keys are per-IP (trustProxy is on, so req.ip is the real browser client
// behind Render's proxy). X-Forwarded-For is client-influenced, so this is
// abuse *dampening*, not a security boundary — the write endpoints are
// additionally auth-gated.

/** Content-creating writes (comments, proposals, rewrites): 5/min per IP. */
export const CONTENT_WRITE_LIMIT = { max: 5, timeWindow: "1 minute" };

/** Toggle-style writes (votes, ratings, user sync): 30/min per IP. */
export const VOTE_LIMIT = { max: 30, timeWindow: "1 minute" };
