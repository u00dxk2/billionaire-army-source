import { createDb, persons, goals } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);

// Sample rows for local development only. They are not verified facts; the real
// pipeline builds person records from public sources (see packages/jobs).
const seedPersons = [
  {
    name: "Elon Musk",
    wikidataId: "Q317521",
    birthYear: 1971,
    country: "US",
    state: "Texas",
    industry: ["Technology","Automotive","Space"],
    gender: "male",
    usPresence: [{ type: "business", details: "Tesla SpaceX X Corp" }, { type: "residence", details: "Texas" }],
    badges: { givingPledge: true, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Jeff Bezos",
    wikidataId: "Q312141",
    birthYear: 1964,
    country: "US",
    state: "Florida",
    industry: ["Technology","Retail","Space"],
    gender: "male",
    usPresence: [{ type: "business", details: "Amazon Blue Origin" }, { type: "residence", details: "Florida" }],
    badges: { givingPledge: false, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Bill Gates",
    wikidataId: "Q5284",
    birthYear: 1955,
    country: "US",
    state: "Washington",
    industry: ["Technology","Philanthropy"],
    gender: "male",
    usPresence: [{ type: "business", details: "Microsoft Gates Foundation" }, { type: "residence", details: "Washington" }],
    badges: { givingPledge: true, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Warren Buffett",
    wikidataId: "Q47213",
    birthYear: 1930,
    country: "US",
    state: "Nebraska",
    industry: ["Finance","Investments"],
    gender: "male",
    usPresence: [{ type: "business", details: "Berkshire Hathaway" }, { type: "residence", details: "Nebraska" }],
    badges: { givingPledge: true, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Larry Ellison",
    wikidataId: "Q186339",
    birthYear: 1944,
    country: "US",
    state: "Hawaii",
    industry: ["Technology","Software"],
    gender: "male",
    usPresence: [{ type: "business", details: "Oracle" }, { type: "residence", details: "Hawaii" }],
    badges: { givingPledge: false, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Mark Zuckerberg",
    wikidataId: "Q36215",
    birthYear: 1984,
    country: "US",
    state: "California",
    industry: ["Technology","Social Media"],
    gender: "male",
    usPresence: [{ type: "business", details: "Meta Platforms" }, { type: "residence", details: "California" }],
    badges: { givingPledge: true, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Steve Ballmer",
    wikidataId: "Q485611",
    birthYear: 1956,
    country: "US",
    state: "Washington",
    industry: ["Technology","Sports"],
    gender: "male",
    usPresence: [{ type: "business", details: "Former Microsoft CEO LA Clippers" }, { type: "residence", details: "Washington" }],
    badges: { givingPledge: true, claimedPage: false, goalAdopted: false },
  },
  {
    name: "Michael Bloomberg",
    wikidataId: "Q607",
    birthYear: 1942,
    country: "US",
    state: "New York",
    industry: ["Finance","Media","Politics"],
    gender: "male",
    usPresence: [{ type: "business", details: "Bloomberg LP" }, { type: "residence", details: "New York" }],
    badges: { givingPledge: true, claimedPage: false, goalAdopted: false },
  },
];

console.log("Seeding persons...");
for (const person of seedPersons) {
  const [inserted] = await db.insert(persons).values(person).onConflictDoNothing({ target: persons.wikidataId }).returning();
  if (inserted) { console.log("  + " + inserted.name + " (" + inserted.id + ")"); }
  else { console.log("  = " + person.name + " (already exists)"); }
}

const seedGoals = [
  {
    title: "Reduce Denver Metro Rent Burden",
    problemStatement: "Too many Denver metro residents spend over 30% of income on rent.",
    scope: "Denver-Aurora-Lakewood MSA (pop. ~2.9M)",
    baselineMetric: "Median rent-to-income ratio: 31% (Census ACS 2024)",
    baselineSourceUrl: "https://data.census.gov/",
    baselineRetrievedAt: new Date("2025-01-15"),
    targetMetric: "Reduce median rent-to-income ratio to 25%",
    deadline: "2030-12-31",
    interventions: ["Direct housing construction","Community land trusts","Employer housing programs","Down payment assistance funds"],
    kpis: [
      { name: "Median rent-to-income ratio", unit: "%", baselineValue: 31, targetValue: 25 },
      { name: "Affordable units built", unit: "units", baselineValue: 0, targetValue: 5000 },
      { name: "Homeownership rate", unit: "%", baselineValue: 62, targetValue: 68 },
    ],
    milestones: [
      { title: "Complete regional housing needs assessment", targetDate: "2026-06-30", status: "pending" },
      { title: "Break ground on first 500-unit project", targetDate: "2027-06-30", status: "pending" },
      { title: "1,000 affordable units completed", targetDate: "2028-12-31", status: "pending" },
      { title: "3,000 affordable units completed", targetDate: "2029-12-31", status: "pending" },
      { title: "Reach 25% rent-to-income target", targetDate: "2030-12-31", status: "pending" },
    ],
    risksAndExternalities: "Displacement of existing residents; potential for gentrification.",
    status: "active",
  },
  {
    title: "Cut Overdose Deaths in Appalachian Ohio",
    problemStatement: "Appalachian Ohio has among the highest overdose death rates nationally.",
    scope: "Appalachian Ohio (32 counties pop. ~1.5M)",
    baselineMetric: "Overdose death rate: 48 per 100000 (CDC WONDER 2023)",
    baselineSourceUrl: "https://wonder.cdc.gov/",
    baselineRetrievedAt: new Date("2025-02-01"),
    targetMetric: "Reduce overdose death rate to 30 per 100000",
    deadline: "2029-12-31",
    interventions: ["Fund naloxone distribution","Support MAT clinics","Workforce retraining","Peer support networks"],
    kpis: [
      { name: "Overdose death rate", unit: "per 100k", baselineValue: 48, targetValue: 30 },
      { name: "Naloxone kits distributed", unit: "kits", baselineValue: 0, targetValue: 50000 },
      { name: "MAT clinic coverage", unit: "%", baselineValue: 35, targetValue: 80 },
    ],
    milestones: [
      { title: "Deploy naloxone to all 32 county health departments", targetDate: "2026-12-31", status: "pending" },
      { title: "Open 10 new MAT clinics", targetDate: "2027-12-31", status: "pending" },
      { title: "Overdose rate below 40 per 100k", targetDate: "2028-12-31", status: "pending" },
      { title: "Reach target of 30 per 100k", targetDate: "2029-12-31", status: "pending" },
    ],
    risksAndExternalities: "Stigma may reduce uptake; political opposition to harm reduction.",
    status: "active",
  },
  {
    title: "Universal School Meals in Mississippi",
    problemStatement: "Mississippi has the highest child food insecurity rate in the US.",
    scope: "State of Mississippi (pop. ~2.9M)",
    baselineMetric: "20.7% of children food insecure (Feeding America 2023)",
    baselineSourceUrl: "https://map.feedingamerica.org/",
    baselineRetrievedAt: new Date("2025-01-20"),
    targetMetric: "100% of public school students access free breakfast and lunch",
    deadline: "2028-08-31",
    interventions: ["Fund universal free meal programs","School kitchen infrastructure","Farm-to-school supply chains","Weekend backpack programs"],
    risksAndExternalities: "Requires state agency cooperation; long-term sustainability.",
    status: "active",
  },
  {
    title: "Close the Broadband Gap in Rural Montana",
    problemStatement: "Rural Montana lacks reliable broadband limiting opportunity.",
    scope: "Rural Montana (counties under 50% broadband pop. ~300K)",
    baselineMetric: "42% of rural Montana households have broadband (FCC 2024)",
    baselineSourceUrl: "https://broadbandmap.fcc.gov/",
    baselineRetrievedAt: new Date("2025-01-10"),
    targetMetric: "80% broadband coverage in rural Montana counties",
    deadline: "2030-06-30",
    interventions: ["Fiber optic investment","Fixed wireless deployment","Community mesh networks","Public-private ISP partnerships"],
    risksAndExternalities: "High deployment costs; seasonal weather delays.",
    status: "active",
  },
  {
    title: "Eliminate Medical Debt in New Mexico",
    problemStatement: "New Mexico has among the highest medical debt rates in the US.",
    scope: "State of New Mexico (pop. ~2.1M)",
    baselineMetric: "22% of adults have medical debt in collections (CFPB 2024)",
    baselineSourceUrl: "https://www.consumerfinance.gov/",
    baselineRetrievedAt: new Date("2025-02-05"),
    targetMetric: "Reduce medical debt in collections to below 10%",
    deadline: "2029-12-31",
    interventions: ["Buy and forgive medical debt","Fund charity care programs","Medicaid expansion outreach","Billing transparency advocacy"],
    risksAndExternalities: "May not address root causes; hospital resistance to transparency.",
    status: "active",
  },
];

console.log("Seeding goals...");
for (const goal of seedGoals) {
  const [inserted] = await db.insert(goals).values(goal).returning();
  console.log("  + " + inserted.title + " (" + inserted.id + ")");
}

console.log("Seed complete!");
process.exit(0);
