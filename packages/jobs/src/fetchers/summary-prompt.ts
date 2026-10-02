import {
  collapseFoundationTotalsForPrompt,
  labelFecMoneyForPrompt,
  labelFecTruncationForPrompt,
  newsFactForPrompt,
  withholdImpossibleFecForPrompt,
} from "./summary-fact-collapse";

/**
 * The SOURCE DATA string handed to the summary model.
 *
 * It lives in its own module for the reason `admin-allowlist.ts` does: `profile-summary.ts`
 * reads `DATABASE_URL` at module scope, so importing it from a test throws before any
 * assertion runs — and a wire-up that cannot be imported cannot be tested. The two
 * fact-shaping calls below are the whole point of testing it: each was added because a number
 * reached a real profile in a form the model could misread, and a test of the helpers alone
 * stays green if nobody calls them.
 */
export interface SummaryPersonInput {
  name: string;
  state: string | null;
  industry: string[];
  birthYear: number | null;
  country: string | null;
  facts: { factKey: string; factValue: unknown; sourceType: string | null }[];
}

export function buildUserPrompt(person: SummaryPersonInput): string {
  const parts: string[] = [];

  parts.push(`Person: ${person.name}`);
  if (person.state) parts.push(`State: ${person.state}`);
  if (person.industry?.length) parts.push(`Industry: ${person.industry.join(", ")}`);
  if (person.birthYear) parts.push(`Born: ${person.birthYear}`);
  if (person.country) parts.push(`Country: ${person.country}`);

  for (const fact of person.facts) {
    // B-037 write-path: a record we would REFUSE TO RENDER never reaches the model. Returns null
    // to mean drop. This must stay in the LOOP rather than beside the shaping calls below, because
    // it removes the fact rather than reshaping it — and it needs `factKey`, which the shaping
    // helpers deliberately do not take.
    if (withholdImpossibleFecForPrompt(fact.factKey, fact.factValue, person.birthYear) === null) {
      continue;
    }
    // B-060: the articles only — never our retrieval bookkeeping (counts, "validated", sentiment,
    // derived window), which the model narrated back to readers. An empty article list drops the fact.
    const factValue = newsFactForPrompt(fact.factKey, fact.factValue);
    if (factValue === null) continue;

    const label = fact.factKey.toUpperCase().replace(/_/g, " ");
    let value: string;

    if (typeof factValue === "object" && factValue !== null) {
      // B-030: collapse doubled foundation totals, label FEC money as money, and declare a
      // TRUNCATED FEC record as truncated, BEFORE the model sees any of it. The faithfulness
      // verifier audits the prose against this same blob, so an un-collapsed sum, an unlabelled
      // dollar figure, or a page-cap count in here all come back "faithful" — every one of the
      // three fixes has to happen at the input. See summary-fact-collapse.ts.
      const shaped = labelFecTruncationForPrompt(
        labelFecMoneyForPrompt(collapseFoundationTotalsForPrompt(factValue)),
      );
      const json = JSON.stringify(shaped);
      // Trim large objects to avoid token waste
      value = json.length > 3000 ? json.substring(0, 3000) + "..." : json;
    } else {
      value = String(factValue);
    }

    parts.push(`\n--- ${label} [source: ${fact.sourceType || "unknown"}] ---\n${value}`);
  }

  parts.push("\nWrite a factual profile summary based on this data. Return JSON only.");
  return parts.join("\n");
}
