import { isDeceased } from "@ba/shared";

// Who is ELIGIBLE for /today's ten. Its own module, like daily-ten-order.ts, so the rule can be
// tested without a database.
//
// B-055 (2026-09-27): deceased persons are excluded. /today is framed as today's accountability
// briefing, and a person who has died cannot be held to account today — an unmarked card implies
// they are alive. Their giving record stays true and stays public on the profile, the leaderboard
// and /compare; only this rotation drops them. Measured when shipped: 25 of the 1,037-person pool
// carried a death_year (Barbara Cox Anthony, d. 2007, the oldest), about one day in five.
//
// The exclusion applies to the fewer-than-10 fallback too. That fallback used to re-admit the
// whole unfiltered index, which would have put the deceased straight back.

export interface DailyTenCandidate {
  id: string;
  deathYear: number | null;
}

export const DAILY_TEN_SIZE = 10;

export function dailyTenPool(
  candidates: readonly DailyTenCandidate[],
  scored: ReadonlySet<string>,
  withReceipt: ReadonlySet<string>,
): string[] {
  const living = candidates.filter((c) => !isDeceased(c)).map((c) => c.id);
  // Data-completeness floor: a real PBS score AND at least one sourced receipt fact, so card #1
  // never opens on a "Limited public data" profile.
  const floored = living.filter((id) => scored.has(id) && withReceipt.has(id));
  // Fail-safe: if the floor leaves fewer than 10, fall back to every LIVING approved person so
  // Today's 10 is never short.
  return floored.length >= DAILY_TEN_SIZE ? floored : living;
}
