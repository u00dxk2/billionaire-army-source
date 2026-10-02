/**
 * PRESERVATION, NOT DELETION. `figure-block.ts` is the PREDICATE and is unchanged; this file is its CONSEQUENCE.
 *
 * When the block fires on a section:
 *   - the profile ALREADY published that section → the published text is KEPT, the candidate never
 *     publishes, and the candidate goes to a quarantine record;
 *   - FIRST generation (nothing published) → that one section is withheld, same quarantine record.
 * Nothing already live is ever removed by the block. That is the whole point of C2: the predicate
 * also fires on TRUE text it cannot enumerate (a bound, a four-addend total — figure-block.ts:35-44),
 * and under option A that meant deleting a true, live paragraph. Under C2 a false fire costs a
 * FRESHER paragraph, never the one a reader already has.
 *
 * The quarantine row lives in person_facts under SUMMARY_QUARANTINE_FACT_KEY. It holds text with a
 * figure our own record contradicts, about a named living person, so it must never be served or fed
 * back into a prompt: every read path that is not an explicit fact_key ALLOWLIST excludes this key.
 */
import { findBlockingFigureDisagreements, type BlockingFigureDisagreement } from "./figure-block";

export const SUMMARY_QUARANTINE_FACT_KEY = "summary_quarantine";

export interface QuarantineEntry {
  section: string;
  /** The full candidate text the block refused to publish. */
  candidate: string;
  disagreements: BlockingFigureDisagreement[];
  /** `previous` — the already-published section was kept. `withheld` — first generation, nothing published. */
  kept: "previous" | "withheld";
}

export interface FigureBlockOutcome {
  /** What to write: the candidate, with each blocked section replaced by the published one or removed. */
  summary: Record<string, unknown>;
  quarantined: QuarantineEntry[];
  /** Sections over the derivation cap: published UNCHECKED. Never silent — the caller names each one. */
  notJudged: string[];
}

/**
 * The date each KEPT section was actually written. A kept section is the PREVIOUSLY published
 * paragraph, so stamping it with today's generatedAt would make old prose read as fresh — and the
 * profile decides from that date whether the political paragraph predates its FEC record (R-077).
 * Chains: a section kept twice keeps its ORIGINAL date, never the date of the run that kept it.
 */
export function preservedSectionDates(
  published: Record<string, unknown> | null | undefined,
  quarantined: readonly QuarantineEntry[],
): Record<string, string> {
  const prior = (published?.sectionGeneratedAt as Record<string, string> | undefined) ?? {};
  const out: Record<string, string> = {};
  for (const q of quarantined) {
    if (q.kept !== "previous") continue;
    const writtenAt = prior[q.section] ?? (typeof published?.generatedAt === "string" ? published.generatedAt : null);
    if (writtenAt) out[q.section] = writtenAt;
  }
  return out;
}

export function applyFigureBlock(
  candidate: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
  sections: readonly string[],
  storedFigures: readonly number[],
): FigureBlockOutcome {
  const summary: Record<string, unknown> = { ...candidate };
  const quarantined: QuarantineEntry[] = [];
  const notJudged: string[] = [];
  for (const section of sections) {
    const text = candidate[section];
    if (typeof text !== "string") continue;
    const verdict = findBlockingFigureDisagreements(text, storedFigures);
    if (verdict.refused) {
      notJudged.push(section);
      continue;
    }
    if (verdict.disagreements.length === 0) continue;
    const published = previous?.[section];
    const kept = typeof published === "string" && published.trim() ? "previous" : "withheld";
    if (kept === "previous") summary[section] = published;
    else delete summary[section];
    quarantined.push({ section, candidate: text, disagreements: verdict.disagreements, kept });
  }
  return { summary, quarantined, notJudged };
}
