/**
 * B-046 — A HAND-APPROVED SECTION SURVIVES REGENERATION.
 *
 * Profile summaries are regenerated in bulk (`generate:summaries`), and the write replaces the whole
 * stored row. Before this, a paragraph corrected by hand on a ruling (Jordan's foundation figure,
 * 2026-09-12; Soros's "since 1984" and Scott's sourced wording, 2026-09-22) had no marker the
 * generator could see, so the next bulk run silently wrote fresh model prose over it. Proven in
 * production 2026-09-16.
 *
 * THE MARKER lives on the stored summary itself (option (a) on the row — one row per person, no
 * join): `approvedSections: { <section>: { by, date, ruling } }`. The generator reads it at the write,
 * KEEPS the published text of every validly-marked section instead of the candidate, and writes the
 * marker FORWARD — a marker that the next write dropped would protect exactly one regeneration.
 *
 * FAILS LOUD, NOT CLEVER. A marker that cannot be honoured (malformed, an unknown section, nothing
 * published to keep) is returned in `ignored` with its reason, never silently dropped and never
 * guessed at, because "the run preserved nothing" and "the run could not read the marker" must not
 * read the same in the log.
 */

export interface SectionApproval {
  /** Who approved it — a person or seat, e.g. "the owner". */
  by: string;
  /** YYYY-MM-DD, the day the approved text was set. */
  date: string;
  /** The ruling it rests on — a board card, bus message or ledger id. */
  ruling: string;
}

export interface ApprovalOutcome {
  /** The candidate's PROSE SECTIONS only, with every preserved section replaced by its published text. */
  summary: Record<string, unknown>;
  preserved: { section: string; approval: SectionApproval }[];
  ignored: { section: string; reason: string }[];
  /** The markers to write forward: exactly the ones honoured this run. */
  approvedSections: Record<string, SectionApproval>;
  /** The ORIGINAL write date of each preserved section, so kept prose never reads as fresh. */
  preservedAt: Record<string, string>;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Why a marker cannot be honoured, or null when it is well-formed. */
export function approvalDefect(marker: unknown): string | null {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return "marker is not an object";
  const m = marker as Record<string, unknown>;
  if (!isNonEmptyString(m.by)) return "marker has no `by`";
  if (!isNonEmptyString(m.date) || !ISO_DAY.test(m.date)) return "marker `date` is not YYYY-MM-DD";
  if (!isNonEmptyString(m.ruling)) return "marker has no `ruling`";
  return null;
}

/**
 * The public shape of a stored fact: a profile summary's approval marker names who approved it and
 * on which internal ruling, so it is stripped before a fact is served. The stored row keeps it —
 * the generator needs it — and every other fact passes through unchanged.
 */
export function withoutApprovalMetadata<T extends { factKey: string; factValue: unknown }>(fact: T): T {
  if (fact.factKey !== "profile_summary") return fact;
  const value = fact.factValue;
  if (!value || typeof value !== "object" || Array.isArray(value) || !("approvedSections" in value)) return fact;
  const { approvedSections: _internal, ...rest } = value as Record<string, unknown>;
  return { ...fact, factValue: rest };
}

export function applyApprovedSections(
  candidate: Record<string, unknown>,
  published: Record<string, unknown> | null | undefined,
  sections: readonly string[],
): ApprovalOutcome {
  // ONLY the prose sections come from the candidate. The candidate is model output: any other key it
  // carries — `approvedSections` above all — would otherwise reach the written row and be trusted as
  // a human approval on the next run (adversarial review, 2026-09-24). Approval metadata is built
  // from the validated STORED markers below and nowhere else.
  const summary: Record<string, unknown> = {};
  for (const section of sections) {
    if (typeof candidate[section] === "string") summary[section] = candidate[section];
  }
  const out: ApprovalOutcome = { summary, preserved: [], ignored: [], approvedSections: {}, preservedAt: {} };

  const raw = published?.approvedSections;
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    out.ignored.push({ section: "*", reason: "approvedSections is not an object" });
    return out;
  }

  const priorDates = (published?.sectionGeneratedAt as Record<string, unknown> | undefined) ?? {};
  for (const [section, marker] of Object.entries(raw as Record<string, unknown>)) {
    if (!sections.includes(section)) {
      out.ignored.push({ section, reason: "not a summary section" });
      continue;
    }
    const defect = approvalDefect(marker);
    if (defect) {
      out.ignored.push({ section, reason: defect });
      continue;
    }
    const text = published?.[section];
    if (!isNonEmptyString(text)) {
      out.ignored.push({ section, reason: "marked, but no published text to keep" });
      continue;
    }
    const approval = marker as SectionApproval;
    summary[section] = text;
    out.preserved.push({ section, approval });
    out.approvedSections[section] = { by: approval.by, date: approval.date, ruling: approval.ruling };
    const writtenAt = priorDates[section] ?? published?.generatedAt;
    if (isNonEmptyString(writtenAt)) out.preservedAt[section] = writtenAt;
  }
  return out;
}
