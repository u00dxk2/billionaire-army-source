/**
 * Giving Pledge Importer
 *
 * Matches Giving Pledge signatories against our persons table and:
 * 1. Sets badges.givingPledge = true on matching persons
 * 2. Stores a person_fact for attribution (source: givingpledge.org)
 *
 * The signatory list is hardcoded from https://www.givingpledge.org/pledger-list/
 * (scraped March 2026). Update the list periodically by checking the source page.
 *
 * Usage: npm run import:giving-pledge (or: tsx src/fetchers/giving-pledge.ts)
 * No API key required.
 */

import { createDb, persons, personFacts } from "@ba/db";
import { eq, sql } from "drizzle-orm";
import { isMain } from "../is-main";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }

const db = createDb(databaseUrl);

/**
 * Giving Pledge signatories — extracted from givingpledge.org/pledger-list/
 * Each entry lists the primary signatory name(s). We extract individual names
 * for matching against our persons table.
 *
 * Last updated: March 2026
 */
const PLEDGE_ENTRIES: string[] = [
  "Bill Ackman",
  "Brian Acton",
  "Cameron Adams",
  "Sylvan Adams",
  "Margaret Adams",
  "Noubar Afeyan",
  "Anil Agarwal",
  "Leonard H. Ainsworth",
  "Muna Easa Al Gurg",
  "Paul G. Allen",
  "Alwaleed Bin Talal",
  "Sam Altman",
  "Sue Ann Arnall",
  "Laura Arnold",
  "John Arnold",
  "Marcel Arsenault",
  "Lord Ashcroft",
  "Jon Ayers",
  "Stewart Bainum",
  "Sandy Bainum",
  "Rich Barton",
  "Sarah Barton",
  "Marc Benioff",
  "Lynne Benioff",
  "Nicolas Berggruen",
  "Manoj Bhargava",
  "Aneel Bhusri",
  "Steve Bing",
  "Sara Blakely",
  "Arthur M. Blank",
  "Nathan Blecharczyk",
  "Michael R. Bloomberg",
  "David G. Booth",
  "Richard Branson",
  "Eli Broad",
  "Edythe Broad",
  "Charles R. Bronfman",
  "Edgar M. Bronfman",
  "Warren Buffett",
  "Charles Butt",
  "Garrett Camp",
  "Steve Case",
  "Jean Case",
  "John Caudwell",
  "Brian Chesky",
  "Ron Conway",
  "Scott Cook",
  "Lee Cooperman",
  "Joe Craft",
  "Joyce Cummings",
  "Bill Cummings",
  "Ravenel B. Curry III",
  "Benoit Dageville",
  "Ray Dalio",
  "Barbara Dalio",
  "Jack Dangermond",
  "Laura Dangermond",
  "Joseph Deitch",
  "John Paul DeJoria",
  "Ben Delo",
  "Bharat Desai",
  "Neerja Sethi",
  "Mohammed Dewji",
  "Barry Diller",
  "Diane von Furstenberg",
  "Ann Doerr",
  "John Doerr",
  "Dagmar Dolby",
  "Dong Fangjun",
  "Glenn Dubin",
  "Marco Dunand",
  "Kjell Inge Røkke",
  "Ric Elias",
  "Larry Ellison",
  "Henry Engelhardt",
  "Charlie Ergen",
  "Candy Ergen",
  "Judy Faulkner",
  "Charles F. Feeney",
  "Andrew Forrest",
  "Nicola Forrest",
  "Ted Forstmann",
  "Melinda French Gates",
  "Phillip Frost",
  "Mario Gabelli",
  "Mala Gaonkar",
  "Bill Gates",
  "Joe Gebbia",
  "Dan Gilbert",
  "Ann Gloag",
  "Dave Goldberg",
  "Sheryl Sandberg",
  "Robert D. Goldfarb",
  "Jeremy Grantham",
  "David Green",
  "Barbara Green",
  "Jeff T. Green",
  "Jeff Greene",
  "Harold Grinspoon",
  "William Gross",
  "Gordon Gund",
  "Stelios Haji-Ioannou",
  "Harold Hamm",
  "Nick Hanauer",
  "David Harding",
  "Gordon V. Hartman",
  "Reed Hastings",
  "Patty Quillin",
  "Lyda Hill",
  "Barron Hilton",
  "Orion Hindawi",
  "Jay Hoag",
  "Reid Hoffman",
  "Chris Hohn",
  "Elie Horn",
  "Drew Houston",
  "Tom Hunter",
  "Jon Huntsman",
  "Yan Huo",
  "Mo Ibrahim",
  "Carl Icahn",
  "Jared Isaacman",
  "Irwin Jacobs",
  "Joan Jacobs",
  "Badr Jafar",
  "Paul Tudor Jones",
  "John W. Jordan II",
  "Ryan D. Jumonville",
  "George B. Kaiser",
  "Nikhil Kamath",
  "Brad Keywell",
  "Vinod Khosla",
  "Bongjin Kim",
  "Beom-su Kim",
  "Sidney Kimmel",
  "Rich Kinder",
  "Nancy Kinder",
  "Robert E. King",
  "Seth Klarman",
  "Beth Klarman",
  "Robert Kogod",
  "Arlene Kogod",
  "Michael Krasny",
  "Elaine Langone",
  "Ken Langone",
  "Jeff Lawson",
  "Eric Lefkofsky",
  "Liz Lefkofsky",
  "Gerry Lenfest",
  "Marguerite Lenfest",
  "Peter B. Lewis",
  "Xin Liu",
  "Daoming Liu",
  "Lorry I. Lokey",
  "George Lucas",
  "Mellody Hobson",
  "Richard Lundquist",
  "Connie Lurie",
  "Bob Lurie",
  "Duncan MacMillan",
  "Nancy MacMillan",
  "Alfred E. Mann",
  "Joe Mansueto",
  "Bernie Marcus",
  "Billi Marcus",
  "Richard Edwin Marriott",
  "Strive Masiyiwa",
  "Kiran Mazumdar-Shaw",
  "Jed McCaleb",
  "John McCall MacBain",
  "Marcy McCall MacBain",
  "Craig McCaw",
  "Red McCombs",
  "Jim McKelvey",
  "Anna McKelvey",
  "PNC Menon",
  "Dean Metropoulos",
  "Gary K. Michelson",
  "Michael Milken",
  "Lori Milken",
  "Yuri Milner",
  "Julia Milner",
  "George P. Mitchell",
  "Thomas S. Monaghan",
  "Gordon Moore",
  "Betty Moore",
  "John Morgridge",
  "Tashia Morgridge",
  "Michael Moritz",
  "Harriet Heyman",
  "Dustin Moskovitz",
  "Cari Tuna",
  "Patrice Motsepe",
  "Elon Musk",
  "Jahm Najafi",
  "Jonathan M. Nelson",
  "José Ferreira Neves",
  "Craig Newmark",
  "Nandan Nilekani",
  "Rohini Nilekani",
  "Gensheng Niu",
  "Pierre Omidyar",
  "Pam Omidyar",
  "Paul Orfalea",
  "Bernard Osher",
  "Barbro Osher",
  "Bob Parsons",
  "Renee Parsons",
  "Jim Pattison",
  "Ronald O. Perelman",
  "Jorge M. Perez",
  "Melanie Perkins",
  "Cliff Obrecht",
  "Peter G. Peterson",
  "T. Boone Pickens",
  "Victor Pinchuk",
  "Mark Pincus",
  "Hasso Plattner",
  "Vladimir Potanin",
  "Azim Premji",
  "Tom Preston-Werner",
  "Ernest Rady",
  "Evelyn Rady",
  "Terry Ragon",
  "Susan Ragon",
  "Mitchell Rales",
  "Emily Rales",
  "Chad Richison",
  "Julian H. Robertson Jr.",
  "David Rockefeller",
  "Edward W. Rose",
  "Stephen M. Ross",
  "Jeff Rothschild",
  "David M. Rubenstein",
  "Chris Sacca",
  "David Sainsbury",
  "John Sall",
  "Ginger Sall",
  "Henry Samueli",
  "Susan Samueli",
  "Herb Sandler",
  "Marion Sandler",
  "Vicki Sant",
  "Jack Schuler",
  "Lynn Schusterman",
  "Steven Schuurman",
  "Stephen A. Schwarzman",
  "Paul Sciarra",
  "MacKenzie Scott",
  "Ruth Scott",
  "Bill Scott",
  "Walter Scott Jr.",
  "Tom Secunda",
  "Cindy Secunda",
  "Ben Silbermann",
  "Craig Silverstein",
  "Harold Simmons",
  "Annette Simmons",
  "Jim Simons",
  "Marilyn Simons",
  "Liz Simons",
  "Nat Simons",
  "Paul E. Singer",
  "Jeff Skoll",
  "Robert F. Smith",
  "John A. Sobrato",
  "John Sobrato",
  "Patrick Soon-Shiong",
  "Ted Stanley",
  "Mark Stevens",
  "Mary Stevens",
  "Tom Steyer",
  "Kat Taylor",
  "Harry H. Stine",
  "Jim Stowers",
  "Virginia Stowers",
  "Tahir",
  "Vincent Tan",
  "Hemant Taneja",
  "Nicolai Tangen",
  "Tad Taube",
  "Dianne Taube",
  "Robert Toll",
  "Jane Toll",
  "Claire Tow",
  "Leonard Tow",
  "Dennis Troper",
  "Susan Wojcicki",
  "Byron Trott",
  "Tina Trott",
  "Glen Tullman",
  "Ted Turner",
  "Albert Lee Ueltschi",
  "Hamdi Ulukaya",
  "Sunny Varkey",
  "Shamsheer Vayalil",
  "David Vélez",
  "Romesh Wadhwani",
  "Jian Wang",
  "David Weekley",
  "Sanford Weill",
  "Herbert Wertheim",
  "Shelby White",
  "Urs Wietlisbach",
  "Simone Wietlisbach",
  "Andrew Wilkinson",
  "Anne Wojcicki",
  "Ian Wood",
  "Hansjörg Wyss",
  "Tony Xu",
  "Samuel Yin",
  "You Zhonghui",
  "Mark Zuckerberg",
  "Priscilla Chan",
];

/**
 * Normalize a name for comparison: lowercase, remove middle initials,
 * suffixes, honorifics, and special characters.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|iii|iv|ii|dr\.?|sir|lord|dame|hrh|prince)\b/gi, "")
    .replace(/\b[a-z]\.\s*/g, "") // Remove middle initials like "M." or "G."
    .replace(/[^a-z\s-]/g, "") // Keep letters, spaces, hyphens
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to match a pledge name against a DB person.
 * Uses multiple strategies: exact, normalized, last-name + first-initial.
 */
function findMatch(pledgeName: string, dbPersons: { id: string; name: string; aliases: string[] }[]): { id: string; name: string } | null {
  const normalizedPledge = normalizeName(pledgeName);
  const pledgeParts = normalizedPledge.split(" ");
  const pledgeFirst = pledgeParts[0];
  const pledgeLast = pledgeParts[pledgeParts.length - 1];

  for (const person of dbPersons) {
    const normalizedDb = normalizeName(person.name);

    // Exact normalized match
    if (normalizedDb === normalizedPledge) {
      return { id: person.id, name: person.name };
    }

    // Last name match + first name starts with same letter (handles "Bill" vs "William", etc.)
    const dbParts = normalizedDb.split(" ");
    const dbFirst = dbParts[0];
    const dbLast = dbParts[dbParts.length - 1];

    if (dbLast === pledgeLast && dbFirst[0] === pledgeFirst[0]) {
      return { id: person.id, name: person.name };
    }

    // Check aliases
    if (person.aliases) {
      for (const alias of person.aliases) {
        if (normalizeName(alias) === normalizedPledge) {
          return { id: person.id, name: person.name };
        }
      }
    }
  }

  return null;
}

async function importGivingPledge() {
  console.log("=== Giving Pledge Import ===\n");
  console.log(`Source: https://www.givingpledge.org/pledger-list/`);
  console.log(`Signatories in list: ${PLEDGE_ENTRIES.length}\n`);

  // Load all persons
  const allPersons = await db.execute(sql`
    SELECT id, name, aliases FROM persons
  `) as { id: string; name: string; aliases: string[] }[];

  console.log(`Persons in DB: ${allPersons.length}\n`);

  let matched = 0;
  let unmatched = 0;
  const matchedPersons: { id: string; dbName: string; pledgeName: string }[] = [];
  const unmatchedNames: string[] = [];

  for (const pledgeName of PLEDGE_ENTRIES) {
    const match = findMatch(pledgeName, allPersons);
    if (match) {
      matchedPersons.push({ id: match.id, dbName: match.name, pledgeName });
      matched++;
    } else {
      unmatchedNames.push(pledgeName);
      unmatched++;
    }
  }

  console.log(`Matched: ${matched} signatories to DB persons`);
  console.log(`Unmatched: ${unmatched} signatories (not in our DB — may be spouses or non-billionaires)\n`);

  if (unmatchedNames.length > 0 && unmatchedNames.length <= 50) {
    console.log("Unmatched names:");
    for (const name of unmatchedNames) {
      console.log(`  - ${name}`);
    }
    console.log();
  }

  // Deduplicate by person ID (some couples both match the same person)
  const uniqueByPerson = new Map<string, { dbName: string; pledgeName: string }>();
  for (const m of matchedPersons) {
    if (!uniqueByPerson.has(m.id)) {
      uniqueByPerson.set(m.id, { dbName: m.dbName, pledgeName: m.pledgeName });
    }
  }

  console.log(`Unique persons to update: ${uniqueByPerson.size}\n`);

  let badgeUpdated = 0;
  let factInserted = 0;
  const now = new Date();

  for (const [personId, { dbName, pledgeName }] of uniqueByPerson) {
    // 1. Update badges to include givingPledge: true
    const person = await db.execute(sql`
      SELECT badges FROM persons WHERE id = ${personId}
    `) as any[];

    if (person.length > 0) {
      const currentBadges = (person[0].badges || {}) as Record<string, unknown>;
      if (!currentBadges.givingPledge) {
        currentBadges.givingPledge = true;
        await db.execute(sql`
          UPDATE persons SET badges = ${JSON.stringify(currentBadges)}::jsonb, updated_at = NOW()
          WHERE id = ${personId}
        `);
        badgeUpdated++;
      }
    }

    // 2. Store as a person_fact for attribution
    // Delete existing giving_pledge fact if any, then insert
    await db.execute(sql`
      DELETE FROM person_facts
      WHERE person_id = ${personId} AND fact_key = 'giving_pledge'
    `);

    await db.insert(personFacts).values({
      personId,
      factType: "philanthropy",
      factKey: "giving_pledge",
      factValue: {
        signatory: true,
        pledgeName,
        source: "The Giving Pledge",
      },
      sourceUrl: "https://www.givingpledge.org/pledger-list/",
      sourceType: "giving_pledge",
      retrievedAt: now,
      estimationMethod: "manual",
    });
    factInserted++;

    console.log(`  + ${dbName} (matched: "${pledgeName}") — badge + fact`);
  }

  console.log(`\nGiving Pledge import complete:`);
  console.log(`  ${badgeUpdated} badges updated`);
  console.log(`  ${factInserted} facts inserted`);
  console.log(`  Source: https://www.givingpledge.org/pledger-list/`);
  process.exit(0);
}

// Guarded 2026-08-19: a bare call here meant IMPORTING this file wrote to prod.
if (isMain(import.meta.url)) importGivingPledge();
