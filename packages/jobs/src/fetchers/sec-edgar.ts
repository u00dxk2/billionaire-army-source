/**
 * SEC EDGAR Data Fetcher
 *
 * Uses two EDGAR APIs to build SEC profiles for billionaires:
 * 1. EFTS full-text search — finds filings mentioning the person's name,
 *    extracts associated companies and (when available) the person's own CIK.
 * 2. Submissions API — given a CIK, returns filing history with form types,
 *    dates, and company details.
 *
 * Stores results as person_facts with factType "business", factKey "sec_filings".
 *
 * API docs:
 *   EFTS: https://efts.sec.gov/LATEST/search-index
 *   Submissions: https://data.sec.gov/submissions/
 *
 * EDGAR accepts 10 requests/second with a User-Agent identifying the requester.
 * No API key required — EDGAR is free and open.
 *
 * Usage: npm run fetch:sec (or: tsx src/fetchers/sec-edgar.ts)
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and } from "drizzle-orm";
import { isMain } from "../is-main";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }

const db = createDb(databaseUrl);

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@skylarkcreations.com";
const USER_AGENT = `BillionaireArmy/0.1 (${CONTACT_EMAIL})`;

const INSIDER_FORMS = new Set(["3", "4", "5", "4/A", "3/A", "5/A", "144", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"]);

// ---------- EFTS full-text search ----------

interface EftsResult {
  totalHits: number;
  personalCik: string | null;
  companies: { cik: string; name: string; ticker: string | null; hitCount: number; hasInsiderForms: boolean }[];
}

async function eftsSearch(fullName: string): Promise<EftsResult> {
  const endDate = new Date().toISOString().split("T")[0];
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(fullName)}%22&dateRange=custom&startdt=2010-01-01&enddt=${endDate}`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return { totalHits: 0, personalCik: null, companies: [] };

  const data: any = await res.json();
  const totalHits: number = data.hits?.total?.value ?? data.hits?.total ?? 0;
  const hits = (data.hits?.hits || []).map((h: any) => h._source);

  // Collect CIK -> metadata
  const cikMap = new Map<string, { name: string; hitCount: number; forms: Set<string> }>();
  for (const h of hits) {
    for (let i = 0; i < (h.ciks?.length ?? 0); i++) {
      const cik = h.ciks[i];
      const displayName = h.display_names?.[i] || "";
      const existing = cikMap.get(cik);
      if (existing) {
        existing.hitCount++;
        existing.forms.add(h.form);
      } else {
        cikMap.set(cik, { name: displayName, hitCount: 1, forms: new Set([h.form]) });
      }
    }
  }

  // Detect personal CIK (display_name matches "LASTNAME FIRSTNAME" pattern)
  const nameParts = fullName.toUpperCase().split(/\s+/);
  const lastName = nameParts[nameParts.length - 1];
  const firstName = nameParts[0];
  let personalCik: string | null = null;

  for (const [cik, info] of cikMap) {
    const n = info.name.toUpperCase();
    const isCompany = /\b(INC|LLC|CORP|LP|LTD|FUND|TRUST|GROUP|PARTNERS|HOLDINGS|CAPITAL)\b/.test(n);
    if (!isCompany && n.includes(lastName) && n.includes(firstName)) {
      personalCik = cik;
      break;
    }
  }

  // Extract ticker from display_name: "AMAZON COM INC  (AMZN)  (CIK ...)"
  function extractTicker(displayName: string): string | null {
    const m = displayName.match(/\(([A-Z]{1,5}(?:-[A-Z]{1,2})?)\)/);
    return m ? m[1] : null;
  }

  // Build company list, sorted by relevance
  const companies = [...cikMap.entries()]
    .filter(([cik]) => cik !== personalCik) // exclude personal CIK from companies
    .map(([cik, info]) => ({
      cik,
      name: info.name.replace(/\s+\(CIK \d+\)/, "").trim(), // strip CIK suffix
      ticker: extractTicker(info.name),
      hitCount: info.hitCount,
      hasInsiderForms: [...info.forms].some(f => INSIDER_FORMS.has(f)),
    }))
    // B-008: an EFTS full-text hit only proves the person's NAME appears somewhere
    // in a company's filing — NOT that they own or control it. Private-company
    // billionaires (e.g. Hank Meijer, whose Meijer Inc. files nothing) surfaced
    // wrong entities like "Rivulet Media" off incidental/namesake mentions, which
    // reads as a false ownership claim on the lawyer-scrutinized profile surface.
    // Require ownership/insider evidence: keep a company only when the person
    // appears on one of ITS insider or beneficial-ownership forms (3/4/5, SC
    // 13D/G). Trades a few thin associations for zero wrong-entity attribution.
    .filter(c => c.hasInsiderForms)
    .sort((a, b) => {
      // Prefer companies with insider forms, then by hit count
      if (a.hasInsiderForms !== b.hasInsiderForms) return a.hasInsiderForms ? -1 : 1;
      if ((a.ticker !== null) !== (b.ticker !== null)) return a.ticker ? -1 : 1;
      return b.hitCount - a.hitCount;
    });

  return { totalHits, personalCik, companies };
}

// ---------- Submissions API ----------

interface SubmissionsResult {
  entityName: string;
  entityType: string;
  tickers: string[];
  sicDescription: string;
  totalFilings: number;
  insiderFilingCount: number;
  recentInsiderFilings: { form: string; date: string; description: string }[];
  formBreakdown: Record<string, number>;
}

async function getSubmissions(cik: string): Promise<SubmissionsResult | null> {
  const paddedCik = cik.padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;

  const data: any = await res.json();
  const recent = data.filings?.recent || {};
  const forms: string[] = recent.form || [];
  const filingDates: string[] = recent.filingDate || [];
  const primaryDocs: string[] = recent.primaryDocument || [];
  const primaryDocDescs: string[] = recent.primaryDocDescription || [];

  // Form breakdown
  const formBreakdown: Record<string, number> = {};
  for (const f of forms) formBreakdown[f] = (formBreakdown[f] || 0) + 1;

  // Extract insider filings
  let insiderFilingCount = 0;
  const recentInsiderFilings: { form: string; date: string; description: string }[] = [];
  for (let i = 0; i < forms.length; i++) {
    if (INSIDER_FORMS.has(forms[i])) {
      insiderFilingCount++;
      if (recentInsiderFilings.length < 10) {
        recentInsiderFilings.push({
          form: forms[i],
          date: filingDates[i],
          description: primaryDocDescs[i] || primaryDocs[i] || "",
        });
      }
    }
  }

  return {
    entityName: data.name || "",
    entityType: data.entityType || "",
    tickers: data.tickers || [],
    sicDescription: data.sicDescription || "",
    totalFilings: forms.length,
    insiderFilingCount,
    recentInsiderFilings,
    formBreakdown,
  };
}

// ---------- Main import ----------

async function importAll() {
  const allPersons = await db.select().from(persons);
  console.log(`Fetching SEC EDGAR data for ${allPersons.length} persons...\n`);

  let fetched = 0;
  let skipped = 0;

  for (const person of allPersons) {
    console.log(`  ${person.name}...`);

    try {
      // Step 1: EFTS search
      const efts = await eftsSearch(person.name);

      if (efts.totalHits === 0) {
        console.log(`    No EDGAR mentions`);
        skipped++;
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      // Step 2: Pick best CIK for submissions
      const bestCik = efts.personalCik || efts.companies[0]?.cik;
      if (!bestCik) {
        // B-008: no personal CIK and no ownership/insider-evidenced company =
        // no verifiable SEC association. Delete any stale fact (e.g. an old
        // full-text-only "Meijer -> Rivulet" match) so a wrong entity doesn't
        // persist across re-runs once the tightened matcher stops producing it.
        await db.delete(personFacts).where(
          and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "sec_filings"))
        );
        console.log(`    ${efts.totalHits} mentions but no usable CIK (stale fact cleared)`);
        skipped++;
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      await new Promise(r => setTimeout(r, 150)); // rate limit between EFTS + Submissions

      // Step 3: Get submission details
      const subs = await getSubmissions(bestCik);

      // Step 4: Build fact value
      const topCompanies = efts.companies.slice(0, 5).map(c => ({
        name: c.name,
        cik: c.cik,
        ticker: c.ticker,
      }));

      const factValue: Record<string, unknown> = {
        personalCik: efts.personalCik,
        companies: topCompanies,
        eftsHits: efts.totalHits,
      };

      if (subs) {
        factValue.entityName = subs.entityName;
        factValue.entityType = subs.entityType;
        factValue.tickers = subs.tickers;
        factValue.sicDescription = subs.sicDescription;
        factValue.totalFilings = subs.totalFilings;
        factValue.insiderFilingCount = subs.insiderFilingCount;
        factValue.recentInsiderFilings = subs.recentInsiderFilings;
      }

      const now = new Date();
      const sourceUrl = efts.personalCik
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${efts.personalCik}&type=&dateb=&owner=include&count=40`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${bestCik}&type=&dateb=&owner=include&count=40`;

      // Upsert: delete old sec_filings fact, insert new
      await db.delete(personFacts).where(
        and(eq(personFacts.personId, person.id), eq(personFacts.factKey, "sec_filings"))
      );

      await db.insert(personFacts).values({
        personId: person.id,
        factType: "business",
        factKey: "sec_filings",
        factValue,
        sourceUrl,
        sourceType: "sec_edgar",
        retrievedAt: now,
        estimationMethod: "sec_derived",
      });

      const label = efts.personalCik ? `personal CIK ${efts.personalCik}` : `via ${topCompanies[0]?.name || bestCik}`;
      const filingLabel = subs ? `, ${subs.insiderFilingCount} insider filings` : "";
      console.log(`    + ${efts.totalHits} mentions, ${label}${filingLabel}`);
      fetched++;

      // EDGAR rate limit: 10 req/sec. We made 2 requests, wait 250ms.
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      console.error(`    Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nSEC EDGAR import complete: ${fetched} enriched, ${skipped} skipped`);
  process.exit(0);
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
