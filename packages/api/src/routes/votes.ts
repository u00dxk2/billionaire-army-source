import type { FastifyPluginAsync } from "fastify";
import { eq, lte, sql } from "drizzle-orm";
import { votes, persons } from "@ba/db";
import { createVoteSchema, voteCastAt } from "@ba/shared";
import { authenticate } from "../auth.js";
import { UUID_RE } from "../uuid.js";
import { VOTE_LIMIT } from "../rate-limits.js";
import type { Db } from "@ba/db";

export const voteRoutes: FastifyPluginAsync = async (app) => {
  const db = (app as any).db as Db;

  // Cast a vote (approve/disapprove)
  app.post("/", { preHandler: authenticate, config: { rateLimit: VOTE_LIMIT } }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = createVoteSchema.parse(request.body);

    const direction = body.direction === "approve" ? 1 : -1;

    /* B-051 — the voter's LAST verdict wins, whatever order two overlapping requests commit in.
       The upsert used to overwrite unconditionally, so a voter who went Back and changed their mind
       while the first POST was in flight could have the verdict they changed AWAY from stored, on a
       surface whose whole claim is that the record is what the receipt says. The client stamps when
       it was cast (`voteCastAt` bounds a skewed clock); `created_at` carries that stamp — nothing
       else reads it — and the update runs only when the stored stamp is no newer. */
    const castAt = voteCastAt(body.castAt, Date.now());

    const [vote] = await db
      .insert(votes)
      .values({
        userId,
        personId: body.personId,
        direction,
        createdAt: castAt,
      })
      .onConflictDoUpdate({
        target: [votes.userId, votes.personId],
        set: { direction, createdAt: castAt },
        // lte(), never sql`… <= ${castAt}`: a raw Date in a template parameter skips the timestamp
        // column's encoder and reaches postgres-js as a Date, which throws — on EVERY vote write,
        // insert and update alike (adversarial review round 3 reproduced ERR_INVALID_ARG_TYPE).
        setWhere: lte(votes.createdAt, castAt),
      })
      .returning();

    // Nothing came back: a NEWER verdict from this voter is already stored, so this one is stale and
    // was not applied. Said as 409 rather than a cheerful 201 — the client decides what a save means
    // (B-050), and a stale write reported as saved is the same lie that fix retired.
    if (!vote) {
      return reply.status(409).send({ error: "superseded", superseded: true });
    }

    return reply.status(201).send(vote);
  });

  // Get approval stats for a person
  app.get<{ Params: { personId: string } }>(
    "/stats/:personId",
    async (request, reply) => {
      const { personId } = request.params;
      if (!UUID_RE.test(personId)) {
        return reply.status(404).send({ error: "Person not found" });
      }

      const stats = await db
        .select({
          approvals: sql<number>`count(*) filter (where direction = 1)`,
          disapprovals: sql<number>`count(*) filter (where direction = -1)`,
          total: sql<number>`count(*)`,
        })
        .from(votes)
        .where(eq(votes.personId, personId));

      const s = stats[0];
      const total = Number(s.total);

      return {
        approvals: Number(s.approvals),
        disapprovals: Number(s.disapprovals),
        total,
        approvalRate: total > 0 ? Number(s.approvals) / total : 0,
      };
    }
  );
};
