/**
 * NOT GRADED — the whole-population read behind the rule in `@ba/shared/pbs-evidence.ts`.
 *
 * Read-only. Proves its connection on the open socket and reads inside a READ ONLY transaction.
 * The predicate is IMPORTED (`gradeStatus`), never re-derived here.
 *
 *   npx tsx packages/jobs/src/check-not-graded.ts            population only
 *   npx tsx packages/jobs/src/check-not-graded.ts --served   + what the API and pages serve
 *
 * POPULATION prints, over every approved person: how many are graded / not graded, which letter
 * the not-graded ones would wear from the stored score, and how many of them are Giving Pledge
 * signers scoring off the pledge alone. Buckets must sum or the read is UNREADABLE.
 *
 * SERVED (`--served`) then asks the live API and the live pages what a reader gets:
 *   - /api/persons/leaderboard and /api/persons: a not-graded person carries NO score, a graded
 *     person with a stored score still carries one (the positive control — a route that nulled
 *     everybody would otherwise read clean);
 *   - /api/persons/:id and the profile HTML for EVERY not-graded person: no score in the payload,
 *     no letter or number in <title>, the meta description or JSON-LD, and "Not graded" present;
 *   - every page of /api/feed, then each such card again by /api/feed/:id: a card tagging ANY
 *     not-graded person carries no score chip and names no score in its headline or summary;
 *   - the leaderboard's ORDER: no graded row after a not-graded one, and the not-graded never in
 *     the order of the score we withhold.
 *
 * WHAT IT DOES NOT SEE (say this when you quote a CLEAN): the two share IMAGES (binary), the
 * client-built share text, /compare, /today's ten beyond the directory fields, goal matches, and
 * any sentence that grades a person without naming our score (`statesOwnScore`'s stated ceiling).
 *
 * Exit 0 clean · 3 a not-graded person is served a score (or a graded one lost theirs) ·
 * 2 UNREADABLE (no connection, buckets that do not sum, a zero denominator, a fetch that failed).
 */
import { sql } from "drizzle-orm";
import { createDb } from "@ba/db";
import {
  gradeStatus,
  pbsGrade,
  NOT_GRADED_LABEL,
  statesOwnScore,
} from "@ba/shared";
import { isMain } from "./is-main";

interface Row {
  id: string;
  name: string;
  pbs: string | null;
  features: unknown;
  fact_keys: (string | null)[] | null;
}

const API = (process.env.BA_API_BASE || "https://ba-api-m1dh.onrender.com").replace(/\/$/, "");
const SITE = (process.env.BA_SITE_BASE || "https://billionaire.army").replace(/\/$/, "");
const CONCURRENCY = Number(process.env.NOT_GRADED_CONCURRENCY || 4);

/** A score stated in a page's head: "Giving Score F (13)", "giving score F (13/100)". */
const HEAD_SCORE = /giving\s+(?:score|grade)\s+[A-F]\b|\bgiving\s+(?:score|grade)\s*:?\s*\d/i;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

function headOf(html: string): { title: string; description: string; jsonLd: string } {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const description = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] ?? "";
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .join("\n");
  return { title, description, jsonLd };
}

async function main() {
  const served = process.argv.includes("--served");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("UNREADABLE — DATABASE_URL is not set. Nothing was read.");
    process.exitCode = 2;
    return;
  }
  const db = createDb(url);
  let rows: Row[] = [];
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      const who = (await tx.execute(
        sql`select (select system_identifier from pg_control_system())::text as sysid, current_database() as db, current_setting('transaction_read_only') as ro`,
      )) as unknown as { sysid: string; db: string; ro: string }[];
      console.log(`connection: system_identifier=${who[0].sysid} database=${who[0].db} transaction_read_only=${who[0].ro}`);
      if (who[0].ro !== "on") throw new Error("refusing: transaction is not read-only");
      rows = (await tx.execute(sql`
        select p.id, p.name, s.pbs, s.features,
               (select array_agg(f.fact_key) from person_facts f where f.person_id = p.id) as fact_keys
        from persons p
        left join lateral (
          select pbs, features from score_snapshots where person_id = p.id order by date desc limit 1
        ) s on true
        where p.review_status = 'approved'
        order by p.name`)) as unknown as Row[];
    });
  } catch (err) {
    console.log(`RESULT: UNREADABLE — ${err instanceof Error ? err.message : String(err)} (exit 2)`);
    process.exitCode = 2;
    await db.$client.end();
    return;
  }
  await db.$client.end();

  // ── POPULATION ────────────────────────────────────────────────────────────────────────────
  const notGraded: Row[] = [];
  const gradedScored: Row[] = [];
  let gradedUnscored = 0;
  let ngZeroComponent = 0;
  let ngPledgeOnly = 0;
  let ngOtherNonZero = 0;
  let ngNoSnapshot = 0;
  const letters: Record<string, number> = {};
  for (const r of rows) {
    const keys = (r.fact_keys ?? []).filter((k): k is string => Boolean(k));
    if (gradeStatus(keys) === "graded") {
      if (r.pbs == null) gradedUnscored++;
      else gradedScored.push(r);
      continue;
    }
    notGraded.push(r);
    if (r.pbs == null) {
      ngNoSnapshot++;
      continue;
    }
    const letter = pbsGrade(Number(r.pbs)).letter;
    letters[letter] = (letters[letter] ?? 0) + 1;
    const f = (typeof r.features === "string" ? JSON.parse(r.features) : r.features) as Record<string, number> | null;
    const component = Number(f?.philanthropy ?? 0);
    if (component === 0) ngZeroComponent++;
    else if (Number(f?.pledge ?? 0) === 1) ngPledgeOnly++;
    else ngOtherNonZero++;
  }
  console.log(`approved persons: ${rows.length}`);
  console.log(`  GRADED (a giving fact on file):                  ${gradedScored.length + gradedUnscored}`);
  console.log(`    with a stored score:                           ${gradedScored.length}`);
  console.log(`    no stored score yet:                           ${gradedUnscored}`);
  console.log(`  NOT GRADED (no giving fact on file):             ${notGraded.length}`);
  console.log(`    stored component is 0:                         ${ngZeroComponent}`);
  console.log(`    Giving Pledge signer, scoring off the pledge:  ${ngPledgeOnly}`);
  console.log(`    non-zero for another reason:                   ${ngOtherNonZero}   <-- must be 0; anything here is a giving input this rule does not know`);
  console.log(`    no stored score:                               ${ngNoSnapshot}`);
  console.log(`  letter the stored score gives the not-graded:    ${["A", "B", "C", "D", "F"].map((l) => `${l} ${letters[l] ?? 0}`).join(" · ")}`);
  const popSum = gradedScored.length + gradedUnscored + ngZeroComponent + ngPledgeOnly + ngOtherNonZero + ngNoSnapshot;
  console.log(`SUM-CHECK ${popSum} = ${rows.length}`);
  if (rows.length === 0 || popSum !== rows.length) {
    console.log("RESULT: UNREADABLE — zero denominator or buckets do not sum (exit 2)");
    process.exitCode = 2;
    return;
  }
  if (notGraded.length === 0 || gradedScored.length === 0) {
    console.log("RESULT: UNREADABLE — one side of the rule is empty, nothing to assert against (exit 2)");
    process.exitCode = 2;
    return;
  }
  if (!served) {
    console.log(ngOtherNonZero > 0
      ? "RESULT: FINDING — a not-graded person scores above zero without a pledge (exit 3)"
      : "RESULT: POPULATION READ (run with --served for what readers get, exit 0)");
    process.exitCode = ngOtherNonZero > 0 ? 3 : 0;
    return;
  }

  // ── SERVED ────────────────────────────────────────────────────────────────────────────────
  const ngIds = new Set(notGraded.map((r) => r.id));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const offenders: string[] = [];
  let unread = 0;
  const cb = Date.now();

  // 1. Leaderboard API — both sides.
  try {
    const lb = (await getJson(`${API}/api/persons/leaderboard?limit=2000&cb=${cb}`)) as {
      data: { person: { id: string }; pbs: unknown; gradeStatus?: string }[];
    };
    const seen = new Map(lb.data.map((e) => [e.person.id, e]));
    let ngServed = 0, ngClean = 0, gServed = 0, gKept = 0;
    for (const r of notGraded) {
      const e = seen.get(r.id);
      if (!e) continue; // no stored score → never on the leaderboard
      ngServed++;
      if (e.pbs == null && e.gradeStatus === "not_graded") ngClean++;
      else offenders.push(`leaderboard API serves a score for ${r.name} [${r.id}]: pbs=${String(e.pbs)} gradeStatus=${String(e.gradeStatus)}`);
    }
    for (const r of gradedScored) {
      const e = seen.get(r.id);
      if (!e) continue;
      gServed++;
      if (e.pbs != null && Number.isFinite(Number(e.pbs))) gKept++;
      else offenders.push(`leaderboard API LOST the score of graded ${r.name} [${r.id}]`);
    }
    console.log(`leaderboard API: not-graded with no score ${ngClean} of ${ngServed} · graded still scored ${gKept} of ${gServed} (${lb.data.length} rows served)`);
    if (ngServed === 0 || gServed === 0) unread++;
    // The stored score must be the SAME number, not merely present.
    let moved = 0;
    for (const r of gradedScored) {
      const e = seen.get(r.id);
      if (e && e.pbs != null && Number(e.pbs) !== Number(r.pbs)) moved++;
    }
    if (moved > 0) offenders.push(`leaderboard API: ${moved} graded score(s) differ from the stored score`);
    // ORDER: every graded row before every not-graded row, and the not-graded in NAME order —
    // never in the order of the score we withhold (Codex r1 #3). Features ride null with the score.
    const order = lb.data.map((e) => ({ ng: ngIds.has(e.person.id), name: nameById.get(e.person.id) ?? "", e }));
    const firstNg = order.findIndex((o) => o.ng);
    const gradedAfter = firstNg < 0 ? 0 : order.slice(firstNg).filter((o) => !o.ng).length;
    // "In withheld-score order" = the stored scores never RISE down the served not-graded rows,
    // while at least two of them differ. Collation-free on purpose (Postgres and JS sort names
    // differently), and a tie cannot fire it: the first version compared against a stable sort,
    // so two alphabetical neighbours with EQUAL scores read as score-ordered (Codex r2 #2).
    const storedById = new Map(rows.map((r) => [r.id, Number(r.pbs ?? 0)]));
    const ngScores = order.filter((o) => o.ng).map((o) => storedById.get(o.e.person.id) ?? 0);
    const inScoreOrder =
      new Set(ngScores).size > 1 && ngScores.every((s, i) => i === 0 || ngScores[i - 1] >= s);
    const withFeatures = order.filter((o) => o.ng && (o.e as { features?: unknown }).features != null).length;
    console.log(`leaderboard order: graded rows after the first not-graded ${gradedAfter} · not-graded served in withheld-score order: ${inScoreOrder ? "YES" : "no"} · not-graded carrying features ${withFeatures}`);
    if (gradedAfter > 0) offenders.push(`leaderboard order: ${gradedAfter} graded row(s) listed after a not-graded one`);
    if (inScoreOrder) offenders.push("leaderboard order: the not-graded are served in the order of the score we withhold");
    if (withFeatures > 0) offenders.push(`leaderboard order: ${withFeatures} not-graded row(s) still carry score features`);
  } catch (err) {
    console.log(`leaderboard API: UNREADABLE — ${err instanceof Error ? err.message : String(err)}`);
    unread++;
  }

  // 2. Directory API (the /billionaires cards).
  try {
    const dir = (await getJson(`${API}/api/persons?limit=2000&cb=${cb}`)) as {
      data: { id: string; pbs?: unknown; gradeStatus?: string }[];
    };
    let ngServed = 0, ngClean = 0, gServed = 0, gKept = 0;
    const scored = new Set(gradedScored.map((r) => r.id));
    for (const p of dir.data) {
      if (ngIds.has(p.id)) {
        ngServed++;
        if (p.pbs == null && p.gradeStatus === "not_graded") ngClean++;
        else offenders.push(`directory API serves a score for ${nameById.get(p.id)} [${p.id}]: pbs=${String(p.pbs)}`);
      } else if (scored.has(p.id)) {
        gServed++;
        if (p.pbs != null) gKept++;
        else offenders.push(`directory API LOST the score of graded ${nameById.get(p.id)} [${p.id}]`);
      }
    }
    console.log(`directory API:   not-graded with no score ${ngClean} of ${ngServed} · graded still scored ${gKept} of ${gServed} (${dir.data.length} rows served)`);
    if (ngServed !== notGraded.length) {
      console.log(`  directory served ${ngServed} of the ${notGraded.length} not-graded — the rest were NOT read`);
      unread++;
    }
  } catch (err) {
    console.log(`directory API:   UNREADABLE — ${err instanceof Error ? err.message : String(err)}`);
    unread++;
  }

  // 3. Every not-graded person's profile: API payload + served HTML head and body.
  let apiClean = 0, htmlClean = 0, apiRead = 0, htmlRead = 0;
  await pool(notGraded, async (r) => {
    try {
      const p = (await getJson(`${API}/api/persons/${r.id}?cb=${cb}`)) as { score?: unknown; gradeStatus?: string };
      apiRead++;
      if (p.score == null && p.gradeStatus === "not_graded") apiClean++;
      else offenders.push(`profile API serves a score for ${r.name} [${r.id}]`);
    } catch {
      unread++;
    }
    try {
      const res = await fetch(`${SITE}/billionaires/${r.id}?cb=${cb}`, { headers: { "Cache-Control": "no-cache" } });
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      htmlRead++;
      const head = headOf(html);
      const bad: string[] = [];
      if (HEAD_SCORE.test(head.title)) bad.push(`title "${head.title}"`);
      if (HEAD_SCORE.test(head.description)) bad.push("meta description");
      if (!head.title.includes(NOT_GRADED_LABEL)) bad.push(`title does not say "${NOT_GRADED_LABEL}"`);
      // A letter, a rating, or a NUMERIC value on the Giving-score property (Codex r1: a number
      // with no alternateName got past the first version of this line).
      if (/"alternateName"\s*:\s*"[A-F]"|"ratingValue"|Giving Score [A-F]\b|"name"\s*:\s*"Giving score"\s*,\s*"value"\s*:\s*-?\d/i.test(head.jsonLd)) bad.push("JSON-LD states a score");
      if (!head.jsonLd.includes(NOT_GRADED_LABEL)) bad.push(`JSON-LD does not say "${NOT_GRADED_LABEL}"`);
      // The VISIBLE label, by its own class — the title and JSON-LD now carry the words too, so a
      // whole-document search would pass on a page whose body says nothing (Codex r2 #3).
      if (!/class="profile-not-graded"[^>]*>[^<]*Not graded/.test(html)) bad.push(`no visible "${NOT_GRADED_LABEL}" in the page body`);
      // The grade disc itself — the body must not draw one beside the words.
      if (/class="profile-grade(?:-sm)?"/.test(html)) bad.push("a grade disc is rendered in the body");
      if (bad.length) offenders.push(`profile page for ${r.name} [${r.id}]: ${bad.join("; ")}`);
      else htmlClean++;
    } catch {
      unread++;
    }
  });
  console.log(`profile API:     not-graded with no score ${apiClean} of ${apiRead} read (of ${notGraded.length})`);
  console.log(`profile pages:   head and body clean ${htmlClean} of ${htmlRead} read (of ${notGraded.length})`);

  // 3b. Positive control on the page: graded people still show their grade in <title>.
  // Three ordinary graded people plus up to two EVIDENCED ZEROS (a giving fact on file, component
  // 0) — the control that separates "no giving record" from "a record that reports nothing".
  const evidencedZero = gradedScored.filter((r) => {
    const f = (typeof r.features === "string" ? JSON.parse(r.features) : r.features) as Record<string, number> | null;
    // A PRESENT zero only — a missing component is not an evidenced zero (Codex r2 #4).
    return typeof f?.philanthropy === "number" && f.philanthropy === 0;
  });
  const controls = [...gradedScored.slice(0, 3), ...evidencedZero.slice(0, 2)];
  console.log(`graded controls: ${controls.length} (${Math.min(2, evidencedZero.length)} evidenced-zero of ${evidencedZero.length} in the population)`);
  let controlKept = 0;
  for (const r of controls) {
    try {
      const res = await fetch(`${SITE}/billionaires/${r.id}?cb=${cb}`, { headers: { "Cache-Control": "no-cache" } });
      const html = res.ok ? await res.text() : "";
      if (HEAD_SCORE.test(headOf(html).title)) controlKept++;
      else offenders.push(`graded control ${r.name} [${r.id}] LOST its grade in <title>`);
    } catch {
      unread++;
    }
  }
  console.log(`graded controls: grade still in <title> ${controlKept} of ${controls.length}`);

  // 4. Every page of the feed.
  try {
    let page = 1, cards = 0, ngCards = 0, ngCardsClean = 0, total = Infinity;
    const ngCardIds: string[] = [];
    const judge = (c: { id: string; headline: string; summary: string; contextData?: { pbs?: unknown }; gradeStatus?: string }, route: string): boolean => {
      const bad: string[] = [];
      // ANY not-graded tag ⇒ no chip on the card at all, whoever the primary person is.
      if (c.contextData?.pbs != null) bad.push(`score chip ${String(c.contextData.pbs)}`);
      if (c.gradeStatus !== "not_graded") bad.push(`gradeStatus=${String(c.gradeStatus)}`);
      if (statesOwnScore(c.summary)) bad.push("summary names a score");
      if (statesOwnScore(c.headline)) bad.push("HEADLINE names a score");
      if (bad.length) offenders.push(`feed card (${route}): ${c.id} ${bad.join("; ")}`);
      return bad.length === 0;
    };
    while (cards < total) {
      const f = (await getJson(`${API}/api/feed?limit=100&page=${page}&cb=${cb}`)) as {
        data: { id: string; headline: string; summary: string; contextData?: { pbs?: unknown }; gradeStatus?: string; persons?: { id: string }[] }[];
        pagination: { total: number };
      };
      total = f.pagination.total;
      if (f.data.length === 0) break;
      for (const c of f.data) {
        cards++;
        if (!(c.persons ?? []).some((p) => ngIds.has(p.id))) continue;
        ngCards++;
        ngCardIds.push(c.id);
        if (judge(c, "list")) ngCardsClean++;
      }
      page++;
    }
    console.log(`feed:            cards tagging a not-graded person, clean ${ngCardsClean} of ${ngCards} (${cards} of ${total} cards read)`);
    if (cards !== total) unread++;
    // The deep-link route is separate code and is what a SHARE lands on — read every one of them.
    let soloClean = 0, soloRead = 0;
    for (const id of ngCardIds) {
      try {
        const one = (await getJson(`${API}/api/feed/${id}?cb=${cb}`)) as { data: Parameters<typeof judge>[0] };
        soloRead++;
        if (judge(one.data, "single")) soloClean++;
      } catch {
        unread++;
      }
    }
    console.log(`feed (single):   the same cards by /api/feed/:id, clean ${soloClean} of ${soloRead} read (of ${ngCardIds.length})`);
  } catch (err) {
    console.log(`feed:            UNREADABLE — ${err instanceof Error ? err.message : String(err)}`);
    unread++;
  }

  // Per surface, so one loud surface cannot hide another past a print cap.
  const bySurface = new Map<string, string[]>();
  for (const o of offenders) {
    const surface = o.split(/ for | \[|: /)[0].replace(/ [0-9a-f-]{36}$/, "");
    bySurface.set(surface, [...(bySurface.get(surface) ?? []), o]);
  }
  for (const [surface, list] of bySurface) {
    console.log(`  ${surface}: ${list.length} offender(s)`);
    for (const o of list.slice(0, 5)) console.log(`    OFFENDER: ${o}`);
  }
  if (offenders.length > 0) {
    console.log(`RESULT: SERVED A SCORE — ${offenders.length} offender(s) (exit 3)`);
    process.exitCode = 3;
  } else if (unread > 0 || apiRead !== notGraded.length || htmlRead !== notGraded.length) {
    console.log(`RESULT: UNREADABLE — ${unread} read(s) failed or came back short; a clean count over a partial read is not a clean (exit 2)`);
    process.exitCode = 2;
  } else {
    console.log(`RESULT: CLEAN — ${notGraded.length} not-graded person(s), no score served on any surface read (exit 0)`);
    process.exitCode = 0;
  }
}

if (isMain(import.meta.url)) await main();
