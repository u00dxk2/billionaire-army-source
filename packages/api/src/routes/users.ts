import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { users } from "@ba/db";
import { authenticate } from "../auth.js";
import { supabaseAdmin } from "../auth.js";
import { VOTE_LIMIT } from "../rate-limits.js";
import type { Db } from "@ba/db";

export const userRoutes: FastifyPluginAsync = async (app) => {
  const db = (app as any).db as Db;

  // Sync user record on login — called by the frontend after auth
  app.post("/sync", { preHandler: authenticate, config: { rateLimit: VOTE_LIMIT } }, async (request) => {
    const userId = (request as any).userId as string;

    // Check if user already exists in our table
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    // Get email from Supabase auth
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!user) {
      throw new Error("User not found in Supabase auth");
    }

    const [newUser] = await db
      .insert(users)
      .values({
        id: userId,
        email: user.email!,
        displayName: user.email!.split("@")[0],
      })
      .returning();

    return newUser;
  });

  // Get current user profile
  app.get("/me", { preHandler: authenticate }, async (request, reply) => {
    const userId = (request as any).userId as string;

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user.length) {
      return reply.status(404).send({ error: "User not found. Call POST /api/users/sync first." });
    }

    return user[0];
  });
};
