/**
 * The leaderboard's order, as a pure function so BOTH sort directions can be tested without a
 * browser (B-070, 2026-10-02).
 *
 * Graded entries come first, sorted by score in the chosen direction. The not graded — a null
 * score, because the API serves none for a person with no giving record on file — follow, by
 * name, in BOTH directions. "Worst first" must never lead with people we hold no giving data
 * on: that would rank an absence of evidence as the worst record on the board.
 */
export interface OrderableEntry {
  person: { name: string };
  pbs: string | null;
}

export type SortDir = "desc" | "asc";

export function isGradedEntry(e: OrderableEntry): boolean {
  return e.pbs != null && Number.isFinite(Number(e.pbs));
}

export function orderLeaderboard<T extends OrderableEntry>(entries: readonly T[], sortDir: SortDir): T[] {
  const graded = entries
    .filter(isGradedEntry)
    .sort((a, b) => (sortDir === "desc" ? Number(b.pbs) - Number(a.pbs) : Number(a.pbs) - Number(b.pbs)));
  const notGraded = entries
    .filter((e) => !isGradedEntry(e))
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  return [...graded, ...notGraded];
}
