/**
 * B-037 employer-affiliation verdict — PURE, read-only, proposes NO rule.
 *
 * Question: does an FEC record's `contributor_employer` name something we already know the
 * person is affiliated with? Employer EQUALITY is eliminated (one true donor's own records span
 * BAY GROVE / LINEAGE), so this tests SIMILARITY to a SET of affiliations, by distinctive token.
 *
 * Five verdicts, and every record lands in exactly one:
 *   affiliated   — the employer shares a distinctive token with the person's affiliation list
 *   surname      — no list token, but the employer carries the person's surname (family firms:
 *                  "BECHTEL CORP"). Reported apart: a same-surname relative matches it too.
 *   unaffiliated — a SPECIFIC employer that matches neither. The only verdict that is evidence
 *                  AGAINST the record, and it is still not proof (a board seat we never stored).
 *   generic      — blank / RETIRED / SELF-EMPLOYED / INVESTOR / NOT EMPLOYED … NOT JUDGED: a
 *                  billionaire filing RETIRED is still himself.
 *   no-list      — the person has no affiliation list at all. NOT JUDGED, never a miss.
 */

/** Employer strings that say nothing about WHO the filer works for. Matched on the whole string. */
const GENERIC_EMPLOYERS = new Set([
  "", "NONE", "N/A", "NA", "NOT APPLICABLE", "NOT EMPLOYED", "UNEMPLOYED", "RETIRED", "SELF",
  "SELF EMPLOYED", "SELF-EMPLOYED", "SELFEMPLOYED", "SELF EMPLOYED/INVESTOR", "INVESTOR",
  "INVESTMENTS", "PRIVATE INVESTOR", "HOMEMAKER", "HOME MAKER", "STUDENT", "PHILANTHROPIST",
  "INFORMATION REQUESTED", "INFORMATION REQUESTED PER BEST EFFORTS", "REQUESTED",
  "BEST EFFORTS", "NOT PROVIDED", "ENTREPRENEUR", "BUSINESS OWNER", "OWNER", "EXECUTIVE",
]);

/** Corporate-form and filler words: they match everything, so they identify nothing. */
const STOP_TOKENS = new Set([
  "INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "LIMITED", "CORP", "CORPORATION", "CO",
  "COMPANY", "COMPANIES", "PLC", "GROUP", "HOLDINGS", "HOLDING", "PARTNERS", "PARTNERSHIP",
  "CAPITAL", "MANAGEMENT", "INVESTMENTS", "INVESTMENT", "ENTERPRISES", "INTERNATIONAL",
  "GLOBAL", "TRUST", "FUND", "FUNDS", "FOUNDATION", "SERVICES", "SYSTEMS", "TECHNOLOGIES",
  "TECHNOLOGY", "THE", "AND", "OF", "FOR", "AMERICAN", "AMERICA", "USA", "US", "NEW",
  "INDUSTRIES", "ASSOCIATES", "VENTURES", "PROPERTIES", "REAL", "ESTATE", "BANK", "FINANCIAL",
  "SELF", "EMPLOYED", "RETIRED", "CEO", "FOUNDER", "PRESIDENT", "CHAIRMAN", "OWNER",
]);

/** Upper-case word tokens with punctuation spaced apart; a ticker suffix "(LINE)" is dropped. */
export function tokens(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .toUpperCase()
    .replace(/\([A-Z0-9 ,.-]*\)/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Tokens that can identify a company: length ≥ 3, not a corporate-form or filler word. */
export function distinctiveTokens(raw: unknown): string[] {
  return tokens(raw).filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

// Normalized with the SAME function as the input, or a punctuated constant ("SELF EMPLOYED/INVESTOR")
// can never match and a NOT JUDGED record leaks into the unaffiliated count (Codex review 2026-09-28).
const GENERIC_NORMALIZED = new Set([...GENERIC_EMPLOYERS].map((g) => tokens(g).join(" ")));

export function isGenericEmployer(raw: unknown): boolean {
  return GENERIC_NORMALIZED.has(tokens(raw).join(" "));
}

export type EmployerVerdict = "affiliated" | "surname" | "unaffiliated" | "generic" | "no-list";

/**
 * The verdict for one record. `affiliations` is the person's affiliation STRINGS (company names),
 * `personName` their full name. EVERY token of the person's own name is removed from the
 * affiliation set, so a list entry like "Forste Adam Matthew" cannot make "ADAM FORSTE" or
 * "MATTHEW CONSULTING" read affiliated (Codex review 2026-09-28: surname-only removal let the
 * first and middle names through). Only the surname gets its own, separately reported, verdict.
 */
export function employerVerdict(
  employer: unknown,
  affiliations: readonly string[],
  personName: string,
): EmployerVerdict {
  if (isGenericEmployer(employer)) return "generic";
  const emp = new Set(distinctiveTokens(employer));
  if (emp.size === 0) return "generic";
  const own = new Set(tokens(personName));
  const surname = surnameOf(personName);
  const sur = surname ? tokens(surname).filter((t) => t.length >= 3) : [];
  const affTokens = new Set(affiliations.flatMap(distinctiveTokens).filter((t) => !own.has(t)));
  if (affTokens.size === 0) return "no-list";
  for (const t of emp) if (affTokens.has(t)) return "affiliated";
  if (sur.some((t) => emp.has(t))) return "surname";
  return "unaffiliated";
}

/** Surname = the last name token, ignoring a trailing generational suffix. */
export function surnameOf(name: string): string | null {
  const parts = name.trim().split(/\s+/).filter((p) => !/^(JR|SR|II|III|IV)\.?$/i.test(p));
  return parts.length ? parts[parts.length - 1].replace(/[^A-Za-z-]/g, "") || null : null;
}

/**
 * The person's affiliation list, from STORED facts only, each source named so coverage can be
 * reported per source. `description` contributes only the text after "of"/"at" ("co-founder of
 * Twitter") — the leading part is nationality and occupation, which identify nobody.
 */
export function affiliationsFrom(facts: {
  secCompanies?: readonly { name?: unknown }[] | null;
  businessCompanies?: readonly { company?: unknown }[] | null;
  description?: unknown;
  /** Firm LABELS from Wikidata (employer / owner-of / founded-by / CEO-of / owned-by), fetched live. */
  wikidataFirms?: readonly string[] | null;
}): { list: string[]; sources: string[] } {
  const list: string[] = [];
  const sources: string[] = [];
  const wd = (facts.wikidataFirms ?? []).filter((n) => typeof n === "string" && n.length > 0 && !/^Q\d+$/.test(n));
  if (wd.length) { list.push(...wd); sources.push("wikidata"); }
  const sec = (facts.secCompanies ?? []).map((c) => c?.name).filter((n): n is string => typeof n === "string" && n.length > 0);
  if (sec.length) { list.push(...sec); sources.push("sec_filings"); }
  const biz = (facts.businessCompanies ?? []).map((c) => c?.company).filter((n): n is string => typeof n === "string" && n.length > 0);
  if (biz.length) { list.push(...biz); sources.push("business_profile"); }
  if (typeof facts.description === "string") {
    const m = facts.description.match(/\b(?:of|at)\s+(.+)$/i);
    if (m && distinctiveTokens(m[1]).length) { list.push(m[1]); sources.push("description"); }
  }
  return { list, sources };
}
