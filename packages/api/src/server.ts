import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createDb } from "@ba/db";
import { personRoutes } from "./routes/persons.js";
import { goalRoutes } from "./routes/goals.js";
import { voteRoutes } from "./routes/votes.js";
import { userRoutes } from "./routes/users.js";
import { feedRoutes } from "./routes/feed.js";
import { parseJsonBody } from "./json-body.js";

const port = Number(process.env.API_PORT) || 3001;
const host = process.env.API_HOST || "0.0.0.0";

// trustProxy: behind Render's proxy, req.ip is otherwise the proxy address for
// every client — which would collapse all users into ONE rate-limit bucket.
const app = Fastify({ logger: true, trustProxy: true });

// Baseline security headers (HSTS, nosniff, frame-deny). CSP is disabled: the
// API serves JSON only, and a default CSP adds noise without protection here.
await app.register(helmet, { contentSecurityPolicy: false });

// Rate limiting is opt-in per route (global: false): mutation routes attach
// config.rateLimit from rate-limits.ts. Reads stay unlimited because SSR page
// renders all arrive from ba-web's egress IP as a single "client".
await app.register(rateLimit, { global: false });

// Comma-separated allowlist of browser origins permitted to call the API for
// client-side mutations (vote / comment / propose / admin review). Production
// is billionaire.army (R-014); the Render default host is kept as a fallback.
// SSR reads are server-to-server and unaffected by CORS. A single value works
// too (dev = http://localhost:3000).
const webOrigins = (process.env.WEB_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: webOrigins,
});

// Treat an EMPTY body on `Content-Type: application/json` as `{}` instead of a
// 400. Fastify's built-in JSON parser rejects an empty body outright, and that
// rejection happens during parsing — BEFORE preHandler — so the route's own
// auth and logic never run.
//
// This silently broke every authenticated write for a brand-new user. The nine
// client call sites that POSTed `/api/users/sync` (then the only thing creating a
// user's row in our `users` table — R-043 moved that into authenticate() on
// 2026-09-16) sent the JSON content-type
// header with no body, so sync 400'd in ~4ms, the row was never created, and
// the follow-up write — comment, vote, rating, proposal — then violated the
// `user_id` foreign key and returned a 500. It read as "commenting is broken"
// but nothing was wrong with commenting. Found 2026-07-26 the first time anyone
// actually tried to comment on prod; zero users is what hid it.
//
// Routes that genuinely require fields are unaffected: they still zod-parse the
// resulting `{}` and fail with a proper 400.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_request, body: string, done) => {
    try {
      done(null, parseJsonBody(body));
    } catch {
      const err = new Error("Invalid JSON body") as FastifyError;
      err.statusCode = 400;
      done(err, undefined);
    }
  }
);

// Central error shaping. Without this, Fastify's default handler serializes
// error.message into the body — so a thrown Postgres/driver error leaks
// internal detail, and a Zod parse failure surfaces as a 500 instead of a 400.
// MUST be set BEFORE the route plugins are registered: error handlers are
// encapsulated, and a handler set after registration does not apply to the
// already-registered plugin contexts.
app.setErrorHandler((error: FastifyError, request, reply) => {
  // Routes validate input with zod schema.parse(); duck-type the error so we
  // don't need a direct zod dependency here.
  const issues = (error as unknown as { name?: string; issues?: unknown }).issues;
  if (error.name === "ZodError" && Array.isArray(issues)) {
    return reply.status(400).send({
      error: "Invalid request",
      details: (issues as { path?: (string | number)[]; message?: string }[]).map((i) => ({
        path: i.path?.join("."),
        message: i.message,
      })),
    });
  }

  // Framework-produced client errors (rate-limit 429, body-too-large 413,
  // malformed JSON 400) keep their status and message — those are safe.
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status < 500) {
    return reply.status(status).send({ error: error.message });
  }

  // Everything else: log the full error server-side, return a generic body.
  request.log.error(error);
  return reply.status(500).send({ error: "Internal server error" });
});

// Database
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  app.log.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

// Decorate fastify instance with db
app.decorate("db", db);

// Register routes
await app.register(personRoutes, { prefix: "/api/persons" });
await app.register(goalRoutes, { prefix: "/api/goals" });
await app.register(voteRoutes, { prefix: "/api/votes" });
await app.register(userRoutes, { prefix: "/api/users" });
await app.register(feedRoutes, { prefix: "/api/feed" });

// Health check
app.get("/api/health", async () => ({ status: "ok" }));

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
