/**
 * Flow 3 (Profile deep-dive), Cycle 12. Deterministic, read-only, no LLM.
 *
 * The profile's headline grade can carry the caveat "no giving data". It is CORRECT and it means
 * *charitable* giving — `philanthropyZeroKind()` fires only when the philanthropy component is 0
 * AND no giving fact exists. But the word "charitable" lives ONLY in the link's `aria-label`; the
 * VISIBLE text is the bare phrase. So a sighted reader arriving from a feed card about someone's
 * political money reads "no giving data" a few inches above that same page's own
 * "$3,213,200 in federal contributions".
 *
 * This counts the profiles where those two things are true AT ONCE — the population for whom the
 * page appears to contradict itself. It is the read behind the Cycle-12 copy fix.
 *
 * Exit 0 clean · 3 collisions found · 2 UNREADABLE (zero denominator, or buckets that do not sum).
 * A zero denominator is UNREADABLE, never a green: it means the join found nothing to judge.
 */
import { createDb } from "@ba/db";
import { sql } from "drizzle-orm";
import { philanthropyZeroKind } from "@ba/shared";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);
let code = 0;

try {
  const res = await db.execute(sql`
    SELECT p.id, p.name,
           s.features,
           array_agg(f.fact_key) AS fact_keys
    FROM persons p
    JOIN LATERAL (
      SELECT features FROM score_snapshots
      WHERE person_id = p.id ORDER BY date DESC LIMIT 1
    ) s ON true
    LEFT JOIN person_facts f ON f.person_id = p.id
    WHERE p.review_status = 'approved'
    GROUP BY p.id, p.name, s.features
  `);
  // `execute()` returns the RowList itself here (postgres-js), not a { rows } envelope — the
  // `.rows` shape belongs to a different driver. Typecheck caught the wrong one.
  const rows = res as unknown as Record<string, unknown>[];

  const collisionIds: { id: string; name: string }[] = [];
  let caveated = 0;
  let collision = 0;
  let clean = 0;
  let unreadable = 0;

  for (const r of rows) {
    const features = (typeof r.features === "string" ? JSON.parse(r.features) : r.features) as
      | Record<string, number>
      | null;
    const keys = ((r.fact_keys as string[] | null) ?? []).filter((k): k is string => Boolean(k));
    if (!features || typeof features !== "object") {
      unreadable++;
      continue;
    }
    const kind = philanthropyZeroKind(features.philanthropy, keys);
    if (kind !== "unevidenced") {
      clean++;
      continue;
    }
    caveated++;
    // MONEY THE SAME PAGE STATES ELSEWHERE. Any of these renders a figure below the caveat.
    const hasOtherMoney = keys.some((k) =>
      ["fec_contributions", "foundation_990s", "total_giving"].includes(k)
    );
    if (hasOtherMoney) {
      collision++;
      collisionIds.push({ id: String(r.id), name: String(r.name) });
    }
  }

  console.log(`approved persons with a score snapshot: ${rows.length}`);
  console.log(`  carrying the philanthropy caveat:            ${caveated}`);
  console.log(`    OF THOSE, page also states other money:    ${collision}   <-- the collision population`);
  console.log(`  no caveat (component non-zero or evidenced): ${clean}`);
  console.log(`  UNREADABLE — no usable features blob:        ${unreadable}`);
  const sum = caveated + clean + unreadable;
  console.log(`SUM-CHECK ${sum} = ${rows.length}`);

  if (rows.length === 0 || sum !== rows.length) {
    console.log("RESULT: UNREADABLE — zero denominator or buckets do not sum (exit 2)");
    code = 2;
  } else if (collision === 0) {
    // Not a green. The collision population is the input set this gate judges; an empty one
    // means the join stopped finding it, not that the pages got better.
    console.log("RESULT: UNREADABLE — collision population is 0, nothing to assert against (exit 2)");
    code = 2;
  } else {
    // THE ASSERTION IS ON THE RENDER, NOT THE COUNT. 194 profiles legitimately carry a
    // philanthropy caveat beside political money — that coexistence is CORRECT and permanent.
    // What must hold is that the visible caveat says WHICH giving it means. A gate that reds on
    // the population would be red forever and get muted; this one reds only on the wording.
    const site = process.env.BA_SITE_BASE || "https://billionaire.army";
    const sample = collisionIds.slice(0, Number(process.env.CAVEAT_SAMPLE || 12));
    let ok = 0;
    let bare = 0;
    let unread = 0;
    for (const { id, name } of sample) {
      try {
        const res = await fetch(`${site}/billionaires/${id}?cb=${Date.now()}`, {
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) {
          unread++;
          continue;
        }
        const html = await res.text();
        // The caveat link's own visible text. Entity-decoded so a stray escape cannot hide it.
        const text = html.replace(/&#x27;|&rsquo;/g, "'").replace(/&amp;/g, "&");
        const hasCaveat = /no charitable giving data|no giving data/i.test(text);
        if (!hasCaveat) {
          unread++;
          continue;
        }
        if (/no charitable giving data/i.test(text)) ok++;
        else {
          bare++;
          console.log(`  BARE CAVEAT: ${name} [${id}] renders "no giving data" with money on the same page`);
        }
      } catch {
        unread++;
      }
    }
    console.log(`sampled ${sample.length} collision profile(s) on ${site}`);
    console.log(`  caveat names the giving TYPE ("charitable"): ${ok}`);
    console.log(`  BARE "no giving data" beside other money:    ${bare}`);
    console.log(`  UNREADABLE — non-200 / no caveat rendered:    ${unread}`);
    console.log(`SUM-CHECK ${ok + bare + unread} = ${sample.length}`);
    if (ok + bare === 0) {
      console.log("RESULT: UNREADABLE — no sampled page rendered a caveat at all (exit 2)");
      code = 2;
    } else if (bare > 0) {
      console.log(`RESULT: COLLISION — ${bare} profile(s) render a bare caveat beside money the same page states (exit 3)`);
      code = 3;
    } else {
      console.log(`RESULT: CLEAN — all ${ok} sampled collision profile(s) name the giving type (exit 0)`);
      code = 0;
    }
  }
} catch (err) {
  console.log(`RESULT: UNREADABLE — ${err instanceof Error ? err.message : String(err)} (exit 2)`);
  code = 2;
} finally {
  await db.$client.end();
}

process.exitCode = code;
