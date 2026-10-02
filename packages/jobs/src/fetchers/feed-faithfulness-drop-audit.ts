/**
 * B-027 — the pure decision behind judge ACCURACY, which this repo has never measured.
 *
 * We have always logged a judge's rejection RATE. On 2026-08-08 Pass C's rate was 100%
 * and its accuracy was 0%: it dropped 5 of 5 cards for citing figures that were sitting
 * verbatim in the context receipts it had itself been handed, the feed published nothing,
 * and every instrument read green. Proving that took a hand-written probe against prod.
 *
 * This answers ONE question, deterministically and with zero LLM: did the judge call a
 * figure unsupported when that figure was in the context it was given?
 *
 * WHY NOT A VERBATIM STRING MATCH — and this corrects the retro's own first framing.
 * "Flag a reason that quotes a figure appearing verbatim in the receipts" sounds right and
 * would have caught exactly ONE of 2026-08-08's five drops. The receipts are built by the
 * curator's compact formatter ("$76K", "$4.8M") while the GENERATOR expands them into card
 * prose ("$76,000", "$4.8 million") and the judge quotes the card. Byte-equality therefore
 * fails on 4 of 5 real cases. The comparison has to be NUMERIC.
 *
 *   reason: "$76,000 in political donations ... are unsupported"   receipts: "$76K in political donations"
 *
 * ROUNDING IS THE REASON FOR THE TOLERANCE, not sloppiness: the formatter emits one decimal
 * for M/B and none for K, so "$4.8M" is any value in [4.75M, 4.85M). A figure that survived
 * that round-trip cannot be compared with ===.
 *
 * DELIBERATELY ONE-DIRECTIONAL. A hit means "a human should look at this drop", never "this
 * drop was wrong" — the judge may be rejecting the figure's USE (an unrelated receipt bolted
 * onto a story) rather than its existence, which is a real and correct rejection under the
 * prompt's own misleading-juxtaposition rule. The cost shape is what makes a loose check
 * affordable here: a false positive costs one look at a log line, while a miss costs another
 * silent zero-add day. Same asymmetry logic as the display-collapse threshold.
 */

/** A money figure recovered from prose, with the text it came from. */
export interface MoneyFigure {
  raw: string;
  value: number;
}

const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  mm: 1e6,
  b: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};

// $1,234 · $76K · $4.8M · $152.5B · $4.8 million · $293,000
const MONEY_RE = /\$\s?([\d,]+(?:\.\d+)?)\s*(k|m|mm|b|t|thousand|million|billion|trillion)?\b/gi;

/**
 * Every dollar figure in a string, normalized to a number.
 * "~$12.9B" -> 12_900_000_000 · "$76,000" -> 76_000 · "$4.8 million" -> 4_800_000
 */
export function extractMoneyFigures(text: string): MoneyFigure[] {
  if (!text) return [];
  const out: MoneyFigure[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const digits = m[1].replace(/,/g, "");
    const n = Number(digits);
    if (!Number.isFinite(n)) continue;
    const suffix = (m[2] || "").toLowerCase();
    const mult = suffix ? MULTIPLIER[suffix] ?? 1 : 1;
    out.push({ raw: m[0].trim(), value: n * mult });
  }
  return out;
}

/**
 * Tolerance is the formatter's own rounding, not a fudge factor. "$4.8M" carries at most
 * one decimal, so two figures agree when they are within half a unit of the coarser one.
 * 1% covers every band the curator emits (K with no decimal is the loosest at ~0.5%).
 */
export function figuresMatch(a: number, b: number): boolean {
  if (a === b) return true;
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return false;
  return Math.abs(a - b) / larger <= 0.01;
}

export interface DropAuditResult {
  /** true when at least one figure the judge called unsupported was in its own receipts. */
  suspect: boolean;
  /** the figures present in BOTH the drop reason and the context receipts. */
  matched: string[];
}

/**
 * @param reason    the judge's stated drop reason (as logged on the DROP line)
 * @param receipts  the "Provided context receipts" string the judge was handed
 */
export function auditFaithfulnessDrop(reason: string, receipts: string): DropAuditResult {
  const cited = extractMoneyFigures(reason);
  const given = extractMoneyFigures(receipts);
  if (cited.length === 0 || given.length === 0) return { suspect: false, matched: [] };

  const matched: string[] = [];
  for (const c of cited) {
    if (given.some((g) => figuresMatch(c.value, g.value))) matched.push(c.raw);
  }
  return { suspect: matched.length > 0, matched };
}
