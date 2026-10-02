/**
 * The ONE currency ladder for user-facing dollar strings.
 *
 * Lived in `packages/web/src/lib/format.ts` and was hand-copied inline into the daily-ten
 * highlight builder (`packages/api/src/routes/persons.ts`). The copy dropped the rounding on
 * its last branch — `` `$${top.amount}` `` instead of a formatted value — so an FEC total
 * under $1,000 reached /today as a raw float: **"WINRED ($835.6400000000001)"**, measured live
 * 2026-08-26 on 3 of 10 daily-ten cards. The profile rendered the same fact as "$835.64",
 * because the profile called this function.
 *
 * FEC amounts are accumulated with `+=` over float contribution rows (`fetchers/fec.ts`), so
 * drift is expected in the DATA. Containing it is the display layer's job, and it can only be
 * one job if there is only one function. Do not re-inline this ladder — that is what broke.
 */
export function formatCurrency(amount: number): string {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  // toLocaleString caps at 3 fraction digits, which is what strips the float tail.
  return `$${amount.toLocaleString("en-US")}`;
}
