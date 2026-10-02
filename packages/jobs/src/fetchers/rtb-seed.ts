/**
 * Real-Time Billionaires (RTB) Seeder
 *
 * Scrapes realtimebillionaires.de to discover U.S. billionaires missing from
 * our Wikidata-sourced database, and enriches existing persons with state,
 * industry, and net worth data.
 *
 * Phase 1: Scrape all US list pages to get ~931 billionaire URIs + basic info
 * Phase 2: For new persons, fetch profile pages for residence, industry, birth year
 * Phase 3: Insert new persons, enrich existing ones
 *
 * Usage: npm run seed:rtb (or: tsx src/fetchers/rtb-seed.ts)
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, and, sql, ilike } from "drizzle-orm";
import { isMain } from "../is-main";
import { findMergeDuplicate } from "../person-match";
import { windowTwoDigitYear } from "@ba/shared";

const RTB_BASE = "https://realtimebillionaires.de";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }

const db = createDb(databaseUrl);

const USER_AGENT = "BillionaireArmy/0.1 (civic accountability platform)";

// Industry mapping from RTB categories to our taxonomy
const INDUSTRY_MAP: Record<string, string> = {
  automotive: "Technology",
  technology: "Technology",
  "software & services": "Technology",
  semiconductors: "Technology",
  "internet & telecommunications": "Technology",
  telecom: "Technology",
  "wireless networking": "Technology",
  finance: "Finance",
  "finance & investments": "Finance",
  "hedge funds": "Finance",
  "private equity": "Finance",
  investments: "Finance",
  banking: "Finance",
  "money management": "Finance",
  insurance: "Finance",
  retail: "Retail",
  "fashion & retail": "Fashion",
  fashion: "Fashion",
  "real estate": "Real Estate",
  media: "Media",
  "media & entertainment": "Media",
  entertainment: "Media",
  "newspapers, tv network": "Media",
  energy: "Energy",
  "oil & gas": "Energy",
  "energy & mining": "Energy",
  mining: "Energy",
  healthcare: "Healthcare",
  pharmaceuticals: "Healthcare",
  "hospitals & physicians": "Healthcare",
  "food & beverage": "Food & Beverage",
  "fast food": "Food & Beverage",
  restaurants: "Food & Beverage",
  manufacturing: "Manufacturing",
  "construction & engineering": "Manufacturing",
  "building supplies": "Manufacturing",
  sports: "Sports",
  "warehouse automation": "Manufacturing",
  casinos: "Diversified",
  "gambling & casinos": "Diversified",
  logistics: "Diversified",
  diversified: "Diversified",
  "defense technology": "Technology",
  cryptocurrency: "Crypto",
  blockchain: "Crypto",
};

function mapIndustry(rtbSource: string): string {
  const lower = rtbSource.toLowerCase().trim();
  // Direct match
  if (INDUSTRY_MAP[lower]) return INDUSTRY_MAP[lower];
  // Partial match
  for (const [key, val] of Object.entries(INDUSTRY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return "Diversified";
}

interface ListEntry {
  uri: string;      // e.g. "elon-musk"
  name: string;
  netWorth: string;  // e.g. "$834.9B"
  source: string;    // e.g. "Tesla, SpaceX"
}

interface ProfileData {
  citizenship: string | null;
  residence: string | null;  // "Austin, Texas"
  birthDate: string | null;  // "06/28/71 (age 54)"
  industry: string | null;
  source: string | null;
}

// ---------- Phase 1: Scrape list pages ----------

async function fetchListPage(page: number): Promise<ListEntry[]> {
  const url = `${RTB_BASE}/list/rtb?country=us&page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];

  const html = await res.text();
  const entries: ListEntry[] = [];

  // Match list items: href="/profile/{uri}" ... name ... networth ... source
  const itemRegex = /class="rtb-list-item"\s+href="\/profile\/([^"]+)"[^>]*>.*?rtb-list-name">([^<]+)<.*?rtb-list-networth"><b>([^<]+)<.*?rtb-list-source">([^<]+)</g;

  // Use a simpler approach: split by list items
  const items = html.split('class="rtb-list-item"').slice(1);

  for (const item of items) {
    const uriMatch = item.match(/href="\/profile\/([^"]+)"/);
    const nameMatch = item.match(/rtb-list-name">([^<]+)</);
    const worthMatch = item.match(/rtb-list-networth"><b>([^<]+)</);
    const sourceMatch = item.match(/rtb-list-source">([^<]+)</);

    if (uriMatch && nameMatch) {
      entries.push({
        uri: uriMatch[1],
        name: nameMatch[1].trim(),
        netWorth: worthMatch?.[1]?.trim() || "",
        source: sourceMatch?.[1]?.trim() || "",
      });
    }
  }

  return entries;
}

async function fetchAllUSBillionaires(): Promise<ListEntry[]> {
  const all: ListEntry[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 40; page++) {
    console.log(`  Fetching list page ${page}...`);
    const entries = await fetchListPage(page);

    if (entries.length === 0) {
      console.log(`    Empty page — done.`);
      break;
    }

    for (const e of entries) {
      if (!seen.has(e.uri)) {
        seen.add(e.uri);
        all.push(e);
      }
    }

    console.log(`    ${entries.length} entries (${all.length} total)`);
    await new Promise(r => setTimeout(r, 500));
  }

  return all;
}

// ---------- Phase 2: Fetch profile details ----------

async function fetchProfile(uri: string): Promise<ProfileData> {
  const url = `${RTB_BASE}/profile/${uri}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return { citizenship: null, residence: null, birthDate: null, industry: null, source: null };

  const html = await res.text();

  function extractField(label: string): string | null {
    // Look for <h4>Label</h4>\n<span>Value</span> pattern
    const regex = new RegExp(`<h4>${label}</h4>\\s*<span>([^<]+)</span>`, "i");
    const match = html.match(regex);
    return match ? match[1].trim() : null;
  }

  // Extract industry from tag link
  const industryMatch = html.match(/href="\/industry\/([^"]+)"/);
  const industry = industryMatch ? industryMatch[1].replace(/-/g, " ") : null;

  return {
    citizenship: extractField("Citizenship"),
    residence: extractField("Residence"),
    birthDate: extractField("Birth date"),
    industry,
    source: extractField("Source of wealth"),
  };
}

// ---------- Phase 3: Match and insert/enrich ----------

function parseNetWorth(worth: string): number | null {
  const match = worth.match(/\$?([\d.]+)\s*(T|B|M)?/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();
  if (unit === "T") return num * 1e12;
  if (unit === "B") return num * 1e9;
  if (unit === "M") return num * 1e6;
  return num;
}

/**
 * RTB reports birth dates with a TWO-DIGIT year ("06/28/71 (age 54)"), so every one of them is
 * windowed into a century by us, and the window used to put anything <= 30 in the 2000s.
 *
 * THAT IS BACKWARDS FOR AN INDEX OF BILLIONAIRES, and it wrote false rows for months. Measured
 * 2026-09-04 (B-039): every implausible `persons.birth_year` in the index is an exact century
 * shift out of this function — Sidney Kimmel 1928 stored as 2028, Wilma Tisch 1927 as 2027,
 * Gloria Joseph 1924 as 2024, George Joseph 1921 as 2021, Alan Gerry '28 as 2028. All five carry
 * NO wikidataId, which is what identified this seeder rather than `fetch:wikidata` as the source:
 * the mechanism was established by reading the rows, not by reasoning about the parser.
 *
 * THE CONSEQUENCE IS NOT COSMETIC. `isFecRecordImpossible` refuses a birth year that makes the
 * person a minor today and returns FALSE — show the record — so a century-shifted year silently
 * disables B-037's withhold for that person, and a political record we cannot prove is theirs
 * reaches a reader as a claim about a named living person.
 *
 * NO NEW NUMBER AND NO SECOND RULE: the correction asks the SAME shared predicate the withhold
 * refuses on. A windowed 2-digit year that lands in the future, or that makes an indexed
 * billionaire a minor, is a century error and never a child billionaire. The 4-digit case returns
 * untouched — a source that states its century is not guessing and must not be second-guessed.
 *
 * CEILING: this fixes the WRITE path only. `importAll` inserts and never updates, so the five
 * rows already in prod stay wrong until a data write, which is the owner's call (B-039).
 */
function parseBirthYear(bd: string | null): number | null {
  if (!bd) return null;
  // Format: "06/28/71 (age 54)" or "MM/DD/YY"
  const match = bd.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!match) return null;
  const year = parseInt(match[3]);
  if (match[3].length > 2) return year;
  return windowTwoDigitYear(year);
}

function parseState(residence: string | null): string | null {
  if (!residence) return null;
  // "Austin, Texas" -> "Texas"
  const parts = residence.split(",").map(s => s.trim());
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*&\s*family$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function importAll() {
  console.log("=== RTB Seeder: Discovering U.S. Billionaires ===\n");

  // Phase 1: Get all US billionaires from RTB
  console.log("Phase 1: Fetching US billionaire list...\n");
  const rtbList = await fetchAllUSBillionaires();
  console.log(`\nFound ${rtbList.length} US billionaires on RTB.\n`);

  // Load existing persons
  const existingPersons = await db.select({
    id: persons.id,
    name: persons.name,
    state: persons.state,
    industry: persons.industry,
    birthYear: persons.birthYear,
  }).from(persons);

  // Build name lookup (normalized name -> person)
  const nameMap = new Map<string, typeof existingPersons[0]>();
  for (const p of existingPersons) {
    nameMap.set(normalizeNameForMatch(p.name), p);
  }

  // B-009 fuzzy-dup set: first+last-core-token match + father/son-safe classify.
  // Catches same-person rows that exact-string normalization misses (e.g. RTB
  // "Melinda Gates" vs canonical "Melinda French Gates"). Kept current as we insert.
  const existingForMatch: { name: string; birthYear: number | null }[] =
    existingPersons.map((p) => ({ name: p.name, birthYear: p.birthYear }));

  // Categorize RTB entries
  const matched: { rtb: ListEntry; existing: typeof existingPersons[0] }[] = [];
  const newEntries: ListEntry[] = [];

  for (const entry of rtbList) {
    const normalized = normalizeNameForMatch(entry.name);
    const existing = nameMap.get(normalized);
    if (existing) {
      matched.push({ rtb: entry, existing });
    } else {
      newEntries.push(entry);
    }
  }

  console.log(`Matched to existing DB: ${matched.length}`);
  console.log(`New (not in DB): ${newEntries.length}\n`);

  // Phase 2: Enrich existing persons with missing state/industry
  console.log("Phase 2: Enriching existing persons...\n");
  let enriched = 0;

  for (const { rtb, existing } of matched) {
    const needsState = !existing.state;
    const needsIndustry = !existing.industry || existing.industry.length === 0;

    if (!needsState && !needsIndustry) continue;

    // Fetch profile for state/industry
    const profile = await fetchProfile(rtb.uri);
    const updates: Record<string, unknown> = {};

    if (needsState && profile.residence) {
      const state = parseState(profile.residence);
      if (state) updates.state = state;
    }

    if (needsIndustry && profile.industry) {
      const mapped = mapIndustry(profile.industry);
      updates.industry = [mapped];
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(persons).set(updates).where(eq(persons.id, existing.id));
      console.log(`  Enriched: ${existing.name} (${Object.keys(updates).filter(k => k !== "updatedAt").join(", ")})`);
      enriched++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nEnriched ${enriched} existing persons.\n`);

  // Phase 3: Insert new persons
  console.log("Phase 3: Inserting new persons...\n");
  let inserted = 0;
  let skipped = 0;

  for (const entry of newEntries) {
    // Skip "& family" entries if they seem like duplicates
    const baseName = entry.name.replace(/\s*&\s*family$/i, "").trim();
    if (baseName !== entry.name && nameMap.has(normalizeNameForMatch(baseName))) {
      console.log(`  Skip: ${entry.name} (base name "${baseName}" already exists)`);
      skipped++;
      continue;
    }

    console.log(`  Fetching profile: ${entry.name}...`);
    const profile = await fetchProfile(entry.uri);

    // Only insert if US citizenship/presence
    const isUS = profile.citizenship?.toLowerCase().includes("united states") ||
                 profile.citizenship?.toLowerCase().includes("american") ||
                 profile.residence?.toLowerCase().includes("united states");

    if (!isUS && profile.citizenship) {
      // Has citizenship data but not US — might be in the list due to US business
      // Still include them (they have US presence by being in the US-filtered list)
    }

    const state = parseState(profile.residence);
    const birthYear = parseBirthYear(profile.birthDate);

    // B-009: Phase-1's exact-name match missed this entry, but now that we have
    // the profile's birth year we can father/son-safely check whether it's the
    // same PERSON as an existing row under a different spelling. Skip if dup.
    const fuzzyDup = findMergeDuplicate({ name: entry.name, birthYear }, existingForMatch);
    if (fuzzyDup) {
      console.log(`  Skip: ${entry.name} (same person as existing "${fuzzyDup.name}")`);
      skipped++;
      continue;
    }

    const industry = profile.industry ? [mapIndustry(profile.industry)] : [];
    const netWorthNum = parseNetWorth(entry.netWorth);
    const netWorthFormatted = netWorthNum
      ? netWorthNum >= 1e9 ? `~$${(netWorthNum / 1e9).toFixed(1)}B` : `~$${(netWorthNum / 1e6).toFixed(0)}M`
      : null;

    const now = new Date();

    // Insert person
    const [newPerson] = await db.insert(persons).values({
      name: entry.name,
      state,
      birthYear,
      industry,
      country: "United States",
      gender: null,
      images: [],
      publicFigure: true,
      usPresence: state ? [{ type: "residence", details: `${profile.residence || state}` }] : [],
      badges: {},
    }).returning({ id: persons.id });

    // Store net worth as a fact
    if (netWorthFormatted && newPerson) {
      await db.insert(personFacts).values({
        personId: newPerson.id,
        factType: "net_worth",
        factKey: "net_worth",
        factValue: netWorthFormatted,
        sourceUrl: `${RTB_BASE}/profile/${entry.uri}`,
        sourceType: "rtb",
        retrievedAt: now,
        estimationMethod: "web_search",
      });
    }

    const label = [
      state,
      industry[0],
      netWorthFormatted,
    ].filter(Boolean).join(", ");
    console.log(`    + ${entry.name} (${label || "basic"})`);
    inserted++;
    // Keep the fuzzy-dup set current so two RTB spellings of the same person in
    // one run don't both insert.
    existingForMatch.push({ name: entry.name, birthYear });

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== RTB Seed Complete ===`);
  console.log(`  Matched existing: ${matched.length}`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  New inserted: ${inserted}`);
  console.log(`  Skipped (dup of existing person — & family / different spelling): ${skipped}`);
  console.log(`  Total persons now: ${existingPersons.length + inserted}`);
  process.exit(0);
}

// Guarded: these scripts mutate prod, so importing this file must not RUN it.
// See is-main.ts. (B-020 sweep 2026-08-01 — 7 fetchers were still bare.)
if (isMain(import.meta.url)) {
  importAll();
}
