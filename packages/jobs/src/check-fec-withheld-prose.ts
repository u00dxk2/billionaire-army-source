/**
 * READ-ONLY. Pins the B-037 render invariant across both stored input and served HTML:
 * when the shared FEC attribution guard withholds contribution figures, the stored
 * profile-summary prose must not leak those figures through a "Political Activity" section.
 *
 * The withholding decision is imported from @ba/shared. Do not restate its age/date rule here.
 *
 * `--stored` (B-044) asks the question the page read cannot: the profile withholds ONLY the stored
 * `political` section, and every OTHER stored section (overview, business, philanthropy, newsDigest)
 * renders verbatim — so a political figure written into one of those reaches the page past the
 * withhold. It scans the SAME withheld population with the SAME `withholdPoliticalProse` matcher the
 * feed uses, reading the stored text rather than the rendered page.
 *
 * Usage: npm run check:fec-withheld · npm run check:fec-withheld-stored
 * Selftest: npm run check:fec-withheld -- --selftest
 *
 * Exit: 0 clean · 1 bad input/selftest failure · 2 UNREADABLE · 3 finding.
 */
import { createDb } from "@ba/db";
import { isFecRecordImpossible, withholdPoliticalProse } from "@ba/shared";
import { sql } from "drizzle-orm";

type ExitCode = 0 | 1 | 2 | 3;
type Verdict = "CLEAN" | "FINDING" | "UNREADABLE" | "BAD INPUT";
type RunResult = { code: ExitCode; verdict: Verdict };

type FecRow = {
  name: string;
  id: string;
  birth_year: number | null;
  fact_value: unknown;
};

type SummaryRow = {
  person_id: string;
  fact_value: unknown;
};

type WithheldPerson = {
  name: string;
  id: string;
};

type PageBucket =
  | { bucket: "clean"; person: WithheldPerson }
  | { bucket: "finding"; person: WithheldPerson }
  | { bucket: "unreadable"; person: WithheldPerson; reasons: string[] };

const DEFAULT_SITE_BASE = "https://billionaire.army";
const FETCH_TIMEOUT_MS = 30_000;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fecDateRange(value: unknown): string | undefined {
  const fact = parseJson(value);
  return isRecord(fact) && typeof fact.dateRange === "string" ? fact.dateRange : undefined;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => ({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    })[entity.toLowerCase()] ?? `&${entity};`)
    .replace(/\s+/g, " ")
    .trim();
}

/** True only when the rendered heading has non-empty summary prose beneath it. */
export function hasPoliticalActivityProse(html: string): boolean {
  const headings = /<h([1-6])\b[^>]*>([^]*?)<\/h\1\s*>/gi;
  for (const heading of html.matchAll(headings)) {
    if (decodeHtmlText(heading[2]).toLowerCase() !== "political activity") continue;

    const afterHeading = html.slice((heading.index ?? 0) + heading[0].length);
    const nextHeading = afterHeading.search(/<h[1-6]\b/i);
    const endOfSection = afterHeading.search(/<\/div\s*>/i);
    const boundaries = [nextHeading, endOfSection].filter((index) => index >= 0);
    const scope = boundaries.length > 0
      ? afterHeading.slice(0, Math.min(...boundaries))
      : afterHeading;

    for (const paragraph of scope.matchAll(/<p\b([^>]*)>([^]*?)<\/p\s*>/gi)) {
      const attributes = paragraph[1];
      const classValue = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
      if (!classValue.split(/\s+/).includes("summary-text")) continue;
      if (decodeHtmlText(paragraph[2]).length > 0) return true;
    }
  }
  return false;
}

/** Stored keys that are metadata, not rendered prose. `political` is the one the page withholds. */
const NON_PROSE_KEYS = new Set(["political", "dataSources", "generatedAt", "model", "sourceFactsHash"]);

type StoredVerdict =
  | { bucket: "clean"; scanned: string[] }
  | { bucket: "finding"; scanned: string[]; sections: string[] }
  | { bucket: "absent" }
  | { bucket: "unreadable"; reason: string };

/**
 * One withheld person's stored profile_summary rows → a verdict on the sections the page RENDERS.
 * Every string section except `political` is scanned; the scanned keys are returned so a run can
 * say which sections it read rather than claim a clean over sections it never saw.
 */
export function classifyStoredSummary(factValues: unknown[]): StoredVerdict {
  if (factValues.length === 0) return { bucket: "absent" };
  if (factValues.length > 1) return { bucket: "unreadable", reason: `${factValues.length} profile_summary facts` };
  const fact = parseJson(factValues[0]);
  if (!isRecord(fact)) return { bucket: "unreadable", reason: "profile_summary is not an object" };

  const scanned: string[] = [];
  const sections: string[] = [];
  for (const [key, value] of Object.entries(fact)) {
    if (NON_PROSE_KEYS.has(key) || typeof value !== "string" || value.trim() === "") continue;
    scanned.push(key);
    if (withholdPoliticalProse(value) === "") sections.push(key);
  }
  if (scanned.length === 0) return { bucket: "unreadable", reason: "no rendered prose section to scan" };
  return sections.length > 0 ? { bucket: "finding", scanned, sections } : { bucket: "clean", scanned };
}

function evaluateBuckets(
  denominator: number,
  clean: number,
  findings: number,
  unreadable: number,
): RunResult {
  if (denominator === 0 || clean + findings + unreadable !== denominator || unreadable > 0) {
    return { code: 2, verdict: "UNREADABLE" };
  }
  if (findings > 0) return { code: 3, verdict: "FINDING" };
  return { code: 0, verdict: "CLEAN" };
}

function selftest(): ExitCode {
  const pageWithPoliticalProse = `
    <html><body><div class="summary-section">
      <h4 class="profile-subsection-title">Political Activity</h4>
      <p class="summary-text">48 contributions totaling $128,108.</p>
    </div></body></html>`;
  const pageWithoutPoliticalProse = `
    <html><body><div class="card profile-section">
      <h3>Political Contributions</h3>
      <p class="profile-section-note">We are withholding this record.</p>
    </div></body></html>`;

  const cases: Array<[string, () => boolean]> = [
    [
      "FINDING polarity — a Political Activity prose section is detected",
      () => hasPoliticalActivityProse(pageWithPoliticalProse),
    ],
    [
      "CLEAN polarity — the withholding notice is not mistaken for summary prose",
      () => !hasPoliticalActivityProse(pageWithoutPoliticalProse),
    ],
    [
      "POSITIVE CONTROL — one detected page drives the live finding arm to exit 3",
      () => evaluateBuckets(1, 0, 1, 0).code === 3,
    ],
    [
      "ZERO DENOMINATOR — an empty audit is UNREADABLE, never clean",
      () => evaluateBuckets(0, 0, 0, 0).code === 2,
    ],
    [
      "STORED POSITIVE CONTROL — a political figure in a RENDERED section is a finding, named by section",
      () => {
        const v = classifyStoredSummary([{ overview: "Available records list $1.8 million in political donations.", business: "Founded a retailer." }]);
        return v.bucket === "finding" && v.sections.join() === "overview";
      },
    ],
    [
      "STORED — the same figure in the WITHHELD `political` section is not a finding (the page never renders it)",
      () => classifyStoredSummary([{ overview: "Founded a retailer.", political: "He gave $1.8 million in political donations." }]).bucket === "clean",
    ],
    [
      "STORED — duplicate facts are UNREADABLE, a missing fact is ABSENT, never clean",
      () => classifyStoredSummary([{ overview: "a" }, { overview: "b" }]).bucket === "unreadable"
        && classifyStoredSummary([]).bucket === "absent",
    ],
  ];

  let failures = 0;
  for (const [name, check] of cases) {
    let passed = false;
    try {
      passed = check();
    } catch {
      passed = false;
    }
    console.log(`  ${passed ? "PASS" : "FAIL"} — ${name}`);
    if (!passed) failures++;
  }

  console.log(`selftest cases: ${cases.length - failures}/${cases.length} passed`);
  return failures === 0 ? 0 : 1;
}

function usableSummaryFacts(rows: SummaryRow[]): Map<string, boolean> {
  const byPerson = new Map<string, unknown[]>();
  for (const row of rows) {
    const facts = byPerson.get(row.person_id) ?? [];
    facts.push(row.fact_value);
    byPerson.set(row.person_id, facts);
  }

  const usable = new Map<string, boolean>();
  for (const [personId, facts] of byPerson) {
    // The profile uses one profile_summary fact. Missing, malformed, or duplicate input cannot
    // support a clean served-page verdict, even if the fetched HTML happens not to match.
    usable.set(personId, facts.length === 1 && isRecord(parseJson(facts[0])));
  }
  return usable;
}

async function auditPage(
  person: WithheldPerson,
  siteBase: string,
  cacheBust: number,
  hasUsableSummary: boolean,
): Promise<PageBucket> {
  const reasons: string[] = [];
  if (!hasUsableSummary) reasons.push("no usable profile_summary fact");

  let html: string | undefined;
  const url = `${siteBase}/billionaires/${encodeURIComponent(person.id)}?cb=${cacheBust}`;
  try {
    const response = await fetch(url, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      reasons.push(`HTTP ${response.status}`);
    } else {
      html = await response.text();
      if (!html.trim() || !/<html\b/i.test(html)) reasons.push("empty or malformed HTML");
    }
  } catch (error) {
    reasons.push(`fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (reasons.length > 0 || html === undefined) {
    return { bucket: "unreadable", person, reasons };
  }
  try {
    return hasPoliticalActivityProse(html)
      ? { bucket: "finding", person }
      : { bucket: "clean", person };
  } catch (error) {
    return {
      bucket: "unreadable",
      person,
      reasons: [`HTML scan failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/** The withheld population, shared by both modes so they can never disagree about WHO. */
async function readWithheld(db: ReturnType<typeof createDb>): Promise<WithheldPerson[]> {
  // Keep this join and filter aligned with scripts/check-fec-impossible-dates.mjs. It is the
  // denominator: every approved person carrying an fec_contributions fact in prod.
  const rows = [...(await db.execute(sql`
    SELECT p.name, p.id, p.birth_year, f.fact_value
    FROM person_facts f
    JOIN persons p ON p.id = f.person_id
    WHERE f.fact_key = 'fec_contributions' AND p.review_status = 'approved'
    ORDER BY p.name
  `))] as FecRow[];

  const withheld: WithheldPerson[] = [];
  for (const row of rows) {
    if (isFecRecordImpossible(fecDateRange(row.fact_value), row.birth_year)) {
      withheld.push({ name: row.name, id: row.id });
    }
  }

  console.log(`approved persons with an FEC fact: ${rows.length}`);
  console.log(`  WITHHELD ON THE PAGE (isFecRecordImpossible): ${withheld.length}`);
  console.log(`  not withheld by the shared guard: ${rows.length - withheld.length}`);
  return withheld;
}

async function runStoredCheck(db: ReturnType<typeof createDb>): Promise<RunResult> {
  const withheld = await readWithheld(db);
  console.log(`withheld persons whose STORED profile_summary is read (denominator): ${withheld.length}`);
  if (withheld.length === 0) {
    console.log("UNREADABLE: zero denominator — no withheld person to read.");
    return { code: 2, verdict: "UNREADABLE" };
  }

  const ids = withheld.map(({ id }) => id);
  const summaryRows = [...(await db.execute(sql`
    SELECT person_id, fact_value
    FROM person_facts
    WHERE fact_key = 'profile_summary'
      AND person_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `))] as SummaryRow[];

  const counts = { clean: 0, finding: 0, absent: 0, unreadable: 0 };
  const sectionsRead = new Map<string, number>();
  for (const person of withheld) {
    const verdict = classifyStoredSummary(summaryRows.filter((r) => r.person_id === person.id).map((r) => r.fact_value));
    counts[verdict.bucket]++;
    if (verdict.bucket === "clean" || verdict.bucket === "finding") {
      for (const key of verdict.scanned) sectionsRead.set(key, (sectionsRead.get(key) ?? 0) + 1);
    }
    if (verdict.bucket === "finding") {
      console.log(`  FINDING — ${person.name} [${person.id}]: political figure in ${verdict.sections.join(", ")}`);
    } else if (verdict.bucket === "unreadable") {
      console.log(`  UNREADABLE — ${person.name} [${person.id}]: ${verdict.reason}`);
    } else if (verdict.bucket === "absent") {
      console.log(`  ABSENT — ${person.name} [${person.id}]: no stored profile_summary (nothing to leak)`);
    }
  }

  console.log(`  CLEAN — no political figure in any rendered stored section: ${counts.clean}`);
  console.log(`  FINDING — a rendered stored section states a political figure: ${counts.finding}`);
  console.log(`  ABSENT — no stored profile_summary: ${counts.absent}`);
  console.log(`  UNREADABLE — duplicate or malformed summary: ${counts.unreadable}`);
  console.log(`  sections read: ${[...sectionsRead].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}`);

  const sum = counts.clean + counts.finding + counts.absent + counts.unreadable;
  console.log(sum === withheld.length ? `SUM-CHECK OK: ${sum} = ${withheld.length}` : `UNREADABLE: bucket sum ${sum} ≠ ${withheld.length}`);
  // ponytail: a run whose every person is ABSENT read no text at all — that is not a clean read.
  if (counts.clean + counts.finding === 0) return { code: 2, verdict: "UNREADABLE" };
  return evaluateBuckets(withheld.length - counts.absent, counts.clean, counts.finding, counts.unreadable);
}

async function runLiveCheck(
  db: ReturnType<typeof createDb>,
  siteBase: string,
): Promise<RunResult> {
  const withheld = await readWithheld(db);
  console.log(`withheld profile pages (denominator): ${withheld.length}`);

  if (withheld.length === 0) {
    console.log("  CLEAN — no Political Activity prose section: 0");
    console.log("  FINDING — still printing Political Activity prose: 0");
    console.log("  UNREADABLE — zero withheld-person denominator: 0");
    console.log("UNREADABLE: zero denominator — no withheld profile page was available to inspect.");
    return { code: 2, verdict: "UNREADABLE" };
  }

  let summaries = new Map<string, boolean>();
  let summaryReadFailure: string | undefined;
  try {
    const ids = withheld.map(({ id }) => id);
    const summaryRows = [...(await db.execute(sql`
      SELECT person_id, fact_value
      FROM person_facts
      WHERE fact_key = 'profile_summary'
        AND person_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `))] as SummaryRow[];
    summaries = usableSummaryFacts(summaryRows);
  } catch (error) {
    summaryReadFailure = error instanceof Error ? error.message : String(error);
  }

  const epoch = Date.now();
  const pageBuckets = await Promise.all(withheld.map(async (person, index) => {
    const hasUsableSummary = summaryReadFailure === undefined && summaries.get(person.id) === true;
    const bucket = await auditPage(person, siteBase, epoch + index, hasUsableSummary);
    if (bucket.bucket === "unreadable" && summaryReadFailure !== undefined) {
      bucket.reasons.push(`profile_summary query failed: ${summaryReadFailure}`);
    }
    return bucket;
  }));

  const clean = pageBuckets.filter(({ bucket }) => bucket === "clean").length;
  const findings = pageBuckets.filter(({ bucket }) => bucket === "finding").length;
  const unreadable = pageBuckets.filter(({ bucket }) => bucket === "unreadable").length;

  console.log(`  CLEAN — no Political Activity prose section: ${clean}`);
  console.log(`  FINDING — still printing Political Activity prose: ${findings}`);
  console.log(`  UNREADABLE — fetch failed, non-200, or no usable summary fact: ${unreadable}`);

  for (const bucket of pageBuckets) {
    if (bucket.bucket === "finding") {
      console.log(`  FINDING — ${bucket.person.name} [${bucket.person.id}]`);
    } else if (bucket.bucket === "unreadable") {
      console.log(`  UNREADABLE — ${bucket.person.name} [${bucket.person.id}]: ${bucket.reasons.join("; ")}`);
    }
  }

  const sum = clean + findings + unreadable;
  if (sum === withheld.length) {
    console.log(`SUM-CHECK OK: ${sum} = ${withheld.length}`);
  } else {
    console.log(`UNREADABLE: bucket sum ${sum} does not equal denominator ${withheld.length}.`);
  }
  return evaluateBuckets(withheld.length, clean, findings, unreadable);
}

function normalizedSiteBase(): string | undefined {
  const raw = process.env.BA_SITE_BASE?.trim() || DEFAULT_SITE_BASE;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.search || parsed.hash) return undefined;
    return raw.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

async function liveEntrypoint(stored: boolean): Promise<RunResult> {
  const connectionString = process.env.DATABASE_URL?.trim();
  const siteBase = normalizedSiteBase();
  if (!connectionString) {
    console.error("BAD INPUT: DATABASE_URL is required; run the root npm script through Doppler.");
    return { code: 1, verdict: "BAD INPUT" };
  }
  if (!siteBase) {
    console.error("BAD INPUT: BA_SITE_BASE must be an http(s) base URL without a query or fragment.");
    return { code: 1, verdict: "BAD INPUT" };
  }

  let db: ReturnType<typeof createDb>;
  try {
    db = createDb(connectionString);
  } catch (error) {
    console.error(`BAD INPUT: DATABASE_URL could not initialize a database client: ${error instanceof Error ? error.message : String(error)}`);
    return { code: 1, verdict: "BAD INPUT" };
  }
  let result: RunResult;
  try {
    result = stored ? await runStoredCheck(db) : await runLiveCheck(db, siteBase);
  } catch (error) {
    console.error(`UNREADABLE: ${error instanceof Error ? error.message : String(error)}`);
    result = { code: 2, verdict: "UNREADABLE" };
  }

  try {
    await db.$client.end();
  } catch (error) {
    console.error(`UNREADABLE: failed to close the database pool: ${error instanceof Error ? error.message : String(error)}`);
    result = { code: 2, verdict: "UNREADABLE" };
  }
  return result;
}

const args = process.argv.slice(2);
// The root script is required to retain `npm run ... -w packages/jobs` exactly. With the repo's
// npm version, a root-level `-- --selftest` reaches the nested npm process as npm_config_selftest
// rather than as argv, so accept both representations of the same CLI request.
const selftestRequested = (args.length === 1 && args[0] === "--selftest")
  || (args.length === 0 && process.env.npm_config_selftest === "true");
if (selftestRequested) {
  const code = selftest();
  console.log(`RESULT: selftest ${code === 0 ? "PASS" : "FAIL"}`);
  process.exitCode = code;
} else {
  const stored = args.length === 1 && args[0] === "--stored";
  const result = args.length === 0 || stored
    ? await liveEntrypoint(stored)
    : ({ code: 1, verdict: "BAD INPUT" } satisfies RunResult);
  if (args.length > 0 && !stored) console.error(`BAD INPUT: unexpected argument(s): ${args.join(" ")}`);
  console.log(`RESULT: ${result.verdict} (exit ${result.code})`);
  // SET process.exitCode, never process.exit(): an open fetch handle can otherwise be aborted on
  // Windows after the correct verdict prints, changing the shell result seen by automation.
  process.exitCode = result.code;
}
