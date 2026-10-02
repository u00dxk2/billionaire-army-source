import type { FastifyPluginAsync } from "fastify";
import { and, eq, desc, sql, inArray, notInArray } from "drizzle-orm";
import { feedItems, feedItemPersons, feedComments, feedVotes, persons, personFacts, scoreSnapshots } from "@ba/db";
import { paginationSchema, feedVoteSchema, feedCommentSchema, feedCommentModerateSchema, feedCategorySchema, pickTopSlice, foundationAssetsChip, repairFoundationProse, repairScoreProse, isFecRecordImpossible, withholdPoliticalProse, formatCurrency, supersededCardIds, repairPoliticalProse, currentGivingRatio, cardNetWorthDisplay } from "@ba/shared";
import type { GivingRatio } from "@ba/shared";

/** The stored net_worth row as the feed routes read it — value plus what dates it (B-065). */
type NetWorthFactRow = { factValue: unknown; sourceType: string | null; retrievedAt: Date | null };
import { authenticate, authenticateAdmin } from "../auth.js";
import { UUID_RE } from "../uuid.js";
import { CONTENT_WRITE_LIMIT, VOTE_LIMIT } from "../rate-limits.js";
import type { Db } from "@ba/db";

// R-040 front-door ranking. The archive stays in recency order (publishedAt
// desc) — what changes is which cards sit on TOP, because the home hero reads
// the head of this list and the 2026-07-24 render read found it leading with a
// positive, aggregator-sourced, 18-day-old card.
//
// The effective global order is: [TOP_SLICE highest-punch cards from the newest
// TOP_WINDOW] ++ [everything else, publishedAt desc]. Promoted cards are removed
// from the recency stream so a card never appears on two pages or vanishes
// between them. Window + slice are deliberately small: this reshapes the front
// door, not the archive.
const TOP_WINDOW = 60;
const TOP_SLICE = 6;

/**
 * R-052 — the giving ratio, live-joined per person.
 *
 * Same shape and same reason as the B-005 live-PBS join below it: a feed item's
 * `contextData` holds only pre-formatted DISPLAY STRINGS frozen at curation
 * time (`netWorth` is the string `"~$1.14T"`), so there is nothing numeric on
 * the card to divide, and the snapshot is stale besides.
 *
 * Measured coverage when this shipped (2026-08-05): 4 of the 39 persons tagged
 * across the newest 60 cards — ~10%. The other ~90% get NO line at all, which
 * is the designed behaviour, not a gap to paper over.
 */
async function loadGivingRatios(
  db: Db,
  personIds: string[]
): Promise<{
  ratios: Map<string, GivingRatio>;
  philanthropy: Map<string, string | null>;
  foundationFacts: Map<string, unknown>;
  withheldPolitical: Set<string>;
  politicalChips: Map<string, string>;
  politicalTotals: Map<string, number>;
  netWorthFacts: Map<string, NetWorthFactRow>;
}> {
  const out = new Map<string, GivingRatio>();
  const netWorthFacts = new Map<string, NetWorthFactRow>();
  const chips = new Map<string, string | null>();
  const facts = new Map<string, unknown>();
  const withheldPolitical = new Set<string>();
  const politicalChips = new Map<string, string>();
  const politicalTotals = new Map<string, number>();
  if (personIds.length === 0)
    return { ratios: out, philanthropy: chips, foundationFacts: facts, withheldPolitical, politicalChips, politicalTotals, netWorthFacts };
  // B-067 — every person we READ gets an entry, null until a foundation_990s fact sets it. An absent
  // fact used to leave NO entry, so the card kept the chip frozen into contextData at curation time:
  // a deleted (self-healed) wrong attribution kept showing "$7M in foundation assets" forever.
  // Measured 2026-09-30 before this change: 0 of 72 served chips lacked a backing fact, so nothing
  // served moves today; it is what makes the 59-person '& family' repair actually reach the card.
  for (const id of personIds) chips.set(id, null);

  // factKey, NOT factType — the direct-giving importer writes factType
  // "philanthropy" with factKey "total_giving". Querying factType here returns
  // a FALSE ZERO that looks exactly like "nobody has curated giving data".
  const rows = await db
    .select({
      personId: personFacts.personId,
      factKey: personFacts.factKey,
      factValue: personFacts.factValue,
      // B-065: the net worth's age decides whether the ratio may divide by it and what the chip says.
      sourceType: personFacts.sourceType,
      retrievedAt: personFacts.retrievedAt,
    })
    .from(personFacts)
    .where(
      and(
        inArray(personFacts.personId, personIds),
        inArray(personFacts.factKey, ["net_worth", "total_giving", "foundation_990s", "fec_contributions"])
      )
    );

  const giving = new Map<string, unknown>();
  const political = new Map<string, unknown>();
  for (const r of rows) {
    if (r.factKey === "net_worth") netWorthFacts.set(r.personId, r);
    else if (r.factKey === "total_giving") giving.set(r.personId, r.factValue);
    else if (r.factKey === "fec_contributions") political.set(r.personId, r.factValue);
    // B-030 — rebuild the "$X in foundation assets" chip from the COLLAPSED total, live.
    // The curator hand-summed `foundations[].totalAssets` until 2026-08-20, so every card
    // published before then has the DOUBLED figure frozen into contextData: the served #1
    // card that morning read "$152.5B in foundation assets" for Melinda French Gates where
    // the collapsed total is $76.95B. Rebuilding here repairs every one of those cards with
    // no prod data write — the same display-side move as the live pbs override below.
    // The frozen GPT SUMMARY PROSE repeated the old number too, and this comment used to say
    // that was regen-only and "not fixable from here". It was wrong: on 2026-08-21 FIVE cards in
    // the served 40 read "$152.5 billion" in prose beside a chip reading "$77.0B" — the same
    // person, the same card, contradicting itself. The fact is kept here so the render path can
    // run `repairFoundationProse()` over the sentence deterministically, no regen and no write.
    else if (r.factKey === "foundation_990s") {
      chips.set(r.personId, foundationAssetsChip(r.factValue));
      facts.set(r.personId, r.factValue);
    }
  }

  // B-065 — the ratio divides only by a CURRENT net worth. On 2026-09-29, 16 of the served 100 cards
  // divided by a figure dated 2022 or earlier (Zuckerberg "0.9% of ~$69.8B", a 2019 value), which
  // overstates generosity about a named living person. Absent, never wrong.
  for (const pid of personIds) {
    const ratio = currentGivingRatio(netWorthFacts.get(pid), giving.get(pid));
    if (ratio) out.set(pid, ratio);
  }

  // B-037, SIXTH surface — and the only one of the six that was PROVEN SERVED rather than latent.
  // The curator froze "$X in political donations" into contextData at publish time, so a card
  // published before 3068b35 carries the chip for a person the profile now refuses to show. Read
  // 2026-09-02 over every published card attached to a withheld person: 3 of 3 carried the chip,
  // and one was live in the served 60 that minute (Herbert Wertheim, "$1.8M in political
  // donations" — stored birth_year 2000 against a 1992 contribution). Withholding here repairs
  // every already-published card with NO prod data write, the same display-side move as the
  // B-030 foundation chip above and the live pbs override below.
  const withheldRows = await db
    .select({ id: persons.id, birthYear: persons.birthYear })
    .from(persons)
    .where(inArray(persons.id, personIds));
  const birthYearById = new Map(withheldRows.map((p) => [p.id, p.birthYear]));
  for (const [pid, fv] of political) {
    const dateRange = (fv as { dateRange?: unknown } | null)?.dateRange;
    if (isFecRecordImpossible(typeof dateRange === "string" ? dateRange : null, birthYearById.get(pid))) {
      withheldPolitical.add(pid);
    }
    // Rebuild "$X in political donations" from the LIVE fact through the shared ladder — the
    // same display-side repair as the B-030 foundation chip above. The curator froze this
    // string with an inline copy of that ladder whose sub-$1K branch dropped its rounding, so
    // every card published before today carries the raw float: measured 2026-09-03 on the
    // served 40, MacKenzie Scott's "$711.5900000000003 in political donations" on 6 cards, one
    // of them PROMOTED at position 1. Repairing here fixes all of them with no prod data write;
    // the curator fix only reaches cards published after it. The withhold spread at the call
    // site runs AFTER this, so a withheld record still wins and renders null.
    const total = Number((fv as { totalAmount?: unknown } | null)?.totalAmount) || 0;
    if (total > 0) {
      politicalChips.set(pid, `${formatCurrency(total)} in political donations`);
      // The SAME live total, unformatted, for the prose repair (`repairPoliticalProse`).
      politicalTotals.set(pid, total);
    }
  }

  return { ratios: out, philanthropy: chips, foundationFacts: facts, withheldPolitical, politicalChips, politicalTotals, netWorthFacts };
}

export const feedRoutes: FastifyPluginAsync = async (app) => {
  const db = (app as any).db as Db;

  // List feed items (paginated, optional category filter)
  app.get("/", async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const query = request.query as Record<string, string>;
    const category = query.category ? feedCategorySchema.parse(query.category) : null;
    const categoryFilter = category ? eq(feedItems.category, category) : undefined;

    // B-031 — cards a judge adjudicated as the same event as one the reader meets higher
    // up. Excluded from the window, the stream AND the total below, so the withheld card
    // cannot be promoted, cannot appear further down, and cannot skew pagination by
    // counting toward a total it is never served in. The rows are untouched in the DB and
    // /feed/<id> still serves them, so a share already sent keeps working.
    const withheld = supersededCardIds();
    const notWithheld = withheld.length ? notInArray(feedItems.id, withheld) : undefined;

    // The promotion window: the newest TOP_WINDOW cards in the active filter.
    // Recomputed per request (deterministic — same rows, same pure scorer), so
    // page 2+ knows which ids were promoted onto page 1 and skips them.
    const windowRows = await db
      .select()
      .from(feedItems)
      .where(and(categoryFilter, notWithheld))
      .orderBy(desc(feedItems.publishedAt))
      .limit(TOP_WINDOW);

    const { promoted } = pickTopSlice(
      windowRows.map((r) => ({
        id: r.id,
        headline: r.headline,
        summary: r.summary,
        source: r.sourceName,
        sourceUrl: r.sourceUrl,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
      })),
      TOP_SLICE
    );
    const promotedIds = promoted.map((p) => p.id);
    const promotedRows = promotedIds
      .map((id) => windowRows.find((r) => r.id === id))
      .filter((r): r is (typeof windowRows)[number] => Boolean(r));

    // R-063 — the reader cannot see where the best-of slice ends and the recency stream
    // begins, so the page reads as reverse-chronological and a 37-day-old card at #1 looks
    // like today's news. The API owns the boundary because only it knows which ids
    // pickTopSlice() promoted; the client owns the words. LABEL ONLY — the ranking itself
    // is explicitly out of scope (the owner, 2026-08-20).
    const promotedIdSet = new Set(promotedIds);

    // Rows on this page that come from the recency stream, promoted ones excluded.
    const head = page === 1 ? promotedRows : [];
    const streamLimit = limit - head.length;
    const streamOffset = Math.max(0, (page - 1) * limit - promotedIds.length);

    const streamRows = streamLimit > 0
      ? await db
          .select()
          .from(feedItems)
          .where(
            promotedIds.length
              ? and(categoryFilter, notWithheld, notInArray(feedItems.id, promotedIds))
              : and(categoryFilter, notWithheld)
          )
          .orderBy(desc(feedItems.publishedAt))
          .limit(streamLimit)
          .offset(streamOffset)
      : [];

    const items = [...head, ...streamRows];

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(feedItems)
      .where(and(categoryFilter, notWithheld));

    if (items.length === 0) {
      return { data: [], pagination: { page, limit, total: Number(total[0].count), promotedCount: 0 } };
    }

    // Enrich with tagged persons
    const itemIds = items.map((i) => i.id);
    const junctions = await db
      .select({
        feedItemId: feedItemPersons.feedItemId,
        personId: feedItemPersons.personId,
      })
      .from(feedItemPersons)
      .where(inArray(feedItemPersons.feedItemId, itemIds));

    const personIds = [...new Set(junctions.map((j) => j.personId))];
    let personMap = new Map<string, { id: string; name: string; images: string[]; state: string | null }>();

    if (personIds.length > 0) {
      const personRows = await db
        .select({
          id: persons.id,
          name: persons.name,
          images: persons.images,
          state: persons.state,
        })
        .from(persons)
        .where(inArray(persons.id, personIds));

      for (const p of personRows) {
        personMap.set(p.id, p);
      }
    }

    // Live PBS: the curator snapshots a person's score into contextData at
    // curation time and never refreshes it, so old cards carried stale v1
    // (0–1) scores next to new v2 (0–100) ones (B-005). Read the current score
    // per tagged person and override contextData.pbs at display time, so every
    // card shows the live v2 score in one consistent format.
    const liveScore = new Map<string, number>();
    // B-065: the same snapshot's features say whether the grade divides by net worth at all.
    const liveFeatures = new Map<string, unknown>();
    if (personIds.length > 0) {
      const scoreRows = await db
        .select({ personId: scoreSnapshots.personId, pbs: scoreSnapshots.pbs, date: scoreSnapshots.date, features: scoreSnapshots.features })
        .from(scoreSnapshots)
        .where(inArray(scoreSnapshots.personId, personIds));
      const latestDate = new Map<string, string>();
      for (const s of scoreRows) {
        if (!latestDate.has(s.personId) || s.date > latestDate.get(s.personId)!) {
          latestDate.set(s.personId, s.date);
          liveScore.set(s.personId, Number(s.pbs));
          liveFeatures.set(s.personId, s.features);
        }
      }
    }

    const {
      ratios: givingRatios,
      philanthropy: philanthropyChips,
      foundationFacts,
      withheldPolitical,
      politicalChips,
      politicalTotals,
      netWorthFacts,
    } = await loadGivingRatios(db, personIds);

    // Comment counts (moderation-hidden comments excluded — see the flagged
    // filter note on GET /:id/comments)
    const commentCounts = await db
      .select({
        feedItemId: feedComments.feedItemId,
        count: sql<number>`count(*)`,
      })
      .from(feedComments)
      .where(and(inArray(feedComments.feedItemId, itemIds), eq(feedComments.flagged, false)))
      .groupBy(feedComments.feedItemId);

    const commentMap = new Map<string, number>();
    for (const c of commentCounts) {
      commentMap.set(c.feedItemId, Number(c.count));
    }

    const data = items.map((item) => {
      const taggedPersonIds = junctions
        .filter((j) => j.feedItemId === item.id)
        .map((j) => j.personId);
      const taggedPersons = taggedPersonIds
        .map((pid) => personMap.get(pid))
        .filter(Boolean);

      // Override the snapshotted pbs with the primary tagged person's live
      // score (v2, 0–100). If we have no live score, drop the field rather
      // than show a stale value.
      const primaryId = taggedPersonIds[0];
      const live = primaryId != null ? liveScore.get(primaryId) : undefined;
      const ctx = (item.contextData ?? {}) as Record<string, unknown>;
      const freshChip = primaryId != null ? philanthropyChips.get(primaryId) : undefined;
      // B-065 — the net-worth chip from the LIVE fact, with its age: a Wikidata figure (no stored
      // as-of date) or one past a year is labelled, never shown as current.
      const nw = cardNetWorthDisplay(
        ctx.netWorth,
        primaryId != null ? netWorthFacts.get(primaryId) : undefined,
        primaryId != null ? liveFeatures.get(primaryId) : undefined,
      );
      const contextData = {
        ...ctx,
        netWorth: nw.netWorth,
        pbs: live != null ? live.toFixed(1) : null,
        // `null` renders NO chip: the person has no stored 990 fact (loadGivingRatios seeds null for
        // every person it reads — B-067), or it collapses below $1M. The frozen contextData string
        // is never preferred: it can only have come from a 990 fact, so a missing fact means a
        // deleted wrong attribution, and drop-on-doubt (B-020) says show nothing. `undefined`
        // now arises only when there is no primary person to look up.
        ...(freshChip !== undefined ? { philanthropy: freshChip } : {}),
        // Rebuild the political chip through the shared currency ladder, repairing the raw
        // float the curator's inline copy froze in. Placed BEFORE the withhold below so a
        // withheld record still wins.
        ...(primaryId != null && politicalChips.has(primaryId)
          ? { political: politicalChips.get(primaryId) }
          : {}),
        // B-037: strip a frozen political chip whose attribution we no longer stand behind.
        // `null`, not deleted — the shape stays stable for the client, same as `pbs` above.
        ...(primaryId != null && withheldPolitical.has(primaryId) ? { political: null } : {}),
      };

      return {
        ...item,
        contextData,
        // R-063: true ONLY for the punch-promoted slice on page 1. Page 2+ has no promoted
        // rows at all, so every card there is correctly false rather than unlabelled.
        promoted: page === 1 && promotedIdSet.has(item.id),
        // B-030 residual: correct a doubled foundation figure frozen into the published sentence.
        // Our own arithmetic inside our own prose, not a restatement of the source — and a no-op
        // unless this person's stored sums actually disagree with the collapsed ones.
        //
        // R-081, layered on the same posture: restate OUR OWN score under the badge's name and at
        // the badge's LIVE figure. Measured 2026-09-03 on the served 40 — five cards read "a PBS
        // score of 91.60" beside a badge reading "GIVING A (92)", one of them promoted at
        // position 1. The frozen figure is a curation-time SNAPSHOT of a number this route
        // already overrides live three lines above, so it also goes stale on the next score:all.
        // `taggedPersonIds.length` is load-bearing, not defensive: the live score belongs to the
        // PRIMARY tagged person and the summary can name a different one, so on a two-person card
        // an unguarded repair would print one person's figure under another's name — and at a
        // score of 0 that is a manufactured false zero about someone real. Drop on doubt; the
        // `check:card-badge` gate still surfaces the card.
        // B-037 PROSE leg, outermost because it REMOVES rather than restates. The chip strip
        // three lines above has been live since 2026-09-02 and never touched the sentence beside
        // it, so `ac844ce9` served a null political chip and "available records list $1.8 million
        // in political donations" in the same card until today. Gated on the SAME
        // `withheldPolitical` decision the profile uses — this never re-derives who is withheld.
        summary: (primaryId != null && withheldPolitical.has(primaryId)
          ? withholdPoliticalProse
          : (s: string) => s)(
          // 2026-09-27: restate the political-donation TOTAL at the chip's live figure. Anchored on
          // the chip FROZEN beside this summary (`ctx.political`, read before the override above), so
          // only the figure the curator wrote from that chip is touched. Inside the withhold, which
          // still removes the whole paragraph for a withheld person.
          repairPoliticalProse(
            repairScoreProse(
              primaryId != null
                ? repairFoundationProse(item.summary, foundationFacts.get(primaryId))
                : item.summary,
              live ?? null,
              taggedPersonIds.length
            ),
            ctx.political,
            primaryId != null ? politicalTotals.get(primaryId) : undefined,
            taggedPersonIds.length
          )
        ),
        // B-065 — the chip's age label, whether the grade divides by that figure, and the earlier figure
        // the text was written from. The card states these in one sentence (`netWorthAgeNote`); the prose
        // itself is NOT relabelled — three review rounds found an inline matcher labelling the wrong money.
        netWorthAsOf: nw.netWorthAsOf,
        gradeUsesStaleNetWorth: nw.gradeUsesStaleNetWorth,
        netWorthTextFigure: nw.textFigure,
        // B-037 DISPLAY leg. The two strips above make the card honest and MUTE: on a withheld
        // person `withholdPoliticalProse` returns "", so the card renders a headline over an empty
        // <p> and the reader is told nothing about why. The profile explains itself well in the
        // same situation (and Cycle 16 named that notice the page at its best); the card, which is
        // the surface a reader actually meets and shares, said nothing. Exposed as a FLAG rather
        // than a sentence because the copy belongs to the client, and read from the SAME
        // `withheldPolitical` decision the chip and the prose strip use — never re-derived.
        politicalWithheld: primaryId != null && withheldPolitical.has(primaryId),
        // Absent (undefined) on the ~90% of cards with no curated giving fact —
        // never 0, which would assert a named living person gives nothing.
        givingRatio: primaryId != null ? givingRatios.get(primaryId) : undefined,
        persons: taggedPersons,
        commentCount: commentMap.get(item.id) ?? 0,
      };
    });

    return {
      data,
      pagination: { page, limit, total: Number(total[0].count), promotedCount: head.length },
    };
  });

  // Get a single feed item by id — the deep-link target for shared cards.
  // Same enrichment as the list (tagged persons, live v2 PBS, comment count)
  // so a cold, unauthenticated visitor who clicks a shared receipt lands on
  // exactly that card. Returns 404 if the item no longer exists.
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: "Feed item not found" });
    }

    const [item] = await db
      .select()
      .from(feedItems)
      .where(eq(feedItems.id, id))
      .limit(1);

    if (!item) {
      return reply.status(404).send({ error: "Feed item not found" });
    }

    const junctions = await db
      .select({ personId: feedItemPersons.personId })
      .from(feedItemPersons)
      .where(eq(feedItemPersons.feedItemId, id));
    const personIds = junctions.map((j) => j.personId);

    let taggedPersons: { id: string; name: string; images: string[]; state: string | null }[] = [];
    let live: number | undefined;
    let ratio: GivingRatio | undefined;
    let philanthropyChip: string | null | undefined;
    let foundationFact: unknown;
    let politicalWithheld = false;
    let politicalChip: string | undefined;
    let politicalTotal: number | undefined;
    let netWorthFact: NetWorthFactRow | undefined;
    let liveFeatures: unknown;

    if (personIds.length > 0) {
      const personRows = await db
        .select({
          id: persons.id,
          name: persons.name,
          images: persons.images,
          state: persons.state,
        })
        .from(persons)
        .where(inArray(persons.id, personIds));
      const personMap = new Map(personRows.map((p) => [p.id, p]));
      taggedPersons = personIds
        .map((pid) => personMap.get(pid))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));

      // Live PBS for the primary tagged person (same B-005 fix as the list).
      const scoreRows = await db
        .select({ personId: scoreSnapshots.personId, pbs: scoreSnapshots.pbs, date: scoreSnapshots.date, features: scoreSnapshots.features })
        .from(scoreSnapshots)
        .where(inArray(scoreSnapshots.personId, personIds));
      const latestDate = new Map<string, string>();
      const liveScore = new Map<string, number>();
      const featuresById = new Map<string, unknown>();
      for (const s of scoreRows) {
        if (!latestDate.has(s.personId) || s.date > latestDate.get(s.personId)!) {
          latestDate.set(s.personId, s.date);
          liveScore.set(s.personId, Number(s.pbs));
          featuresById.set(s.personId, s.features);
        }
      }
      live = personIds[0] != null ? liveScore.get(personIds[0]) : undefined;
      liveFeatures = personIds[0] != null ? featuresById.get(personIds[0]) : undefined;

      // R-052 — same live join as the list, so a deep-linked card does not
      // silently lose the ratio the feed showed.
      const { ratios, philanthropy, foundationFacts, withheldPolitical, politicalChips, politicalTotals, netWorthFacts } =
        await loadGivingRatios(db, personIds);
      netWorthFact = personIds[0] != null ? netWorthFacts.get(personIds[0]) : undefined;
      ratio = personIds[0] != null ? ratios.get(personIds[0]) : undefined;
      philanthropyChip = personIds[0] != null ? philanthropy.get(personIds[0]) : undefined;
      foundationFact = personIds[0] != null ? foundationFacts.get(personIds[0]) : undefined;
      politicalWithheld = personIds[0] != null && withheldPolitical.has(personIds[0]);
      politicalChip = personIds[0] != null ? politicalChips.get(personIds[0]) : undefined;
      politicalTotal = personIds[0] != null ? politicalTotals.get(personIds[0]) : undefined;
    }

    const commentCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(feedComments)
      .where(and(eq(feedComments.feedItemId, id), eq(feedComments.flagged, false)));

    const ctx = (item.contextData ?? {}) as Record<string, unknown>;
    // B-065, same as the list route — a SHARE lands here, so an undated figure must say so here most.
    const nw = cardNetWorthDisplay(ctx.netWorth, netWorthFact, liveFeatures);
    const contextData = {
      ...ctx,
      netWorth: nw.netWorth,
      pbs: live != null ? live.toFixed(1) : null,
      // Same B-030 live rebuild as the list route — a deep-linked card (which is what a SHARE
      // lands on) must not show a doubled foundation total the feed already corrected.
      ...(philanthropyChip !== undefined ? { philanthropy: philanthropyChip } : {}),
      // Same shared-ladder rebuild as the list route. A deep-linked card is what a SHARE lands
      // on, so a raw float here is the one that travels furthest.
      ...(politicalChip !== undefined ? { political: politicalChip } : {}),
      // B-037, same strip as the list route. A deep-linked card is what a SHARE lands on, so this
      // is the surface where a withheld figure would travel furthest.
      ...(politicalWithheld ? { political: null } : {}),
    };

    return {
      data: {
        ...item,
        contextData,
        // Same B-030 prose repair as the list — a SHARE lands here, so a deep-linked card must
        // not keep asserting the doubled figure the feed already corrected. R-081's score repair
        // rides with it for the same reason: this route is what a shared receipt lands on, so a
        // card contradicting its own badge travels furthest from here.
        // Same one-tagged-person guard as the list route — see the comment there. A deep-linked
        // card is what a SHARE lands on, so a manufactured figure would travel furthest from here.
        // B-037 PROSE leg, same as the list route. A deep-linked card is what a SHARE lands on,
        // so an unsupported political figure about a named living person travels furthest here.
        // Political-total prose repair, same as the list route — a SHARE lands here.
        summary: (politicalWithheld ? withholdPoliticalProse : (s: string) => s)(
          repairPoliticalProse(
            repairScoreProse(
              repairFoundationProse(item.summary, foundationFact),
              live ?? null,
              personIds.length
            ),
            ctx.political,
            politicalTotal,
            personIds.length
          )
        ),
        netWorthAsOf: nw.netWorthAsOf,
        gradeUsesStaleNetWorth: nw.gradeUsesStaleNetWorth,
        netWorthTextFigure: nw.textFigure,
        // B-037 DISPLAY leg, same flag as the list route — and it matters more here: a deep-linked
        // card is what a SHARE lands on, so a body the withhold emptied is the blank a stranger
        // meets first.
        politicalWithheld,
        givingRatio: ratio,
        persons: taggedPersons,
        commentCount: Number(commentCount[0].count),
      },
    };
  });

  // Vote on a feed item (authenticated)
  app.post<{ Params: { id: string } }>(
    "/:id/vote",
    { preHandler: authenticate, config: { rateLimit: VOTE_LIMIT } },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const feedItemId = request.params.id;
      if (!UUID_RE.test(feedItemId)) {
        return reply.status(404).send({ error: "Feed item not found" });
      }
      const body = feedVoteSchema.parse(request.body);

      const directionValue = body.direction === "up" ? 1 : -1;

      await db
        .insert(feedVotes)
        .values({ feedItemId, userId, direction: directionValue })
        .onConflictDoUpdate({
          target: [feedVotes.userId, feedVotes.feedItemId],
          set: { direction: directionValue },
        });

      // Recount
      const counts = await db
        .select({
          ups: sql<number>`count(*) filter (where direction = 1)`,
          downs: sql<number>`count(*) filter (where direction = -1)`,
        })
        .from(feedVotes)
        .where(eq(feedVotes.feedItemId, feedItemId));

      const ups = Number(counts[0].ups);
      const downs = Number(counts[0].downs);

      await db
        .update(feedItems)
        .set({ upvotes: ups, downvotes: downs })
        .where(eq(feedItems.id, feedItemId));

      return reply.send({ upvotes: ups, downvotes: downs });
    }
  );

  // List comments for a feed item. Comments a moderator has hidden
  // (flagged = true) are excluded — user commentary about real named people is
  // a defamation surface, and this filter is what makes the admin hide action
  // below actually take effect everywhere comments render.
  app.get<{ Params: { id: string } }>("/:id/comments", async (request, reply) => {
    const feedItemId = request.params.id;
    if (!UUID_RE.test(feedItemId)) {
      return reply.status(404).send({ error: "Feed item not found" });
    }
    const results = await db
      .select()
      .from(feedComments)
      .where(and(eq(feedComments.feedItemId, feedItemId), eq(feedComments.flagged, false)))
      .orderBy(desc(feedComments.createdAt));
    return { data: results };
  });

  // Post a comment (authenticated)
  app.post<{ Params: { id: string } }>(
    "/:id/comments",
    { preHandler: authenticate, config: { rateLimit: CONTENT_WRITE_LIMIT } },
    async (request, reply) => {
      const userId = (request as any).userId as string;
      const feedItemId = request.params.id;
      if (!UUID_RE.test(feedItemId)) {
        return reply.status(404).send({ error: "Feed item not found" });
      }
      const body = feedCommentSchema.parse(request.body);

      const [comment] = await db
        .insert(feedComments)
        .values({ feedItemId, userId, body: body.body })
        .returning();

      return reply.status(201).send(comment);
    }
  );

  // --- Admin comment moderation — gated by the ADMIN_USER_IDS allowlist
  // (fail-closed, same gate as the R-025 person-proposal review). Comments post
  // instantly (unchanged UX); these give a moderator a removal path, which the
  // platform previously did not have at all.

  // Recent comments across all feed items, hidden ones included — the sweep
  // surface for review. Static route segment, so it never collides with /:id.
  app.get("/comments/recent", { preHandler: authenticateAdmin }, async () => {
    const rows = await db
      .select()
      .from(feedComments)
      .orderBy(desc(feedComments.createdAt))
      .limit(100);
    return { data: rows };
  });

  // Hide or restore a comment. Soft-hide (flagged column) rather than delete,
  // so moderated content stays auditable — relevant for takedown disputes.
  app.post<{ Params: { commentId: string } }>(
    "/comments/:commentId/moderate",
    { preHandler: authenticateAdmin },
    async (request, reply) => {
      const { commentId } = request.params;
      if (!UUID_RE.test(commentId)) {
        return reply.status(404).send({ error: "Comment not found" });
      }
      const { hidden } = feedCommentModerateSchema.parse(request.body);

      const [updated] = await db
        .update(feedComments)
        .set({ flagged: hidden })
        .where(eq(feedComments.id, commentId))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: "Comment not found" });
      }
      return reply.send(updated);
    }
  );
};
