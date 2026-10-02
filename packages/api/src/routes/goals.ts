import type { FastifyPluginAsync } from "fastify";
import { eq, desc, sql, and } from "drizzle-orm";
import { goals, goalRatings, goalRewrites, goalRewriteVotes, persons, personFacts, scoreSnapshots } from "@ba/db";
import { paginationSchema, createGoalSchema, createGoalRatingSchema, createGoalRewriteSchema, rewriteVoteSchema } from "@ba/shared";
import { authenticate } from "../auth.js";
import { UUID_RE } from "../uuid.js";
import { CONTENT_WRITE_LIMIT, VOTE_LIMIT } from "../rate-limits.js";
import type { Db } from "@ba/db";

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

// Major metro keywords → state, for goal scopes phrased around a city
const CITY_TO_STATE: Record<string, string> = {
  denver: "Colorado", aurora: "Colorado", lakewood: "Colorado",
  "new york city": "New York", nyc: "New York", chicago: "Illinois",
  houston: "Texas", dallas: "Texas", austin: "Texas",
  "los angeles": "California", "san francisco": "California",
  seattle: "Washington", atlanta: "Georgia", miami: "Florida",
  boston: "Massachusetts", philadelphia: "Pennsylvania",
};

// Goal-topic keywords → industry labels as they appear in persons.industry
const TOPIC_TO_INDUSTRY: [RegExp, string][] = [
  [/health|medical|overdose|opioid|hospital|drug/i, "Healthcare"],
  [/broadband|internet|digital|software|tech/i, "Technology"],
  [/housing|rent|homeless|real estate/i, "Real Estate"],
  [/energy|climate|carbon|solar|emission/i, "Energy"],
  [/manufactur/i, "Manufacturing"],
  [/media|news|journalis/i, "Media"],
  [/retail|meal|food|grocer|nutrition|hunger/i, "Retail"],
  [/finance|debt|loan|bank/i, "Finance"],
];

function parseNetWorthBillions(value: unknown): number | null {
  const m = String(value ?? "").match(/\$?\s*([\d.]+)\s*([BM])/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toUpperCase() === "B" ? n : n / 1000;
}

export const goalRoutes: FastifyPluginAsync = async (app) => {
  const db = (app as any).db as Db;

  // List goals sorted by priority
  app.get("/", async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const offset = (page - 1) * limit;
    const query = request.query as Record<string, string>;

    const status = query.status || "active";

    const results = await db
      .select()
      .from(goals)
      .where(eq(goals.status, status))
      .orderBy(desc(goals.priorityScore))
      .limit(limit)
      .offset(offset);

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(goals)
      .where(eq(goals.status, status));

    return {
      data: results,
      pagination: { page, limit, total: Number(total[0].count) },
    };
  });

  // Get single goal
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: "Goal not found" });
    }
    const goal = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!goal.length) {
      return reply.status(404).send({ error: "Goal not found" });
    }
    return goal[0];
  });

  // Heuristic billionaire matches for a goal — transparent why-chips, no
  // affordability claims (option B per D-001 follow-up ruling 2026-06-11).
  app.get<{ Params: { id: string } }>("/:id/matches", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: "Goal not found" });
    }
    const goal = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!goal.length) {
      return reply.status(404).send({ error: "Goal not found" });
    }

    const goalText = `${goal[0].title} ${goal[0].problemStatement} ${goal[0].scope}`;
    const goalTextLower = goalText.toLowerCase();

    const matchedStates = new Set<string>(
      US_STATES.filter((s) => goalText.includes(s))
    );
    for (const [city, state] of Object.entries(CITY_TO_STATE)) {
      if (goalTextLower.includes(city)) matchedStates.add(state);
    }

    const matchedIndustries = new Set<string>(
      TOPIC_TO_INDUSTRY.filter(([re]) => re.test(goalText)).map(([, ind]) => ind)
    );

    const rows = await db.execute(sql`
      SELECT p.id, p.name, p.state, p.industry, p.images,
        (SELECT ss.pbs FROM score_snapshots ss
         WHERE ss.person_id = p.id
         ORDER BY ss.date DESC LIMIT 1) AS pbs,
        (SELECT pf.fact_value #>> '{}' FROM person_facts pf
         WHERE pf.person_id = p.id AND pf.fact_key = 'net_worth'
         ORDER BY pf.retrieved_at DESC LIMIT 1) AS net_worth
      FROM persons p
      WHERE p.review_status = 'approved'
    `);

    const candidates = (rows as unknown as {
      id: string;
      name: string;
      state: string | null;
      industry: string[] | null;
      images: string[] | null;
      pbs: string | null;
      net_worth: string | null;
    }[]).map((r) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      industry: r.industry ?? [],
      images: r.images ?? [],
      pbs: r.pbs,
      netWorth: r.net_worth,
    }));

    const scored = candidates
      .map((p) => {
        const reasons: { type: string; label: string }[] = [];
        let score = 0;

        if (p.state && matchedStates.has(p.state)) {
          reasons.push({ type: "state", label: p.state });
          score += 2;
        }

        const industryHits = (p.industry || []).filter((i) =>
          matchedIndustries.has(i)
        );
        for (const hit of industryHits) {
          reasons.push({ type: "industry", label: hit });
          score += 1;
        }

        const billions = parseNetWorthBillions(p.netWorth);
        if (billions !== null) {
          const band =
            billions >= 50 ? "$50B+" : billions >= 10 ? "$10B+" : "$1B+";
          reasons.push({ type: "capacity", label: band });
          if (billions >= 10) score += 1;
        }

        return { ...p, billions, reasons, matchScore: score };
      })
      .filter((p) => p.matchScore > 0)
      .sort(
        (a, b) =>
          b.matchScore - a.matchScore ||
          (b.billions ?? 0) - (a.billions ?? 0) ||
          Number(b.pbs ?? 0) - Number(a.pbs ?? 0)
      )
      .slice(0, 12)
      .map(({ billions: _billions, ...rest }) => rest);

    return {
      data: scored,
      heuristic: {
        states: [...matchedStates],
        industries: [...matchedIndustries],
        note: "Heuristic match on home state, industry relevance, and net-worth capacity band. Not an affordability or willingness claim.",
      },
    };
  });

  // Create goal (authenticated)
  app.post("/", { preHandler: authenticate, config: { rateLimit: CONTENT_WRITE_LIMIT } }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = createGoalSchema.parse(request.body);

    const [goal] = await db
      .insert(goals)
      .values({
        ...body,
        baselineRetrievedAt: new Date(),
        proposedBy: userId,
        status: "proposed",
      })
      .returning();

    return reply.status(201).send(goal);
  });

  // Rate a goal (authenticated)
  app.post<{ Params: { id: string } }>(
    "/:id/rate",
    { preHandler: authenticate, config: { rateLimit: VOTE_LIMIT } },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const goalId = request.params.id;
      if (!UUID_RE.test(goalId)) {
        return reply.status(404).send({ error: "Goal not found" });
      }
      const body = createGoalRatingSchema.parse({ ...request.body as object, goalId });

      const [rating] = await db
        .insert(goalRatings)
        .values({
          userId,
          goalId,
          priority: body.priority,
          smart: body.smart,
        })
        .onConflictDoUpdate({
          target: [goalRatings.userId, goalRatings.goalId],
          set: {
            priority: body.priority,
            smart: body.smart,
          },
        })
        .returning();

      // Recompute aggregate scores
      const agg = await db
        .select({
          avgPriority: sql<number>`avg(priority)`,
          avgS: sql<number>`avg((smart->>'S')::numeric)`,
          avgM: sql<number>`avg((smart->>'M')::numeric)`,
          avgA: sql<number>`avg((smart->>'A')::numeric)`,
          avgR: sql<number>`avg((smart->>'R')::numeric)`,
          avgT: sql<number>`avg((smart->>'T')::numeric)`,
        })
        .from(goalRatings)
        .where(eq(goalRatings.goalId, goalId));

      if (agg[0]) {
        const smartness =
          (Number(agg[0].avgS) +
            Number(agg[0].avgM) +
            Number(agg[0].avgA) +
            Number(agg[0].avgR) +
            Number(agg[0].avgT)) /
          5;

        await db
          .update(goals)
          .set({
            priorityScore: String(Number(agg[0].avgPriority).toFixed(2)),
            smartnessScore: String(smartness.toFixed(2)),
            smartRatings: {
              S: Number(Number(agg[0].avgS).toFixed(2)),
              M: Number(Number(agg[0].avgM).toFixed(2)),
              A: Number(Number(agg[0].avgA).toFixed(2)),
              R: Number(Number(agg[0].avgR).toFixed(2)),
              T: Number(Number(agg[0].avgT).toFixed(2)),
            },
            updatedAt: new Date(),
          })
          .where(eq(goals.id, goalId));
      }

      return reply.status(201).send(rating);
    }
  );

  // List rewrites for a goal
  app.get<{ Params: { id: string } }>("/:id/rewrites", async (request, reply) => {
    const goalId = request.params.id;
    if (!UUID_RE.test(goalId)) {
      return reply.status(404).send({ error: "Goal not found" });
    }
    const results = await db
      .select()
      .from(goalRewrites)
      .where(eq(goalRewrites.goalId, goalId))
      .orderBy(desc(goalRewrites.createdAt));
    return { data: results };
  });

  // Propose a rewrite (authenticated)
  app.post<{ Params: { id: string } }>(
    "/:id/rewrites",
    { preHandler: authenticate, config: { rateLimit: CONTENT_WRITE_LIMIT } },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const goalId = request.params.id;
      if (!UUID_RE.test(goalId)) {
        return reply.status(404).send({ error: "Goal not found" });
      }
      const body = createGoalRewriteSchema.parse(request.body);

      const goal = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
      if (!goal.length) {
        return reply.status(404).send({ error: "Goal not found" });
      }

      const [rewrite] = await db
        .insert(goalRewrites)
        .values({
          goalId,
          proposedBy: userId,
          changes: body.changes,
          comment: body.comment,
        })
        .returning();

      return reply.status(201).send(rewrite);
    }
  );

  // Vote on a rewrite (authenticated)
  app.post<{ Params: { id: string; rewriteId: string } }>(
    "/:id/rewrites/:rewriteId/vote",
    { preHandler: authenticate, config: { rateLimit: VOTE_LIMIT } },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const { rewriteId } = request.params;
      if (!UUID_RE.test(rewriteId)) {
        return reply.status(404).send({ error: "Rewrite not found" });
      }
      const body = rewriteVoteSchema.parse(request.body);

      const directionValue = body.direction === "up" ? 1 : -1;

      await db
        .insert(goalRewriteVotes)
        .values({ rewriteId, userId, direction: directionValue })
        .onConflictDoUpdate({
          target: [goalRewriteVotes.userId, goalRewriteVotes.rewriteId],
          set: { direction: directionValue },
        });

      // Recount votes
      const counts = await db
        .select({
          ups: sql<number>`count(*) filter (where direction = 1)`,
          downs: sql<number>`count(*) filter (where direction = -1)`,
        })
        .from(goalRewriteVotes)
        .where(eq(goalRewriteVotes.rewriteId, rewriteId));

      const ups = Number(counts[0].ups);
      const downs = Number(counts[0].downs);

      await db
        .update(goalRewrites)
        .set({ upvotes: ups, downvotes: downs, updatedAt: new Date() })
        .where(eq(goalRewrites.id, rewriteId));

      // Auto-approve if net votes >= 5
      if (ups - downs >= 5) {
        const [rewrite] = await db
          .select()
          .from(goalRewrites)
          .where(and(eq(goalRewrites.id, rewriteId), eq(goalRewrites.status, "pending")))
          .limit(1);

        if (rewrite) {
          const changes = rewrite.changes as Record<string, unknown>;
          const updateFields: Record<string, unknown> = { updatedAt: new Date() };
          for (const [key, value] of Object.entries(changes)) {
            if (value !== undefined) {
              const dbKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
              updateFields[dbKey] = value;
            }
          }

          await db.update(goals).set(updateFields).where(eq(goals.id, rewrite.goalId));
          await db.update(goalRewrites).set({ status: "approved", updatedAt: new Date() }).where(eq(goalRewrites.id, rewriteId));
        }
      }

      return reply.send({ upvotes: ups, downvotes: downs });
    }
  );
};
