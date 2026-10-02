/**
 * B-021 (2026-10-01): a person whose foundations were reviewed against TRUSTEE evidence may only be
 * attached to the EINs that evidence supports.
 *
 * The name rule in foundation-attribution.ts cannot tell "Ford Family Foundation" (an unrelated family's foundation) from a fashion designer called Tom Ford; four successive string rules
 * were each wrong in production, so B-021 forbids closing it by tightening the rule. This module is
 * the evidence route instead: for each REVIEWED person, every candidate EIN was read on its ProPublica
 * Nonprofit Explorer org page (the 990 "Key Employees and Officers" rows, regex-extracted from raw
 * HTML), and an EIN is ALLOWED only where an officer row names the person or their spouse, or the
 * foundation's own site names them its founder (the B-068 rule).
 *
 * WHY AN ALLOWLIST AND NOT A BLOCKLIST. Blocking the rejected EINs would let the next search surface a
 * fourth same-surname namesake in their place (fetch:990 keeps the first three matches). For a
 * reviewed person the search result is cut down to the allowed EINs; a person with none allowed then
 * falls into the fetcher's existing self-heal and holds NO foundation_990s row at all.
 *
 * WHY NOT A CURATED EMPTY ROW. Any foundation_990s row counts as giving evidence
 * (pbs-evidence.ts GIVING_EVIDENCE_FACT_KEYS), so an empty one would turn a 0 philanthropy score into
 * "evidenced-zero" — the page would say a 990 we hold reports no grants, about a person who has no
 * foundation. An ABSENT row reads "unevidenced", which is the true statement.
 *
 * Reviewed persons are still fetched (unlike B-068's manual_curated skip), so an allowed foundation
 * keeps refreshing from new filings.
 */

export interface TrusteeReview {
  person: string;
  reviewedAt: string;
  /** EIN (9 digits) → the evidence that names this person on that foundation. */
  allowed: Record<string, string>;
  /** EIN (9 digits) → why it was rejected (officer list read, no row names the person or spouse). */
  rejected: Record<string, string>;
}

const PP = (ein: string) => `https://projects.propublica.org/nonprofits/organizations/${ein}`;
const NO_OFFICER = "officer rows on the ProPublica org page name neither the person nor a spouse";
const NO_FILING = "no officer rows and $0 assets on the ProPublica org page — nothing names the person";

export const TRUSTEE_REVIEWED: Readonly<Record<string, TrusteeReview>> = {
  "d469e305-a703-461b-aa9b-b83abae9c65f": {
    person: "Tom Ford", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "936026156": `${NO_OFFICER} — ${PP("936026156")}`,
      "884301211": `${NO_OFFICER} — ${PP("884301211")}`,
      "873117234": `${NO_OFFICER} — ${PP("873117234")}`,
    },
  },
  "654f81ef-7f40-4bcb-b4d6-c3b821995b6f": {
    person: "Gerald Ford", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "936026156": `${NO_OFFICER} — ${PP("936026156")}`,
      "873117234": `${NO_OFFICER} — ${PP("873117234")}`,
    },
  },
  "b94406cd-50b6-488d-b42a-5f19fadbf097": {
    person: "LeBron James", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "131614951": `${NO_OFFICER} — ${PP("131614951")}`,
      "452195649": `${NO_OFFICER} — ${PP("452195649")}`,
      "352388979": `${NO_OFFICER} — ${PP("352388979")}`,
    },
  },
  "3f188df1-ec76-4a64-93d4-6449a6f6327e": {
    person: "Ryan Israel", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "463475443": `${NO_FILING} — ${PP("463475443")}`,
      "200282402": `${NO_OFFICER} — ${PP("200282402")}`,
      "842820654": `${NO_FILING} — ${PP("842820654")}`,
    },
  },
  "1175c868-7795-4b36-a715-e9ff1257bc47": {
    person: "Phil Knight", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "466315139": `${NO_OFFICER} — ${PP("466315139")}`,
      "364265122": `${NO_OFFICER} — ${PP("364265122")}`,
      "475058173": `${NO_OFFICER} — ${PP("475058173")}`,
    },
  },
  "dd311251-3435-47df-a49a-4ac97f43ce51": {
    person: "George Kaiser", reviewedAt: "2026-10-01",
    allowed: {
      "731574370": `gkff.org names him founder ("As founder of GKFF, Kaiser remains the primary donor"; "He established the family foundation in 1999") — https://www.gkff.org/about/about-george-kaiser — ${PP("731574370")}`,
    },
    rejected: {
      "811168111": `${NO_OFFICER} — ${PP("811168111")}`,
      "840278210": `${NO_OFFICER} — ${PP("840278210")}`,
    },
  },
  "c67e0ca3-8d8e-440b-8620-ff3edbe5c47e": {
    person: "MacKenzie Scott", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "465100762": `${NO_OFFICER} — ${PP("465100762")}`,
      "464644295": `${NO_OFFICER} — ${PP("464644295")}`,
      "470980880": `${NO_OFFICER} — ${PP("470980880")}`,
    },
  },
  "58c407cc-363c-4e53-aef0-ad3b645b28b8": {
    person: "Larry Page", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "943097808": `${NO_OFFICER} — ${PP("943097808")}`,
      "205989748": `${NO_OFFICER} — ${PP("205989748")}`,
      "412751383": `${NO_FILING} — ${PP("412751383")}`,
    },
  },
  "ce781063-91b5-49e5-b6e6-21159b0d88dd": {
    person: "Anthony Wood", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "311217729": `${NO_OFFICER} — ${PP("311217729")}`,
      "371845376": `${NO_OFFICER} — ${PP("371845376")}`,
      "331067481": `${NO_OFFICER} — ${PP("331067481")}`,
    },
  },
  "b5b37198-44fe-41db-87b1-b60c30723683": {
    person: "Neal Blue", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "261919507": `${NO_OFFICER} — ${PP("261919507")}`,
      "851900888": `${NO_FILING} — ${PP("851900888")}`,
      "271579792": `${NO_OFFICER} — ${PP("271579792")}`,
    },
  },
  "c00b487c-6f99-496d-9c11-369f8d807f05": {
    person: "Michael Jordan", reviewedAt: "2026-10-01", allowed: {},
    rejected: {
      "882989784": `${NO_OFFICER} — ${PP("882989784")}`,
      "752486085": `${NO_OFFICER} — ${PP("752486085")}`,
      "586039423": `${NO_OFFICER} — ${PP("586039423")}`,
    },
  },
};

/** ProPublica returns EINs as numbers, which drops a leading zero. */
export function normalizeEin(ein: number | string): string {
  return String(ein).replace(/\D/g, "").padStart(9, "0");
}

/**
 * The foundations a person may be attached to. An unreviewed person passes through unchanged; a
 * reviewed person keeps ONLY the allowed EINs — including an EIN the review never saw, which is dropped.
 */
export function applyTrusteeReview<T extends { ein: number | string }>(personId: string, candidates: readonly T[]): T[] {
  const review = TRUSTEE_REVIEWED[personId];
  if (!review) return [...candidates];
  return candidates.filter((c) => Object.hasOwn(review.allowed, normalizeEin(c.ein)));
}
