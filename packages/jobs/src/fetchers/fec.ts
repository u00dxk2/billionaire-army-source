/**
 * FEC (Federal Election Commission) Data Fetcher
 *
 * Uses the OpenFEC API to fetch political contribution data for billionaires.
 * Stores results as person_facts with type "political".
 *
 * API docs: https://api.open.fec.gov/developers/
 * Rate limit: 1,000 requests/hour with API key
 *
 * Usage: npm run fetch:fec (or: tsx src/fetchers/fec.ts)
 * Requires: FEC_API_KEY environment variable
 * Resume a run that died: FEC_STALE_BEFORE=<the dead run's start, ISO> skips persons already refreshed.
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, gte } from "drizzle-orm";
import { isMain } from "../is-main";
import { refreshRunExitCode, requireArray } from "./refresh-run-verdict";

const FEC_API = "https://api.open.fec.gov/v1";

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.FEC_API_KEY;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!apiKey) { console.error("FEC_API_KEY is required (get one at https://api.data.gov/signup/)"); process.exit(1); }

// FEC_STALE_BEFORE=<iso> resumes a run that died: skip anyone whose FEC fact was retrieved at or
// after that instant. The person loop has no ORDER BY, so "skip the first N" is not a resume.
// A malformed date REFUSES — read as "no filter" it would silently re-run every person. (R-077, 2026-09-13)
const staleBeforeRaw = process.env.FEC_STALE_BEFORE;
const staleBefore = staleBeforeRaw ? new Date(staleBeforeRaw) : null;
if (staleBefore && Number.isNaN(staleBefore.getTime())) {
  console.error(`FEC_STALE_BEFORE is not a date: ${staleBeforeRaw}`);
  process.exit(1);
}

const db = createDb(databaseUrl);

interface FecContribution {
  contributor_name: string;
  committee: { name: string; party: string };
  contribution_receipt_amount: number;
  contribution_receipt_date: string;
}

async function fetchContributions(
  name: string,
): Promise<{ results: FecContribution[]; reportedTotal: number | null }> {
  const params = new URLSearchParams({
    api_key: apiKey!,
    contributor_name: name,
    sort: "-contribution_receipt_date",
    per_page: "100",
    is_individual: "true",
  });

  const res = await fetch(`${FEC_API}/schedules/schedule_a/?${params}`, {
    headers: { "User-Agent": "BillionaireArmy/0.1" },
  });

  if (!res.ok) {
    throw new Error(`FEC API error: ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();
  // `per_page=100` with no pagination means a prolific donor comes back as their 100 MOST
  // RECENT contributions. `pagination.count` is the FEC's own total for the query, and it is
  // the only way the stored fact can say how much it is missing — without it the summary
  // prompt can say "at least 100" but never the real number. Nullable on purpose: the FEC
  // has returned pages without a pagination block, and a missing total must read as unknown,
  // never as zero. (R-077, 2026-08-29)
  const reportedTotal =
    typeof data?.pagination?.count === "number" ? data.pagination.count : null;
  // A 200 without a `results` array is an error, never "no contributions" (Codex finding 2).
  return { results: requireArray(data?.results, "FEC schedule_a") as FecContribution[], reportedTotal };
}

function summarizeContributions(contributions: FecContribution[]): {
  totalAmount: number;
  partyBreakdown: Record<string, number>;
  topRecipients: { name: string; amount: number }[];
  count: number;
  dateRange: string;
} {
  const partyBreakdown: Record<string, number> = {};
  const recipientMap: Record<string, number> = {};
  let totalAmount = 0;
  let earliest = "";
  let latest = "";

  for (const c of contributions) {
    totalAmount += c.contribution_receipt_amount;

    const party = c.committee?.party || "Unknown";
    partyBreakdown[party] = (partyBreakdown[party] || 0) + c.contribution_receipt_amount;

    const name = c.committee?.name || "Unknown";
    recipientMap[name] = (recipientMap[name] || 0) + c.contribution_receipt_amount;

    const date = c.contribution_receipt_date;
    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
  }

  const topRecipients = Object.entries(recipientMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, amount]) => ({ name, amount }));

  return {
    totalAmount,
    partyBreakdown,
    topRecipients,
    count: contributions.length,
    dateRange: earliest && latest ? `${earliest} to ${latest}` : "",
  };
}

async function importAll() {
  const everyone = await db.select().from(persons);
  let freshIds = new Set<string>();
  if (staleBefore) {
    const fresh = await db
      .select({ personId: personFacts.personId })
      .from(personFacts)
      .where(and(eq(personFacts.factKey, "fec_contributions"), gte(personFacts.retrievedAt, staleBefore)));
    freshIds = new Set(fresh.map((r) => r.personId));
  }
  const allPersons = everyone.filter((p) => !freshIds.has(p.id));
  console.log(
    `Fetching FEC data for ${allPersons.length} persons...` +
      (staleBefore ? ` (${freshIds.size} of ${everyone.length} already retrieved since ${staleBefore.toISOString()}, skipped)` : "") +
      "\n",
  );

  let fetched = 0;
  let skipped = 0;
  let errors = 0;

  for (const person of allPersons) {
    // Use last name, first name format for FEC search
    const nameParts = person.name.split(" ");
    if (nameParts.length < 2) {
      console.log(`  - ${person.name}: skipping (need first + last name)`);
      skipped++;
      continue;
    }

    console.log(`  Fetching ${person.name}...`);

    try {
      const { results: contributions, reportedTotal } = await fetchContributions(person.name);

      if (contributions.length === 0) {
        console.log(`    No contributions found`);
        skipped++;
        // An empty answer still spent a request: the same 3800ms as every other path, or a run of
        // empties outpaces api.data.gov's 1,000/hour (it was 500ms — Codex finding 5).
        await new Promise((r) => setTimeout(r, 3800));
        continue;
      }

      const summary = {
        ...summarizeContributions(contributions),
        ...(reportedTotal !== null ? { reportedTotalContributions: reportedTotal } : {}),
      };
      const now = new Date();

      // Replace the old FEC fact in ONE transaction, so a failed insert cannot leave the person with
      // no fact (Codex finding 6). Only a row THIS fetcher wrote is deleted: a row under the same key
      // from another source survives (0 existed on 2026-10-02). It is not given display precedence;
      // that is R-087's to settle before arming.
      await db.transaction(async (tx) => {
        await tx.delete(personFacts).where(
          and(
            eq(personFacts.personId, person.id),
            eq(personFacts.factKey, "fec_contributions"),
            eq(personFacts.sourceType, "fec"),
          )
        );

        await tx
          .insert(personFacts)
          .values({
            personId: person.id,
            factType: "political",
            factKey: "fec_contributions",
            factValue: summary,
            sourceUrl: `https://www.fec.gov/data/receipts/individual-contributions/?contributor_name=${encodeURIComponent(person.name)}`,
            sourceType: "fec",
            retrievedAt: now,
            estimationMethod: "fec",
          });
      });

      const formatted = summary.totalAmount >= 1e6
        ? `$${(summary.totalAmount / 1e6).toFixed(1)}M`
        : `$${summary.totalAmount.toLocaleString()}`;
      console.log(`    + ${summary.count} contributions, total ${formatted}`);
      fetched++;

      // Rate limit. The old value was 2000ms with the comment "1000/hour = ~1 per 3.6s, use 2s to
      // be safe" — the arithmetic is backwards: 2s is 1,800 requests/hour, i.e. 1.8x OVER
      // api.data.gov's 1,000/hour key limit, not under it. Measured 2026-09-12: the loop issues one
      // request per person over 1,095 eligible persons, so a full run crosses the cap inside the
      // first hour and the tail 429s. 3800ms is ~947/hour, under the limit with margin, and takes
      // the full run from ~37 min to ~70 min. A slower complete run beats a fast partial one for a
      // job somebody runs by hand once.
      await new Promise((r) => setTimeout(r, 3800));
    } catch (err) {
      // COUNTED, not just printed. This branch incremented neither counter, so a rate-limited tail
      // vanished from both and the closing line still read like a complete run — the same
      // survived-the-continue shape this repo has been bitten by before.
      errors++;
      console.error(`    Error: ${err instanceof Error ? err.message : err}`);
      // A failed request still spent a request against the hourly limit.
      await new Promise((r) => setTimeout(r, 3800));
    }
  }

  console.log(`\nFEC import complete: ${fetched} enriched, ${skipped} skipped, ${errors} errored`);
  if (errors > 0) {
    console.log(`  ⚠ ${errors} person(s) errored and kept whatever fact they already had — this run is PARTIAL.`);
    console.log(`  ⚠ ${fetched + skipped + errors} of ${allPersons.length} accounted for; a rate-limit tail looks exactly like this.`);
  }
  // Red on a partial or empty run, so a scheduled run cannot conclude "success" over one.
  process.exit(refreshRunExitCode({ attempted: fetched + skipped + errors, errors }));
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
