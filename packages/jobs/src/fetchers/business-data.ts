/**
 * Curated business-profile dataset (R-015 increment 2, owner-approved 2026-07-06).
 *
 * "What does this person's company actually DO?" — Wikidata person→company links
 * are too sparse to answer this for private-company billionaires (Hank Meijer's
 * entity has no company link at all), and the SEC section shows filings, not a
 * plain-language description. This curated layer covers the marquee profiles a
 * partner demo actually opens; Wikidata/other sources can extend the long tail
 * later without changing the fact shape.
 *
 * INTEGRITY BAR (same as direct-giving-data.ts): this is a receipts platform —
 * every entry carries a source URL that was VERIFIED TO RESOLVE when added, and
 * descriptions state only what the company does, in plain language, with no
 * editorial spin. Official company pages preferred; encyclopedic (Wikipedia)
 * pages used where the official page blocks automated verification. Roles are
 * phrased durably (founder/co-founder/chairman) so they don't rot with every
 * executive change.
 */

export interface BusinessEntry {
  /** Company or firm name as displayed. */
  company: string;
  /** The person's durable relationship to it (founder / co-founder / chairman...). */
  role: string;
  /** 1-2 plain sentences: what the company does. Facts only. */
  description: string;
  /** Verified source for the description. */
  sourceUrl: string;
  sourceName: string;
}

export interface BusinessProfileEntry {
  /** Name for matching against persons.name (see findPersonId in direct-giving-data). */
  name: string;
  businesses: BusinessEntry[];
}

export const BUSINESS_PROFILES: BusinessProfileEntry[] = [
  {
    name: "Elon Musk",
    businesses: [
      {
        company: "Tesla, Inc.",
        role: "CEO",
        description:
          "Designs, manufactures, and sells electric vehicles, battery energy-storage systems, and solar products.",
        sourceUrl: "https://en.wikipedia.org/wiki/Tesla,_Inc.",
        sourceName: "Wikipedia",
      },
      {
        company: "SpaceX",
        role: "Founder & CEO",
        description:
          "Builds and launches rockets and spacecraft, and operates the Starlink satellite-internet constellation.",
        sourceUrl: "https://www.spacex.com/company/",
        sourceName: "SpaceX",
      },
    ],
  },
  {
    name: "Bill Gates",
    businesses: [
      {
        company: "Microsoft",
        role: "Co-founder",
        description:
          "Develops software, cloud services, and devices — including Windows, Office/Microsoft 365, and the Azure cloud platform.",
        sourceUrl: "https://en.wikipedia.org/wiki/Microsoft",
        sourceName: "Wikipedia",
      },
    ],
  },
  {
    name: "Jeff Bezos",
    businesses: [
      {
        company: "Amazon",
        role: "Founder & Executive Chairman",
        description:
          "Operates the world's largest online retail marketplace plus Amazon Web Services, the leading cloud-computing platform.",
        sourceUrl: "https://www.aboutamazon.com/about-us",
        sourceName: "Amazon",
      },
    ],
  },
  {
    name: "Warren Buffett",
    businesses: [
      {
        company: "Berkshire Hathaway",
        role: "Chairman",
        description:
          "A holding company owning insurance (GEICO), railroad (BNSF), energy, manufacturing, and consumer businesses outright, plus large stock positions in public companies.",
        sourceUrl: "https://www.berkshirehathaway.com/subs/sublinks.html",
        sourceName: "Berkshire Hathaway",
      },
    ],
  },
  {
    name: "Mark Zuckerberg",
    businesses: [
      {
        company: "Meta Platforms",
        role: "Co-founder & CEO",
        description:
          "Runs the social apps Facebook, Instagram, WhatsApp, and Messenger, earning most revenue from targeted advertising.",
        sourceUrl: "https://about.meta.com/company-info/",
        sourceName: "Meta",
      },
    ],
  },
  {
    name: "Larry Ellison",
    businesses: [
      {
        company: "Oracle",
        role: "Co-founder, Chairman & CTO",
        description:
          "Sells database software, enterprise applications, and cloud infrastructure to businesses and governments.",
        sourceUrl: "https://www.oracle.com/corporate/",
        sourceName: "Oracle",
      },
    ],
  },
  {
    name: "Larry Page",
    businesses: [
      {
        company: "Alphabet (Google)",
        role: "Co-founder",
        description:
          "Parent of Google — web search, YouTube, Android, and the advertising business that funds them — plus other ventures like Waymo.",
        sourceUrl: "https://en.wikipedia.org/wiki/Alphabet_Inc.",
        sourceName: "Wikipedia",
      },
    ],
  },
  {
    name: "Sergey Brin",
    businesses: [
      {
        company: "Alphabet (Google)",
        role: "Co-founder",
        description:
          "Parent of Google — web search, YouTube, Android, and the advertising business that funds them — plus other ventures like Waymo.",
        sourceUrl: "https://en.wikipedia.org/wiki/Alphabet_Inc.",
        sourceName: "Wikipedia",
      },
    ],
  },
  {
    name: "Michael Bloomberg",
    businesses: [
      {
        company: "Bloomberg L.P.",
        role: "Co-founder & majority owner",
        description:
          "Sells financial data and analytics — chiefly the Bloomberg Terminal used by banks and investors — and runs the Bloomberg News media operation.",
        sourceUrl: "https://en.wikipedia.org/wiki/Bloomberg_L.P.",
        sourceName: "Wikipedia",
      },
    ],
  },
  {
    name: "Phil Knight",
    businesses: [
      {
        company: "Nike",
        role: "Co-founder & Chairman Emeritus",
        description:
          "Designs and sells athletic footwear, apparel, and equipment worldwide under the Nike, Jordan, and Converse brands.",
        sourceUrl: "https://about.nike.com/en/company",
        sourceName: "Nike",
      },
    ],
  },
  {
    name: "Jensen Huang",
    businesses: [
      {
        company: "Nvidia",
        role: "Co-founder & CEO",
        description:
          "Designs the graphics and AI chips (GPUs) that power gaming, data centers, and most modern artificial-intelligence systems.",
        sourceUrl: "https://www.nvidia.com/en-us/about-nvidia/",
        sourceName: "Nvidia",
      },
    ],
  },
  {
    name: "George Soros",
    businesses: [
      {
        company: "Soros Fund Management",
        role: "Founder",
        description:
          "A private investment firm (now a family office) that manages the Soros family's capital and the endowment of the Open Society Foundations.",
        sourceUrl: "https://en.wikipedia.org/wiki/Soros_Fund_Management",
        sourceName: "Wikipedia",
      },
    ],
  },
  {
    name: "Hank Meijer",
    businesses: [
      {
        company: "Meijer",
        role: "Executive Chairman",
        description:
          "A privately held Midwestern supercenter chain — groceries plus general merchandise — with hundreds of stores across Michigan and neighboring states.",
        sourceUrl: "https://en.wikipedia.org/wiki/Meijer",
        sourceName: "Wikipedia",
      },
    ],
  },
];
