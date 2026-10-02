import type { FastifyPluginAsync } from "fastify";
import { eq, and, desc, sql, ilike, inArray, ne } from "drizzle-orm";
import { persons, personFacts, scoreSnapshots } from "@ba/db";
import { GIVING_EVIDENCE_FACT_KEYS, politicalDominatesGiving, directGivingDominatesGrants, readPhilanthropyFacts, paginationSchema, proposePersonSchema, reviewActionSchema, foundationTotals, stripPipelineCommentary, formatCurrency, isFecRecordImpossible, topPartyLabel, SUMMARY_QUARANTINE_FACT_KEY, withoutApprovalMetadata, netWorthWithAge, netWorthSummaryNote } from "@ba/shared";
import { authenticate, authenticateAdmin } from "../auth.js";
import { firstSentences } from "../first-sentences.js";
import { UUID_RE } from "../uuid.js";
import { CONTENT_WRITE_LIMIT } from "../rate-limits.js";
import { dailySeed, dailyOrder } from "../daily-ten-order.js";
import { dailyTenPool } from "../daily-ten-pool.js";
import { loadGradedIds, servedScore } from "../grade-status.js";
import type { Db } from "@ba/db";

export const personRoutes: FastifyPluginAsync = async (app) => {
  const db = (app as any).db as Db;

  // List persons with latest score
  app.get("/", async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const offset = (page - 1) * limit;

    const query = request.query as Record<string, string>;

    // Only ever list approved persons (R-025). Build a single combined WHERE so
    // search + state + moderation all apply together — a prior version called
    // .where() twice, which replaces rather than ANDs, silently dropping the
    // search filter when a state was also given.
    const conditions = [eq(persons.reviewStatus, "approved")];
    if (query.search) conditions.push(ilike(persons.name, `%${query.search}%`));
    if (query.state) conditions.push(eq(persons.state, query.state));

    const results = await db
      .select()
      .from(persons)
      .where(and(...conditions))
      // Canon Wave 3: was desc(persons.name) — the directory opened Z→A on its
      // emptiest rows (Zhu/Zhong/Zhao name-only cards first).
      .orderBy(persons.name)
      .limit(limit)
      .offset(offset);

    // Total reflects the same visible universe (approved only), so pagination
    // never claims more rows than are listable.
    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(persons)
      .where(eq(persons.reviewStatus, "approved"));

    // Enrich with latest PBS scores
    if (results.length > 0) {
      const personIds = results.map((r) => r.id);
      const latestScores = await db
        .select({
          personId: scoreSnapshots.personId,
          pbs: scoreSnapshots.pbs,
        })
        .from(scoreSnapshots)
        .where(inArray(scoreSnapshots.personId, personIds));

      // Keep only the latest score per person
      const scoreMap = new Map<string, string>();
      for (const s of latestScores) {
        scoreMap.set(s.personId, s.pbs);
      }

      // Not graded ⇒ no score served (grade-status.ts).
      const graded = await loadGradedIds(db, personIds);
      const enriched = results.map((p) => {
        const s = servedScore(p.id, scoreMap.get(p.id), graded);
        return { ...p, pbs: s.value, gradeStatus: s.gradeStatus };
      });

      return {
        data: enriched,
        pagination: {
          page,
          limit,
          total: Number(total[0].count),
        },
      };
    }

    return {
      data: results,
      pagination: {
        page,
        limit,
        total: Number(total[0].count),
      },
    };
  });

  // Get single person with facts
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: "Person not found" });
    }

    const person = await db
      .select()
      .from(persons)
      .where(eq(persons.id, id))
      .limit(1);

    if (!person.length) {
      return reply.status(404).send({ error: "Person not found" });
    }

    // Unapproved (pending/rejected) proposals are not public — 404 so a direct
    // URL can't reach a person that isn't in the listing either (R-025).
    if (person[0].reviewStatus !== "approved") {
      return reply.status(404).send({ error: "Person not found" });
    }

    // The B-045 quarantine key holds candidate text with a figure our own record contradicts —
    // never served. Every other fact still goes out, so this is a denylist of exactly one key.
    const facts = await db
      .select()
      .from(personFacts)
      .where(and(eq(personFacts.personId, id), ne(personFacts.factKey, SUMMARY_QUARANTINE_FACT_KEY)))
      .orderBy(desc(personFacts.retrievedAt));

    const latestScore = await db
      .select()
      .from(scoreSnapshots)
      .where(eq(scoreSnapshots.personId, id))
      .orderBy(desc(scoreSnapshots.date))
      .limit(1);

    // Not graded ⇒ no score object at all, so no letter, number or component bar can render from it.
    const graded = await loadGradedIds(db, [id]);
    const s = servedScore(id, latestScore[0], graded);

    // B-046's approval marker (who approved a summary section, on which internal ruling) stays in
    // storage for the generator and is stripped here, the one route that serves raw fact rows.
    return {
      ...person[0],
      facts: facts.map(withoutApprovalMetadata),
      score: s.value,
      gradeStatus: s.gradeStatus,
    };
  });

  // Leaderboard
  app.get("/leaderboard", async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const offset = (page - 1) * limit;

    const hasGivingFact = sql`exists (select 1 from person_facts pf where pf.person_id = ${persons.id} and pf.fact_key in (${sql.join(
      GIVING_EVIDENCE_FACT_KEYS.map((k) => sql`${k}`),
      sql`, `,
    )}))`;

    const results = await db
      .select({
        person: persons,
        pbs: scoreSnapshots.pbs,
        features: scoreSnapshots.features,
      })
      .from(scoreSnapshots)
      .innerJoin(persons, eq(scoreSnapshots.personId, persons.id))
      .where(
        and(
          eq(persons.reviewStatus, "approved"),
          eq(
            scoreSnapshots.date,
            sql`(SELECT MAX(date) FROM score_snapshots ss2 WHERE ss2.person_id = score_snapshots.person_id)`
          )
        )
      )
      // Graded persons first, by score; the not-graded listed after them, by NAME, carrying no
      // score. In SQL rather than after the page is cut, or pagination would split the two sets.
      // The score sorts graded rows ONLY (`case … end` is null for the rest): ordering the
      // not-graded by a score we withhold would still rank them by it across pages (Codex r1 #3).
      .orderBy(
        sql`${hasGivingFact} desc`,
        sql`case when ${hasGivingFact} then ${scoreSnapshots.pbs} end desc nulls last`,
        persons.name,
      )
      .limit(limit)
      .offset(offset);

    const graded = await loadGradedIds(db, results.map((r) => r.person.id));
    return {
      data: results.map((r) => {
        const s = servedScore(r.person.id, r.pbs, graded);
        return { ...r, pbs: s.value, features: s.value == null ? null : r.features, gradeStatus: s.gradeStatus };
      }),
    };
  });

  // Daily Ten — deterministic 10 profiles per day
  app.get("/daily-ten", async () => {
    // Seed a deterministic shuffle from today's date — one seed PER DATE (daily-ten-order.ts says why
    // a char-code sum was not that).
    const today = new Date().toISOString().split("T")[0];
    const seed = dailySeed(today);

    // Get all approved persons sorted stably (R-025: never surface a pending
    // proposal in the daily swipe). deathYear rides along for dailyTenPool (B-055).
    const candidates = await db
      .select({ id: persons.id, deathYear: persons.deathYear })
      .from(persons)
      .where(eq(persons.reviewStatus, "approved"))
      .orderBy(persons.id);

    // Data-completeness floor: only surface profiles that have BOTH a real PBS
    // score AND at least one sourced "receipt" fact (foundation 990s, a Giving
    // Pledge badge, or FEC contributions). This keeps card #1 — the partner
    // demo's first impression — from ever opening on a "Limited public data"
    // profile. Deterministic daily seeding is unchanged; we just shuffle a
    // filtered pool instead of the whole index. The pool rule itself (floor,
    // deceased exclusion, fallback) lives in daily-ten-pool.ts.
    const RECEIPT_FACT_TYPES = ["philanthropy", "giving_pledge", "political"];
    const [scoredRows, receiptRows] = await Promise.all([
      db.selectDistinct({ personId: scoreSnapshots.personId }).from(scoreSnapshots),
      db
        .selectDistinct({ personId: personFacts.personId })
        .from(personFacts)
        .where(inArray(personFacts.factType, RECEIPT_FACT_TYPES)),
    ]);
    // "A real score" now means a GRADED one: a not-graded person has a stored number and no grade,
    // and the floor exists so card #1 never opens on a thin profile.
    const scoredIds = scoredRows.map((r) => r.personId);
    const gradedScored = await loadGradedIds(db, scoredIds);
    const scoredSet = new Set(scoredIds.filter((pid) => gradedScored.has(pid)));
    const receiptSet = new Set(receiptRows.map((r) => r.personId));

    const dailyIds = dailyOrder(dailyTenPool(candidates, scoredSet, receiptSet), seed).slice(0, 10);

    const results = await db
      .select()
      .from(persons)
      .where(inArray(persons.id, dailyIds));

    // Enrich with PBS scores
    const latestScores = await db
      .select({
        personId: scoreSnapshots.personId,
        pbs: scoreSnapshots.pbs,
      })
      .from(scoreSnapshots)
      .where(inArray(scoreSnapshots.personId, dailyIds));

    const scoreMap = new Map<string, string>();
    for (const s of latestScores) {
      scoreMap.set(s.personId, s.pbs);
    }

    // Fetch all relevant facts for these 10 people
    const allFacts = await db
      .select()
      .from(personFacts)
      .where(and(inArray(personFacts.personId, dailyIds), ne(personFacts.factKey, SUMMARY_QUARANTINE_FACT_KEY)));

    // Build highlights per person
    type Highlights = {
      netWorth: string | null;
      summary: string | null;
      political: { total: string; topRecipient: string; partyBreakdown: Record<string, number> } | null;
      philanthropy: { totalAssets: string; totalGrants: string; foundations: number } | null;
      givingPledge: boolean;
      // The single strongest sourced fact, leading the card so it never opens
      // on a bio-only / "Limited public data" impression.
      receiptHook: { tag: string; text: string } | null;
      factCount: number;
      // B-065: the stated sentence for the bio when this person's net worth is not current.
      netWorthNote: string | null;
    };

    // Coarser than formatCurrency ON PURPOSE above $1M — these are /today card chips where
    // "$182M" reads better than "$182.0M" — but the sub-$1K band falls through to the shared
    // ladder rather than being rounded to thousands. The old last branch was
    // `n > 0 ? `$${(n / 1e3).toFixed(0)}K`` , which renders anything under $500 as **"$0K"** and
    // $711.59 as "$1K". `fmtMoney` builds the `receiptHook` — the sourced dek that LEADS each
    // /today card — so that branch could print "Gave $0K through 1 foundation, per its latest
    // IRS 990" about a named living person, which is precisely the false-zero this repo forbids
    // on every surface ("absent, never zero"). Latent rather than live when found 2026-09-03:
    // the served daily-ten's smallest figure that day was $57K.
    const fmtMoney = (n: number) =>
      n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : n > 0 ? formatCurrency(n) : "";

    // B-038. The local `topParty` that stood here was one of TWO byte-identical forks (the other
    // was in web/src/components/DailySwipe.tsx) and it returned the RAW FEC CODE, which the caller
    // below then hand-mapped for exactly DEM and REP — so every other code fell through and the
    // receipt hook read "mostly DFL" / "mostly NNE" on a /today card. It also compared UNFOLDED
    // buckets, and DEM/Dem are one party stored under two keys, so it could name the wrong lean
    // outright. `topPartyLabel` from @ba/shared folds first and returns the label.

    const highlightsMap = new Map<string, Highlights>();

    // B-037 FOURTH surface. The person rows above already carry birth_year (`.select()` takes every
    // column); this loop simply never looked at them, so /today had no way to apply the withhold.
    const personById = new Map(results.map((p) => [p.id, p]));

    for (const id of dailyIds) {
      const facts = allFacts.filter((f) => f.personId === id);
      const h: Highlights = {
        netWorth: null,
        summary: null,
        political: null,
        philanthropy: null,
        givingPledge: false,
        receiptHook: null,
        factCount: facts.length,
        netWorthNote: null,
      };

      // Raw values retained to pick the single strongest sourced receipt.
      let givingRaw = 0;
      let assetsRaw = 0;
      let foundationsCount = 0;
      let politicalRaw = 0;

      for (const f of facts) {
        const val = f.factValue as Record<string, unknown>;

        if (f.factType === "net_worth") {
          // Net worth is stored as a formatted string like "~$1.2B". B-065: /today prints this
          // string as-is, so an undated or old figure carries its label in it.
          h.netWorth = netWorthWithAge(f.factValue, f);
        }

        if (f.factType === "summary") {
          const overview = typeof val === "object" && val && "overview" in val ? String(val.overview) : String(val);
          // Strip pipeline-referential sentences BEFORE taking the first two, or /today's
          // receipt bio can open on plumbing. Found 2026-08-25 by the sibling sweep for the
          // profile-summary fix (93e879f): the same prose reaches readers on TWO surfaces and
          // only the profile had been fixed. Measured live the same hour — Daniel Snyder's
          // daily-ten card read "The data provided does not identify his operating…", 1 of 10.
          // Order is load-bearing: strip first, then take 2, or a dropped sentence silently
          // shortens the bio to one. Absent, never a stub — an empty strip yields null, and
          // the surface already handles a missing summary.
          const clean = stripPipelineCommentary(overview);
          h.summary = clean ? firstSentences(clean, 2) : null;
          // B-065: the bio can state a net worth (Snyder's "~$4.7B [Wikidata]"). Say it may be out of date
          // when our figure is not current OR this summary predates it — no figure matching, no date claim.
          h.netWorthNote = h.summary
            ? netWorthSummaryNote(
                facts.find((x) => x.factKey === "net_worth"),
                typeof val === "object" && val ? (val.generatedAt as string | undefined) : undefined,
              )
            : null;
        }

        if (f.factType === "political") {
          // B-037: withhold here too, or /today publishes a total the PROFILE refuses to show.
          // Found 2026-09-02 by the sibling sweep the P5 rule requires, after the same defect had
          // already been fixed on three other surfaces — the profile fact, the profile summary
          // prose and /compare. It was LATENT, not visible: none of the 12 withheld people were in
          // that day's ten, but the daily rotation is deterministic and would have reached one.
          // Skipping also leaves politicalRaw at 0, so a withheld figure cannot become the card's
          // receipt hook either — which is the louder half of this surface.
          if (isFecRecordImpossible(String(val.dateRange ?? ""), personById.get(id)?.birthYear)) continue;
          const total = Number(val.totalAmount) || 0;
          politicalRaw = total;
          const topArr = (val.topRecipients as { name: string; amount: number }[]) || [];
          const top = topArr[0];
          const party = (val.partyBreakdown as Record<string, number>) || {};
          h.political = {
            // formatCurrency from @ba/shared, NOT an inline ladder. The inline copy that used
            // to sit here dropped the rounding on its sub-$1K branch and shipped
            // "WINRED ($835.6400000000001)" to /today while the profile — which called the
            // shared function — rendered the same fact as "$835.64".
            total: formatCurrency(total),
            topRecipient: top ? `${top.name} (${formatCurrency(top.amount)})` : "",
            partyBreakdown: party,
          };
        }

        // Philanthropy-shaped facts are read ONCE, order-independently, by readPhilanthropyFacts
        // below the loop. See its note in @ba/shared for the 88-person clobber this replaced.
      }

      /* ONE read of every philanthropy-shaped fact, dispatched BY KEY so the result cannot depend on
         the order Postgres returned the rows in. This loop used to branch on factType, and
         `philanthropy` is shared by foundation_990s, giving_pledge and total_giving — the last two
         collapse to {0, 0}, so a pledge row read after a 990 row erased a real giving record. */
      const phil = readPhilanthropyFacts(facts, foundationTotals);
      givingRaw = phil.givingRaw;
      assetsRaw = phil.assetsRaw;
      foundationsCount = phil.foundationsCount;
      const directGiving = phil.directGiving;
      h.givingPledge = phil.givingPledge;
      if (foundationsCount > 0 || assetsRaw > 0 || givingRaw > 0) {
        h.philanthropy = {
          totalAssets: fmtMoney(assetsRaw),
          totalGrants: fmtMoney(givingRaw),
          foundations: foundationsCount,
        };
      }

      // Receipt hook: the single most concrete sourced fact, leading the card.
      // Priority = documented giving > parked foundation assets > Giving Pledge
      // promise > federal political giving. Each names its source so the hook
      // reads as a receipt, not a claim.
      const plural = foundationsCount === 1 ? "" : "s";
      // A 990 grant line loses the lead ONLY to a curated figure that dwarfs it on the same annual
      // basis (Buffett's card led with "$2K" against $60B). The calibration lives in @ba/shared.
      const curatedLeads = directGiving !== null && directGivingDominatesGrants(givingRaw, directGiving.annual);
      if (givingRaw > 0 && !curatedLeads) {
        const given = `Gave ${fmtMoney(givingRaw)} through ${foundationsCount} foundation${plural}, per its latest IRS 990`;
        // MAGNITUDE, not just availability. The ladder below picks whichever receipt EXISTS, which
        // on 2026-09-04 made J. Christopher Reyes' card lead with "Gave $23K through 3 foundations"
        // while $30.0M of federal political spending — the actual story, and already on the card's
        // own chips — never reached the sentence a reader reads. `politicalDominatesGiving` is the
        // ONE calibration and it lives in @ba/shared; do not inline the ratio here.
        // Two sourced numbers and a dash — no verdict. Facts and commentary do not share a
        // container on this platform, and no filing supports a claim about anyone's motives.
        h.receiptHook = politicalDominatesGiving(givingRaw, politicalRaw) && h.political
          ? { tag: "990 · FEC", text: `${given} — and ${h.political.total} to federal politics, per FEC records.` }
          : { tag: "990", text: `${given}.` };
      } else if (directGiving) {
        /* A RECEIPT OUTRANKS A PROMISE, and that is the whole point of this tier. Mark Zuckerberg
           and Pierre Omidyar both signed the Giving Pledge and neither gives through a name-matched
           private foundation, so the ladder fell past an EMPTY philanthropy block to the pledge:
           their cards led with "a public promise to give most of it away" while this repo held
           $7.0B since 2015 (Chan Zuckerberg Initiative, ProPublica) and $4.0B since 2004 (Omidyar
           Network). On a product whose thesis is that no claim outruns its citation, leading with
           the promise over the receipt is exactly backwards. Filed as Cycle 14's Finding 2
           (2026-09-04) for the next Flow-2 slot; measured and shipped 2026-09-14.
           It ranks BELOW foundation 990 grants — those are the more auditable record — unless it
           dwarfs them (`curatedLeads` above, 2026-09-21), and above parked assets, because money
           GIVEN beats money HELD.
           THE CUMULATIVE FIGURE WITH ITS OWN PERIOD, never `annualGiving`: that field is ANNUALIZED
           from a lifetime total (CLAUDE.md), so "gave $X last year" would be a false claim about a
           real person. "$7.0B since 2015" is what the source actually says.
           NO political contrast on this tier, deliberately: `politicalDominatesGiving` was
           calibrated on annual-ish foundation grants, and a cumulative-since-2004 figure against a
           100-row FEC sample is not the same denominator. Naming it rather than quietly reusing it. */
        h.receiptHook = {
          tag: "Curated",
          text: `Gave ${fmtMoney(directGiving.amount)} ${directGiving.period}, per ${directGiving.source}.`,
        };
      } else if (assetsRaw > 0) {
        h.receiptHook = { tag: "990", text: `Holds ${fmtMoney(assetsRaw)} across ${foundationsCount} foundation${plural}, per IRS 990 filings.` };
      } else if (h.givingPledge) {
        h.receiptHook = { tag: "Pledge", text: "Signed the Giving Pledge — a public promise to give most of it away." };
      } else if (politicalRaw > 0 && h.political) {
        const partyLabel = topPartyLabel(h.political.partyBreakdown);
        h.receiptHook = { tag: "FEC", text: `${h.political.total} in federal political contributions on record${partyLabel ? `, mostly ${partyLabel}` : ""}.` };
      }

      highlightsMap.set(id, h);
    }

    // Preserve the shuffled order
    const orderMap = new Map(dailyIds.map((id, i) => [id, i]));
    // The pool's fewer-than-10 fallback can still admit a not-graded person; it gets no score.
    const gradedTen = await loadGradedIds(db, dailyIds);
    const enriched = results
      .map((p) => {
        const s = servedScore(p.id, scoreMap.get(p.id), gradedTen);
        return { ...p, pbs: s.value, gradeStatus: s.gradeStatus, highlights: highlightsMap.get(p.id) ?? null };
      })
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

    return { data: enriched, date: today };
  });

  // Propose a new billionaire. Lands as "pending" (R-025) — invisible on every
  // public read path until an admin approves it. The UI already tells proposers
  // "submitted for review… once approved it will appear on the index"; this makes
  // the backend match that promise.
  app.post("/propose", { preHandler: authenticate, config: { rateLimit: CONTENT_WRITE_LIMIT } }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = proposePersonSchema.parse(request.body);

    const [person] = await db
      .insert(persons)
      .values({
        name: body.name,
        industry: body.industry,
        state: body.state || null,
        wikidataId: body.wikidataId || null,
        proposedBy: userId,
        publicFigure: false,
        reviewStatus: "pending",
        proposalReason: body.reason,
      })
      .returning();

    return reply.status(201).send(person);
  });

  // --- Admin moderation (R-025) — gated by ADMIN_USER_IDS allowlist ---

  // List proposals awaiting review (newest first).
  app.get("/pending", { preHandler: authenticateAdmin }, async () => {
    const rows = await db
      .select()
      .from(persons)
      .where(eq(persons.reviewStatus, "pending"))
      .orderBy(desc(persons.createdAt));

    return { data: rows };
  });

  // Approve or reject a pending proposal.
  app.post<{ Params: { id: string } }>(
    "/:id/review",
    { preHandler: authenticateAdmin },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.status(404).send({ error: "Person not found" });
      }
      const { action } = reviewActionSchema.parse(request.body);

      const existing = await db
        .select()
        .from(persons)
        .where(eq(persons.id, id))
        .limit(1);

      if (!existing.length) {
        return reply.status(404).send({ error: "Person not found" });
      }

      const [updated] = await db
        .update(persons)
        .set({
          reviewStatus: action === "approve" ? "approved" : "rejected",
          updatedAt: new Date(),
        })
        .where(eq(persons.id, id))
        .returning();

      return reply.send(updated);
    }
  );
};
