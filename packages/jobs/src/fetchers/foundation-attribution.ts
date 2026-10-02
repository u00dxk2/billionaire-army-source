/**
 * Foundation attribution guard (B-020).
 *
 * The 990 fetcher used to attach any nonprofit whose name merely CONTAINED the
 * person's surname. That credited Kaiser Permanente's $30.6B to George Kaiser,
 * the Ford Foundation's $918M to a fashion designer, and the James Irvine
 * Foundation to three unrelated Jameses — and those numbers flow into the
 * published PBS philanthropy score, not just the prose.
 *
 * The rule here is deliberately CONSERVATIVE, and the asymmetry is the point:
 * on a civic-accountability site a missed foundation is a thin profile, while a
 * wrongly-attached one is a false accusation of generosity (and the same logic
 * in reverse is how a stranger's money gets attached to a named individual).
 * So when the evidence is only a shared surname, we drop it.
 *
 * Modelled on the SEC matcher, which by rule requires ownership/insider filings
 * and refuses a bare full-text mention. Same lesson: attribution needs evidence,
 * not string similarity.
 */

import { FAMILY_SUFFIX } from "./name-utils";

/** Orgs that are plainly institutions, whatever surname they carry. */
const INSTITUTIONAL =
  /\b(hospital|hospitals|permanente|health\s*plan|healthcare|medical\s+center|clinic|university|college|school|schools|academy|birthright|public\s+library|symphony|museum|zoo|chamber\s+of\s+commerce|credit\s+union|housing\s+authority)\b/i;

/**
 * Famous eponymous foundations that are NOT the personal vehicle of anyone in
 * this index — legacy institutions named for a founder long dead, which pass
 * every structural test because their name really is "<Surname> Foundation".
 *
 * owner-reviewed by rule, same as LOW_CREDIBILITY_DOMAINS. Each entry must cite
 * the person it was actually observed mis-matching to — do not add one
 * speculatively, or this becomes a list that silently deletes real foundations.
 */
const LEGACY_INSTITUTIONS: { pattern: RegExp; observedOn: string }[] = [
  { pattern: /^(the\s+)?ford\s+foundation$/i, observedOn: "Tom Ford + Gerald Ford, $918,133,779" },
  { pattern: /^(the\s+)?knight\s+foundation$/i, observedOn: "Phil Knight, $191M (it is the John S. and James L. Knight Foundation)" },
  { pattern: /^(w\s*k\s+)?kellogg\s+foundation$/i, observedOn: "Peter Kellogg, $388,373,728 (W. K. Kellogg Foundation)" },
];

const ENTITY_WORD = /\b(foundation|fund|charitable|trust|philanthrop\w*)\b/i;

/**
 * Filler allowed between the person's surname and the charitable word.
 * Generational suffixes are here because they appear in the ORG name too
 * ("James C Goodnight Jr Foundation"), not only in the person's name.
 */
const CONNECTOR = /^(family|familys|fam|charitable|philanthropic|philanthropies|jr|sr|ii|iii|iv)$/i;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

/**
 * Strip common generational suffixes so "Ford Jr" still yields "ford" — and the RTB seed's
 * "& family" display suffix FIRST, because normalize() drops the "&" and would leave "family" as
 * the last token. Without that, "Clark Hunt & family" had the surname "family", and three
 * unrelated charities legally named "Family Foundation" (VA, WA, TX) passed both anchors below
 * for 59 people — a false claim of generosity in their chips and their published score.
 */
function nameParts(personName: string): { first: string; last: string } {
  const toks = normalize(personName.replace(FAMILY_SUFFIX, ""))
    .split(" ")
    .filter((t) => !/^(jr|sr|ii|iii|iv|v)$/.test(t));
  return { first: toks[0] ?? "", last: toks[toks.length - 1] ?? "" };
}

/**
 * Does this org plausibly belong to THIS person?
 *
 * Two anchors, both required — the org must OPEN with this person's name (or
 * carry their full name), AND their surname must be the last token before the
 * charitable word. Each anchor alone admits a whole class of wrong matches:
 * without the first, relatives collect each other's foundations; without the
 * second, "James Irvine Foundation" attaches to anyone surnamed James.
 *
 * Both the rule and its exceptions were derived from production rows and are
 * pinned as tests. Change it against the same evidence, not by reasoning about
 * name shapes — every wrong version of this function looked obviously right.
 */
export function isPlausiblyOwnFoundation(orgName: string, personName: string): boolean {
  const org = normalize(orgName);
  const { first, last } = nameParts(personName);
  if (!org || !last) return false;

  if (!ENTITY_WORD.test(org)) return false;
  if (INSTITUTIONAL.test(org)) return false;
  if (LEGACY_INSTITUTIONS.some((l) => l.pattern.test(org))) return false;

  // TWO conditions, and both are load-bearing. Each one alone lets a whole
  // class of wrong attributions through, so don't drop either.
  const toks = org.split(" ");

  // (a) The org must OPEN with this person's own name, OR carry their FULL name
  //     somewhere. Without this, every relative sharing the surname collects
  //     each other's foundations: "Howard G Buffett Foundation" (his son's)
  //     onto Warren, "Anne Kellogg Foundation" onto Peter, "Harold Alfond
  //     Foundation" onto four Alfonds. The full-name escape exists for spousal
  //     foundations that open with the OTHER spouse: "Charles And Lynn
  //     Schusterman Family Foundation" is Lynn Schusterman's.
  const head = toks[0];
  const opensWithThem = head === last || (first !== "" && head === first);
  const carriesFullName = first !== "" && org.includes(`${first} ${last}`);
  if (!opensWithThem && !carriesFullName) return false;

  // (b) The person's SURNAME must be the last thing before the charitable word
  //     (possessive filler may sit between). Without this, "James Irvine
  //     Foundation" attaches to anyone surnamed James — the leading "James"
  //     there is someone else's FIRST name and Irvine is the real surname.
  //
  //     Walking BACK from the entity word rather than forward from the head is
  //     what keeps the true positives that a forward walk destroys: middle
  //     initials ("Stephen A Schwarzman Foundation"), spousal conjunctions
  //     ("Phillip And Susan Ragon Foundation") and abbreviations ("Buffett Fam
  //     Foundation") all sit between the two anchors and are irrelevant to
  //     whether the org is theirs. A forward walk dropped all three.
  const entityAt = toks.findIndex((t) => ENTITY_WORD.test(t));
  if (entityAt < 1) return false;
  let i = entityAt - 1;
  while (i > 0 && CONNECTOR.test(toks[i])) i--;
  return toks[i] === last;
}

/**
 * KNOWN CEILING, stated rather than hidden: two people who share a surname
 * cannot be told apart by name alone, so the Musk Foundation matches both Elon
 * and Kimbal Musk and this guard keeps it for both. Fixing that needs real
 * evidence (filing officers/trustees), which is the same upgrade the SEC
 * matcher already made. Do not paper over it by adding first-name requirements
 * everywhere — that would drop "Gates Foundation" from Bill Gates.
 */
export const ATTRIBUTION_CEILING =
  "same-surname relatives share a foundation match; needs trustee-level evidence to separate";
