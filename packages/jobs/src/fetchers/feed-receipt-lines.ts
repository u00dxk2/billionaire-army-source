import { readerFacingScorePhrase } from "@ba/shared";

/**
 * B-063 — the receipts, as the curator's card writer (Pass A) AND its faithfulness judge
 * (Pass C) read them. ONE module, two readers, and no import-time side effects, so a test can
 * read the EMITTED prompt text (feed-curator.ts exits on import without DATABASE_URL).
 *
 * The generator was handed `FEC: $1.9M in political donations` / `990: $4M in foundation assets`
 * while Pass C's receipts carried the same figures with the source label stripped. The writer
 * then truthfully said "FEC records list…", and the judge — told only "$1.9M in political
 * donations" — could reject the provenance as unsupported. On 2026-09-23 it dropped both of the
 * day's cards (Wexner, Melinda French Gates) after Pass B had kept them; the feed published
 * nothing.
 *
 * Same defect R-081 fixed for the score line (`readerFacingScorePhrase`); these two lines were
 * left behind. The fix completes the judge's EVIDENCE, never its criteria: Pass C's prompt is
 * untouched (evangelism-bar BINDING — Pass C stays unloosened).
 *
 * `labels: false` exists ONLY for the dry-run label A/B (CURATOR_PASSC_LABEL_AB) and the B-063
 * probe, which re-judge cards with the pre-B-063 receipts to measure what the labels change.
 */

export interface MoneyReceiptContext {
  political?: string | null;
  philanthropy?: string | null;
}

export interface ReceiptCandidate {
  article: { title: string; source: string; date: string; body?: string };
  personName: string;
  context: { netWorth: string | null; pbs: string | null; political: string | null; philanthropy: string | null };
}

export interface ReceiptCard {
  headline: string;
  summary: string;
}

export function moneyReceiptLines(context: MoneyReceiptContext, opts: { labels?: boolean } = {}): string[] {
  const labels = opts.labels ?? true;
  const out: string[] = [];
  if (context.political) out.push(labels ? `FEC: ${context.political}` : context.political);
  if (context.philanthropy) out.push(labels ? `990: ${context.philanthropy}` : context.philanthropy);
  return out;
}

/**
 * The receipts string Pass C audits against, and the one its DROP log prints ("context it was
 * given") — the SINGLE source of both, so the log cannot describe a prompt that was never sent.
 */
export function contextReceiptsFor(c: ReceiptCandidate | undefined, opts: { labels?: boolean } = {}): string {
  if (!c) return "(candidate missing)";
  const ctx: string[] = [];
  if (c.context.netWorth) ctx.push(`net worth ${c.context.netWorth}`);
  // R-081 — the SAME phrase the generator was handed. If these two drift, Pass C audits a card
  // against a receipt string the generator never saw and rejects a grounded figure as invented.
  const scorePhrase = readerFacingScorePhrase(c.context.pbs);
  if (scorePhrase) ctx.push(`Billionaire Army ${scorePhrase}`);
  // B-063 — the money lines carry the same FEC:/990: labels the generator saw.
  ctx.push(...moneyReceiptLines(c.context, opts));
  return ctx.length ? ctx.join("; ") : "(none)";
}

/** The generator's (Pass A) block for one candidate. */
export function generatorCandidateBlock(c: ReceiptCandidate, i: number): string {
  const parts = [
    `[${i}] "${c.article.title}"`,
    `  Source: ${c.article.source} | Date: ${c.article.date}`,
    `  Billionaire: ${c.personName}`,
  ];
  if (c.context.netWorth) parts.push(`  Net Worth: ${c.context.netWorth}`);
  // R-081 — hand the model the BADGE's label and the BADGE's figure, not the internal one.
  // Fixed at the INPUT, for the same reason B-030's `collapseFoundationTotalsForPrompt` and
  // Cycle 11's political-units fix are: Pass C audits the rewrite against this same blob, so a
  // label copied out of it is "supported by the provided context" by construction. A gate
  // cannot adjudicate its own blind spot. `readerFacingScorePhrase` is also what
  // `contextReceiptsFor` hands Pass C, so the generator and the judge read one string.
  const scorePhrase = readerFacingScorePhrase(c.context.pbs);
  if (scorePhrase) parts.push(`  Billionaire Army ${scorePhrase} — our own grade for this person, not a figure from the article`);
  // B-063 — the SAME labeled lines contextReceiptsFor hands Pass C. One function, two readers.
  for (const line of moneyReceiptLines(c.context)) parts.push(`  ${line}`);
  if (c.article.body) parts.push(`  Excerpt: ${c.article.body.slice(0, 300)}...`);
  return parts.join("\n");
}

/** Pass C's block for one card — what the faithfulness judge actually reads. */
export function faithfulnessCardBlock(item: ReceiptCard, c: ReceiptCandidate, i: number, receiptLabels: boolean = true): string {
  const parts = [
    `[${i}] Billionaire: ${c.personName}`,
    `  Rewritten headline: "${item.headline}"`,
    `  Rewritten summary: "${item.summary}"`,
    `  --- SOURCE OF TRUTH (everything in the rewrite must trace to below) ---`,
    `  Original article title: "${c.article.title}"`,
    `  Source: ${c.article.source}`,
  ];
  if (c.article.body) parts.push(`  Original excerpt: ${c.article.body.slice(0, 400)}...`);
  parts.push(`  Provided context receipts: ${contextReceiptsFor(c, { labels: receiptLabels })}`);
  return parts.join("\n");
}
