/**
 * B-068 (2026-09-30): a foundation_990s fact that a person curated by hand from 990-PF officer
 * evidence must survive every later `fetch:990`.
 *
 * The fetcher deletes a person's foundation_990s fact before it re-inserts, and it also deletes it
 * when the name search matches nothing (the B-020 self-heal). Both paths would silently erase a
 * trustee-verified row and could re-attach a same-surname namesake in its place — the exact
 * defect B-067 repaired for 59 people. So a person holding a curated fact is SKIPPED whole: no
 * search, no delete, no insert.
 *
 * The marker is `estimationMethod: "manual_curated"`, the value business-profile.ts and
 * direct-giving.ts already write for hand-curated facts (mirrors wikidata.ts's curated
 * net_worth guard, which keys on a sourceType other than its own).
 */
export const CURATED_990_METHOD = "manual_curated";

export function isCurated990Fact(fact: { estimationMethod: string | null } | null | undefined): boolean {
  return fact?.estimationMethod === CURATED_990_METHOD;
}

/** The person ids the fetcher must leave alone, from every stored foundation_990s row. */
export function curated990PersonIdsFrom(
  rows: ReadonlyArray<{ personId: string; estimationMethod: string | null }>,
): Set<string> {
  return new Set(rows.filter(isCurated990Fact).map((r) => r.personId));
}
