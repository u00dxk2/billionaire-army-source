import { and, inArray } from "drizzle-orm";
import { personFacts } from "@ba/db";
import type { Db } from "@ba/db";
import { GIVING_EVIDENCE_FACT_KEYS, gradeStatus } from "@ba/shared";
import type { GradeStatus } from "@ba/shared";

/**
 * NOT GRADED, enforced where the score leaves the building (2026-10-02).
 *
 * The rule lives in `@ba/shared/pbs-evidence.ts` (`gradeStatus`): a person with no giving fact on
 * file is not graded. This module is the ONE place a route asks it, so every route that serves a
 * score serves `null` for that person — and a surface nobody remembered to change shows nothing
 * rather than a letter. The stored score is untouched; this is a serving rule.
 *
 * Kept apart from the routes, and the decision kept pure (`servedScore`), for the reason
 * `admin-allowlist.ts` is: a rule that can make a false claim about a named living person is worth
 * a test, and a route handler needs a database to run.
 */

/** Which of these persons carry a giving fact, i.e. are graded. One query, any number of ids. */
export async function loadGradedIds(db: Db, personIds: readonly string[]): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await db
    .select({ personId: personFacts.personId, factKey: personFacts.factKey })
    .from(personFacts)
    .where(
      and(
        inArray(personFacts.personId, [...personIds]),
        inArray(personFacts.factKey, [...GIVING_EVIDENCE_FACT_KEYS]),
      ),
    );
  const keysById = new Map<string, string[]>();
  for (const r of rows) keysById.set(r.personId, [...(keysById.get(r.personId) ?? []), r.factKey]);
  const graded = new Set<string>();
  for (const [id, keys] of keysById) if (gradeStatus(keys) === "graded") graded.add(id);
  return graded;
}

/**
 * The score a route may serve for one person: the stored one when graded, `null` when not.
 * `gradeStatus` rides alongside so a client can tell "not graded" from "no score computed yet".
 */
export function servedScore<T>(
  personId: string,
  stored: T | null | undefined,
  graded: ReadonlySet<string>,
): { value: T | null; gradeStatus: GradeStatus } {
  if (!graded.has(personId)) return { value: null, gradeStatus: "not_graded" };
  return { value: stored ?? null, gradeStatus: "graded" };
}
