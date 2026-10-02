import { createClient } from "@supabase/supabase-js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "@ba/db";
import { isAdminUserId } from "./admin-allowlist.js";
import { ensureUserRow } from "./ensure-user-row.js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing authorization header" });
  }

  const token = authHeader.slice(7);
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return reply.status(401).send({ error: "Invalid token" });
  }

  (request as any).userId = user.id;

  // R-043: every authenticated write is FK'd to public.users, so the row is
  // guaranteed here rather than by each client remembering to call /users/sync.
  await ensureUserRow((request.server as any).db as Db, user);
}

// Comma-separated Supabase auth user IDs allowed to moderate (R-025). Empty by
// default => no one is an admin (endpoints 403), so a misconfigured deploy fails
// closed rather than exposing moderation to everyone. Set ADMIN_USER_IDS on the
// API service (Render) to the owner's Supabase user id once he has an account.
export async function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  await authenticate(request, reply);
  // authenticate() already sent a 401 (missing/invalid token) — stop here.
  if (reply.sent) return;

  const userId = (request as any).userId as string;
  if (!isAdminUserId(userId, process.env.ADMIN_USER_IDS)) {
    return reply.status(403).send({ error: "Admin access required" });
  }
}
