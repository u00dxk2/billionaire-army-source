/**
 * /today's deterministic daily order. It lives outside the route so the seed can be tested, and so a
 * replay reads the SAME function the route runs rather than a copy.
 *
 * THE DEFECT THIS FIXES (found 2026-09-21): the seed was the SUM of the date string's char codes. A sum
 * sees which digits a date contains, never their order, so "2026-09-12", "2026-09-21" and "2026-09-30"
 * shared one seed and served the same ten. 2026 held only 19 distinct seeds, so a "daily" ten that a
 * returning reader comes back for repeated within days. FNV-1a over the string gives each date its own seed.
 */
export function dailySeed(date: string): number {
  let h = 2166136261;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h & 0x7fffffff;
}

/** A seeded Fisher-Yates shuffle (simple LCG) over a COPY of the ids. Unchanged from the route's inline loop. */
export function dailyOrder(ids: readonly string[], seed: number): string[] {
  const out = [...ids];
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
