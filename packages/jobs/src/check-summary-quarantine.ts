/**
 * READ-ONLY. B-045 closeWhen (c): the quarantine count, readable by a committed command and reported
 * at P2 on any day a regeneration ran. Reads every summary_quarantine row the C2 figure block wrote.
 *
 * Denominator: sections currently published in approved persons' profile_summary rows — the base
 * B-045's escalation clause measures against ("quarantine count exceeds 5% of eligible sections").
 * A CONTROL line proves the block quarantines a planted disagreement, so a zero here is a reading and
 * not a dead probe. Until the regeneration lock lifts, 0 rows is the EXPECTED value.
 *
 * Usage: npm run check:summary-quarantine [-- --since YYYY-MM-DD]
 * Exit: 0 read · 1 bad input · 2 UNREADABLE (no denominator, or the control failed) · 3 ESCALATE (>5%).
 */
import { createDb } from "@ba/db";
import { applyFigureBlock, SUMMARY_QUARANTINE_FACT_KEY, type QuarantineEntry } from "@ba/shared";
import { sql } from "drizzle-orm";

const SECTIONS = ["overview", "business", "philanthropy", "political", "newsDigest"];
const ESCALATE_RATE = 0.05;

const parse = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };

/** A quarantine row's entries, or null when the row cannot be read — never an empty list for a broken row. */
function readEntries(factValue: unknown): QuarantineEntry[] | null {
  const entries = (parse(factValue) as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const ok = entries.every((e: any) =>
    e && typeof e.section === "string" && typeof e.candidate === "string" && Array.isArray(e.disagreements) &&
    e.disagreements.length > 0 && (e.kept === "previous" || e.kept === "withheld"));
  return ok ? (entries as QuarantineEntry[]) : null;
}

const args = process.argv.slice(2);
const since = args[0] === "--since" && /^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "") ? args[1] : null;
if (args.length > 0 && !since) {
  console.error(`BAD INPUT: expected no arguments or --since YYYY-MM-DD, got: ${args.join(" ")}`);
  console.log("RESULT: BAD INPUT (exit 1)");
  process.exitCode = 1;
} else {
  const db = createDb(process.env.DATABASE_URL!);
  let code = 0;
  try {
    const summaries = [...(await db.execute(sql`
      SELECT f.fact_value FROM person_facts f JOIN persons p ON p.id = f.person_id
      WHERE f.fact_key = 'profile_summary' AND p.review_status = 'approved'
    `))];
    const eligible = summaries.reduce<number>((n, r: any) => {
      const v = parse(r.fact_value) as Record<string, unknown> | null;
      return n + SECTIONS.filter((s) => typeof v?.[s] === "string").length;
    }, 0);
    const rows = [...(await db.execute(sql`
      SELECT p.name, f.fact_value, f.retrieved_at FROM person_facts f JOIN persons p ON p.id = f.person_id
      WHERE f.fact_key = ${SUMMARY_QUARANTINE_FACT_KEY} ${since ? sql`AND f.retrieved_at >= ${since}::date` : sql``}
      ORDER BY f.retrieved_at DESC
    `))];
    let kept = 0, withheld = 0, unreadable = 0;
    for (const r of rows as any[]) {
      const entries = readEntries(r.fact_value);
      if (!entries) {
        unreadable++;
        console.log(`  UNREADABLE quarantine row  ${r.name}  ${new Date(r.retrieved_at).toISOString()}`);
        continue;
      }
      for (const e of entries) {
        e.kept === "previous" ? kept++ : withheld++;
        const pair = e.disagreements.map((d) => `$${d.stated.toLocaleString("en-US")} vs stored $${d.stored.toLocaleString("en-US")}`).join("; ");
        console.log(`  ${new Date(r.retrieved_at).toISOString().slice(0, 10)}  ${r.name}  ${e.section}  ${e.kept === "previous" ? "KEPT published" : "WITHHELD (first gen)"}  ${pair}`);
      }
    }
    const total = kept + withheld;
    // CONTROLS run through readEntries, the SAME parse this read applies to database rows: a planted
    // quarantine must count as one entry, and a malformed row must read as unreadable, never as zero.
    const control = applyFigureBlock({ philanthropy: "More than $123,450." }, { philanthropy: "Old." }, ["philanthropy"], [123459]);
    const controlOk = control.summary.philanthropy === "Old." &&
      readEntries(JSON.stringify({ entries: control.quarantined }))?.length === 1 &&
      readEntries({}) === null && readEntries({ entries: [] }) === null;
    console.log(`eligible sections (published, approved persons): ${eligible} across ${summaries.length} summaries`);
    console.log(`quarantine rows${since ? ` since ${since}` : ""}: ${rows.length} (${unreadable} UNREADABLE) · entries ${total} (${kept} published section(s) KEPT, ${withheld} first-generation WITHHELD)`);
    console.log(`CONTROL quarantines a planted disagreement, counts it through the row parser, and refuses a malformed row: ${controlOk}`);
    if (eligible === 0 || !controlOk || unreadable > 0) code = 2;
    else if (total / eligible > ESCALATE_RATE) {
      console.log(`ESCALATE [B-045 closeWhen]: ${total} of ${eligible} eligible sections = ${(100 * total / eligible).toFixed(1)}% > 5% — card this for the owner`);
      code = 3;
    }
  } catch (err) {
    console.error(`UNREADABLE: ${err instanceof Error ? err.message : String(err)}`);
    code = 2;
  }
  await db.$client.end();
  console.log(`RESULT: ${code === 0 ? "READ" : code === 2 ? "UNREADABLE" : "ESCALATE"} (exit ${code})`);
  process.exitCode = code;
}
