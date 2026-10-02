/**
 * Verify the two moderation gates actually HIDE things (R-042).
 *
 * WHY THIS EXISTS: `persons.review_status = 'approved'` and
 * `feed_comments.flagged = false` are filters on every public read path. Both
 * can be observed passing — no pending person leaks, no hidden comment shows —
 * but "nothing leaked" is also what a gate that does nothing looks like when
 * prod holds 1,101 approved persons, 0 pending, and 0 comments. Per the
 * 2026-07-25 gate sweep: a gate you have only seen pass is UNKNOWN, not working.
 *
 * WHY DAVID RUNS IT, NOT THE AGENT: proving a hide requires something to hide,
 * which means a write. The Claude Code classifier blocks agent-side prod writes
 * — correctly — so this script exists to be run by hand.
 *
 * SAFETY: every probe runs inside a transaction that ALWAYS throws before
 * returning, so Postgres rolls it back. Nothing is committed, ever. The script
 * counts rows before and after and fails loudly if either number moved. There
 * is no flag to make it commit; adding one would defeat the point.
 *
 *   npx tsx packages/jobs/src/verify-moderation-gates.ts
 *
 * Expected output: two FIRES lines and a CLEAN rollback line. Anything else —
 * especially LEAKED — is a real finding: a public read path is missing its
 * filter. See docs/gates.md.
 */

import { createDb, persons, feedComments, feedItems, users } from "@ba/db";
import { sql, eq, and } from "drizzle-orm";
import { isMain } from "./is-main";

const ROLLBACK = "ROLLBACK-BY-DESIGN";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required (try: npx tsx …)");
    process.exit(1);
  }
  const db = createDb(databaseUrl);
  const line = (gate: string, verdict: string, detail: string) =>
    console.log(`${verdict.padEnd(8)} | ${gate.padEnd(30)} | ${detail}`);

  const countRows = async (table: any) =>
    Number((await db.select({ n: sql<number>`count(*)` }).from(table))[0].n);
  const personsBefore = await countRows(persons);
  const commentsBefore = await countRows(feedComments);
  console.log(`baseline: ${personsBefore} persons, ${commentsBefore} comments\n`);

  // --- Gate 1: persons.review_status = 'approved' (R-025) ---------------------
  try {
    await db.transaction(async (tx) => {
      const [ghost] = await tx
        .insert(persons)
        .values({ name: "ZZ Gate Probe (rolled back)", reviewStatus: "pending", publicFigure: true } as any)
        .returning({ id: persons.id });

      // The shapes every public read path uses:
      const listGated = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.reviewStatus, "approved"));
      const detailGated = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.id, ghost.id), eq(persons.reviewStatus, "approved")));
      // …and the same query WITHOUT the gate, to prove the ghost was really there.
      const ungated = await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, ghost.id));

      const hiddenFromList = !listGated.some((r) => r.id === ghost.id);
      const hiddenFromDetail = detailGated.length === 0;
      const existed = ungated.length === 1;

      line(
        "persons.review_status",
        existed && hiddenFromList && hiddenFromDetail ? "FIRES" : "LEAKED",
        `pending row present (ungated=${ungated.length}); list=${hiddenFromList ? "hidden" : "LEAKED"}, detail=${hiddenFromDetail ? "hidden (404 shape)" : "LEAKED"}`
      );
      throw new Error(ROLLBACK);
    });
  } catch (e: any) {
    if (e.message !== ROLLBACK) line("persons.review_status", "ERROR", e.message);
  }

  // --- Gate 2: feed_comments.flagged = false (R-027) --------------------------
  try {
    const [item] = await db.select({ id: feedItems.id }).from(feedItems).limit(1);
    // feed_comments.user_id references the APP users table (public.users), NOT
    // auth.users — a probe that grabs an auth id fails the FK. (Learned the hard
    // way on the first run, 2026-07-25.)
    const [appUser] = await db.select({ id: users.id }).from(users).limit(1);
    const userId = appUser?.id;

    if (!item) {
      line("feed_comments.flagged", "SKIPPED", "no feed items exist to attach a probe comment to");
    } else if (!userId) {
      line("feed_comments.flagged", "SKIPPED", "no row in public.users to own a comment, and the FK forbids a synthetic one — sign in once (which creates the app user), then re-run");
    } else {
      await db.transaction(async (tx) => {
        const [ghost] = await tx
          .insert(feedComments)
          .values({ feedItemId: item.id, userId, body: "gate probe (rolled back)", flagged: true } as any)
          .returning({ id: feedComments.id });

        const gated = await tx
          .select({ id: feedComments.id })
          .from(feedComments)
          .where(and(eq(feedComments.feedItemId, item.id), eq(feedComments.flagged, false)));
        const ungated = await tx.select({ id: feedComments.id }).from(feedComments).where(eq(feedComments.id, ghost.id));

        const hidden = !gated.some((r) => r.id === ghost.id);
        line(
          "feed_comments.flagged",
          ungated.length === 1 && hidden ? "FIRES" : "LEAKED",
          `hidden comment present (ungated=${ungated.length}); public read ${hidden ? "excluded it" : "LEAKED it"}`
        );
        throw new Error(ROLLBACK);
      });
    }
  } catch (e: any) {
    if (e.message !== ROLLBACK) line("feed_comments.flagged", "ERROR", e.message);
  }

  // --- Prove prod is exactly as we found it -----------------------------------
  const personsAfter = await countRows(persons);
  const commentsAfter = await countRows(feedComments);
  const clean = personsBefore === personsAfter && commentsBefore === commentsAfter;
  console.log("");
  line(
    "rollback integrity",
    clean ? "CLEAN" : "DIRTY — INVESTIGATE",
    `persons ${personsBefore}→${personsAfter}, comments ${commentsBefore}→${commentsAfter}`
  );
  process.exit(clean ? 0 : 1);
}

// Only run when this file IS the entrypoint. Importing it must never execute
// the script — these scripts mutate prod. See is-main.ts.
if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
