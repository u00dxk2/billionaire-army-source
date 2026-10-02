/**
 * Does a written section state a DOLLAR FIGURE that looks like a mis-transcription of a stored one?
 *
 * ⚠ THIS IS AN INTERIM INSTRUMENT, NOT THE BLOCK. The block (figure-block.ts) is the one place a
 * section may be held back: "only where a section states a dollar figure that disagrees with our
 * stored records. Everywhere else it stays log-only." This single-figure predicate is too weak to be
 * that block on its own (see the reach finding below); a design built on it plus derived sums as
 * typo targets is buildable.
 *
 * WHY IT IS NOT A BLOCK — and read the correction below, because the first version of this
 * paragraph overclaimed. A CORRECT DERIVED SUBTOTAL collides with a typo: two 2024 foundation grants
 * of $669,538 and $20,000 make a true sentence stating $689,538, one digit-edit from the stored
 * $669,538, and this predicate calls that true sentence a lie.
 *
 * ⚠ CORRECTED 2026-09-14 (P4, the orchestrator's catch, then measured). The P3 text here called that
 * collision proof the block was UNREACHABLE BY CONSTRUCTION, because $689,538 is also Michael
 * Jordan's real typo. But those are the same STRING against two DIFFERENT stored records, and
 * whether a figure is DERIVABLE depends on the person's own figures — a thing a predicate can ask.
 * Measured against prod (tmp/subset-sum-test.mjs): treating "equals a sum of 2-3 of this person's
 * stored figures" as AGREEMENT clears that hypothetical AND all six live merged-bucket false
 * positives — at a cost of 17.3% recall (143 of 827 injected real-record typos cleared by
 * coincidental subsets). So a fifth design is REACHABLE WITH A MEASURED TRADEOFF, not ruled out.
 *
 * ⚠ AND THE FINDING AGAINST THIS INSTRUMENT ITSELF: on Jordan's REAL 78-figure record it flags
 * NOTHING for $689,538. 669538 is not stored as a single figure there — only as the sum
 * 364,868 + 304,670 — so the one-edit rule below has no target. THIS INSTRUMENT CANNOT CATCH THE
 * DEFECT IT WAS BUILT FOR, ON THE RECORD IT WAS BUILT FROM. Its positive control uses a synthetic
 * set containing 669538 as a leaf: it proves the FUNCTION, not the REACH. A fifth design needs
 * derived sums as typo TARGETS as well as agreement, and the target-side cost is unmeasured.
 *
 * WHAT IT IS GOOD FOR, and why it ships at all: as a MEASUREMENT, visibly partial. It read 0 of 946
 * judged profiles on 2026-09-14 (948 carry a summary; 2 carry no stored numeric leaf and are silent
 * by construction). Given the reach finding above, that zero is a statement about single-figure
 * transcription errors only — it is NOT evidence that no live figure disagrees with a derived total.
 * A hit means LOOK AT THIS FIGURE, never "this figure is wrong".
 *
 * WHY NOT THE OBVIOUS DESIGN. `party-prose.ts` was wired into a render on 2026-09-11 and three
 * adversarial rounds reproduced THIRTEEN false withholds; a figure-matching withhold rebuilt on
 * 2026-09-13 reproduced three more (recipient-only prose; "1,234 contributions" read as money;
 * "$1 million" read as 1). The one that ended both: FIGURES IN PROSE CARRY NO CONTEXT, so a top
 * recipient's amount is indistinguishable from a party subtotal. Any predicate that has to decide
 * WHICH stored quantity a sentence describes will guess wrong on true paragraphs.
 *
 * SO THIS ONE NEVER DECIDES WHICH QUANTITY A SENTENCE DESCRIBES. It asks a narrower question with
 * no context in it: is this figure a MIS-TRANSCRIPTION of exactly one stored figure? A prose figure
 * that agrees with any stored figure is accounted for and never examined further, whichever
 * quantity it was meant to describe. Only a figure that agrees with NOTHING, yet sits exactly one
 * digit-edit away from exactly ONE stored figure, is a disagreement. That is the class that actually
 * reached a live page: Michael Jordan's section stated $689,538 where the stored record reads
 * $669,538 (fixed 2026-09-12). Two independent real amounts being one keystroke apart, at five or
 * more significant digits, is not a coincidence worth protecting.
 *
 * CONSERVATIVE BY CONSTRUCTION — every doubt resolves to "not a disagreement", because a false
 * block deletes a TRUE section about a named person:
 *   1. Agreement is generous: within $1 (cents and float noise), OR a clean rounding of a stored
 *      figure to any power of ten ($669,540 and $670,000 both agree with 669538).
 *   2. Both figures need >= 5 SIGNIFICANT digits. Round amounts ($200,000), years (2025), counts
 *      (466) and scaled headlines ($26.3B = 263 significant digits) can never qualify, so they can
 *      never be read as a typo of anything.
 *   3. Same digit length only. An inserted or dropped digit changes magnitude tenfold and is a
 *      different, ambiguous error — left alone.
 *   4. Exactly one candidate. A figure one edit from two stored figures names neither; left alone.
 *
 * KNOWN CEILING, stated so nobody reads a clean result as proof: recall is LOW on purpose. A figure
 * that is wrong by more than one digit, wrong in magnitude, or a fabricated amount with no stored
 * neighbour is NOT caught here. This catches transcription errors of stored figures and nothing
 * else — which is the whole of what the ruling authorised a block to do.
 */
import { proseAmounts } from "./party-prose";

/** Minimum significant digits on BOTH sides before a figure can be read as a typo of another. */
export const MIN_SIGNIFICANT_DIGITS = 5;

/**
 * Every figure written WITH A DOLLAR SIGN, parsed by `proseAmounts` — the one shared tokenizer.
 *
 * Narrower than `proseAmounts` on purpose, and not a fork of it: that function also reads a
 * thousands-separated figure as money, which is right for measuring party sums and wrong for a
 * block. "12,345 contributions" is a count, and "1,234 contributions" read as money was one of the
 * three false withholds reproduced against the 2026-09-13 design. The ruling says DOLLAR figure, so
 * only a figure a reader sees as dollars is eligible to delete a section.
 */
export function dollarAmounts(text: string, { keepAmbiguous = false }: { keepAmbiguous?: boolean } = {}): number[] {
  /* ATOMIC, and both halves of that were reproduced defects (adversarial review 2026-09-14).
     A permissive character class let "$10, 12,345 grants" run past the dollar figure and emit the
     COUNT 12345 as a second token — re-creating the very shape the paragraph above says is out of
     scope. And a SCALED figure must be dropped, not truncated: "$12,345 million" is $12.345B, and
     reading it as 12345 made a correct figure collide with a stored 12,346. Strict grouping, and a
     scale word immediately after disqualifies the token rather than silently rescaling it.
     Review 2026-09-15, once this fed a DELETING block: a "B" suffix was missing, and a figure whose
     scale is AMBIGUOUS is skipped — one opening a scaled range ("$89,538–$90,000K", "$10-12 million")
     or with a scale word close after it ("between $12,345 and $12,350 million"). THAT SKIP IS ONLY SAFE
     ON THE PROSE SIDE. This parser also reads STORED figures, and a stored figure dropped from the
     record is what deletes a true section ("$89,538 to 1 million children", round 3) — so the stored
     side passes `keepAmbiguous`. */
  const TOKEN = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g;
  const SCALED = /^\s*(?:million|billion|trillion|bn|m\b|b\b|k\b|thousand)/i;
  const OPENS_SCALED_RANGE = /^\s*(?:[-–—]|to\b)\s*\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:millions?|billions?|trillions?|thousands?|bn|[mbk])\b/i;
  // ponytail: a 40-character window, not a range grammar. It skips some real prose figures (recall)
  // and never keeps an ambiguous one; a grammar is the upgrade if the recall cost shows in the probe.
  const SCALE_NEARBY = /^[\s\S]{0,40}?\b(?:millions?|billions?|trillions?|thousands?|bn)\b/i;
  const out: number[] = [];
  for (let m = TOKEN.exec(text); m !== null; m = TOKEN.exec(text)) {
    const rest = text.slice(m.index + m[0].length);
    if (SCALED.test(rest)) continue;
    if (!keepAmbiguous && (OPENS_SCALED_RANGE.test(rest) || SCALE_NEARBY.test(rest))) continue;
    out.push(...proseAmounts(m[0]));
  }
  return out;
}

/** Whole-dollar digit string, sign dropped. */
function dollarDigits(value: number): string {
  return String(Math.round(Math.abs(value)));
}

/** Significant digits: the whole-dollar digits with trailing zeros removed. 669538 → 6, 200000 → 1. */
export function significantDigits(value: number): number {
  return dollarDigits(value).replace(/0+$/, "").length;
}

/** True when `prose` is `stored` rounded to some power of ten (10^0 … 10^digits). */
function isRoundingOf(prose: number, stored: number): boolean {
  const target = Math.round(Math.abs(prose));
  const base = Math.abs(stored);
  const len = dollarDigits(stored).length;
  for (let k = 0; k <= len; k++) {
    const unit = 10 ** k;
    if (Math.round(base / unit) * unit === target) return true;
  }
  return false;
}

/** A prose figure agrees with a stored one when it is within $1 of it or a clean rounding of it. */
export function figureAgrees(prose: number, stored: number): boolean {
  if (Math.abs(Math.abs(prose) - Math.abs(stored)) < 1) return true;
  return isRoundingOf(prose, stored);
}

/**
 * Optimal-string-alignment distance === 1 between two EQUAL-LENGTH digit strings: exactly one
 * substituted digit, or one pair of adjacent digits swapped. Equal length is required by the caller.
 */
function oneDigitEdit(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  if (diff.length === 1) return true;
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

export interface FigureDisagreement {
  /** The figure the section states. */
  stated: number;
  /** The one stored figure it is a mis-transcription of. */
  stored: number;
}

/**
 * Every dollar figure in `text` that disagrees with `storedFigures`, per the rules above. Empty means
 * nothing to block. `storedFigures` is every numeric leaf of the facts the section was written from.
 */
export function findFigureDisagreements(
  text: string | null | undefined,
  storedFigures: readonly number[],
): FigureDisagreement[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const stored = storedFigures.filter((n) => Number.isFinite(n));
  if (stored.length === 0) return [];

  const out: FigureDisagreement[] = [];
  for (const stated of dollarAmounts(text)) {
    if (stored.some((s) => figureAgrees(stated, s))) continue;
    if (significantDigits(stated) < MIN_SIGNIFICANT_DIGITS) continue;

    const statedDigits = dollarDigits(stated);
    const candidates = stored.filter(
      (s) =>
        significantDigits(s) >= MIN_SIGNIFICANT_DIGITS &&
        oneDigitEdit(statedDigits, dollarDigits(s)),
    );
    // A figure one edit from two DIFFERENT stored figures names neither of them.
    const distinct = [...new Set(candidates.map((s) => Math.round(Math.abs(s))))];
    if (distinct.length === 1) out.push({ stated, stored: candidates[0] });
  }
  return out;
}

/**
 * The figures a summary was WRITTEN FROM — the only correct comparison set, and getting this wrong
 * is what a live preview caught on 2026-09-14 before this predicate was allowed to block anything.
 *
 * MEASURED: against RAW stored leaves alone the predicate flagged 6 sections of 946 judged profiles
 * and ALL SIX WERE FALSE — every one the merged "Unknown" party bucket. `fec.ts` stores raw FEC
 * codes, so a record carries `UNK: 1000` and `Unknown: 10334174.26` as separate keys, and B-038's
 * write-path half hands the model those buckets MERGED (`labelFecMoneyForPrompt` →
 * `normalizePartyBreakdown`). Correct prose therefore states $10,335,174.26 — a figure that appears
 * as no single raw leaf, and which lands exactly one digit-edit from the large member because the
 * small one is round. Jeff Bezos, Stewart Resnick, Stanley Hubbard, Brad Kelley, Chris Larsen and
 * William MacMillan each reconciled to the cent against their own stated total. Nineteen unit tests
 * were green while the predicate was 0 for 6 on live data — B-020's rule, earned again.
 *
 * So the set is the union of: every numeric leaf (bare numbers like `grantsPaid`, which the prompt
 * carries unshaped), and every `$`-figure in the SHAPED value's JSON (`exactUsd` renders merged
 * buckets and totals as `"$10,335,174.26"`). `count` stays a bare number by deliberate design in
 * `summary-fact-collapse.ts`, so counts enter only as leaves and can never reach the dollar side.
 */
export function storedFiguresForSummary(
  rawFactValues: readonly unknown[],
  shapedFactValues: readonly unknown[],
): number[] {
  const out: number[] = [];
  for (const raw of rawFactValues) storedNumericLeaves(raw, out);
  for (const shaped of shapedFactValues) {
    storedNumericLeaves(shaped, out);
    try {
      // keepAmbiguous: the STORED side never drops a figure — see dollarAmounts (review round 3).
      out.push(...dollarAmounts(JSON.stringify(shaped) ?? "", { keepAmbiguous: true }));
    } catch {
      /* a value that will not stringify contributes nothing; the leaves above still stand */
    }
  }
  return out;
}

/** Every finite numeric leaf of a stored fact value, at any depth. Strings (EINs, committee ids) are skipped. */
export function storedNumericLeaves(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number") {
    if (Number.isFinite(value)) into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) storedNumericLeaves(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) storedNumericLeaves(item, into);
  }
  return into;
}
