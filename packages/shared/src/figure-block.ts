/**
 * THE BLOCK the owner authorised on board card 30cfaf53 (2026-09-12): "Let it block only where a section
 * states a dollar figure that disagrees with our stored records. Everywhere else it stays log-only."
 *
 * This is the DELETING predicate. `figure-disagreement.ts` beside it is the interim single-figure
 * INSTRUMENT that never deletes, and the difference between them is the whole reason this file
 * exists — read that one's docblock first, because this file reuses its tokenizer, its agreement
 * rule and its one-edit rule unchanged, and changes exactly one thing: WHAT COUNTS AS A TARGET.
 *
 * WHY THE SINGLE-FIGURE PREDICATE COULD NOT BE THE BLOCK. On Michael Jordan's real record the live
 * defect was a section stating $689,538 where the record reads $669,538 — and 669,538 is not stored
 * as a single figure at all. It exists only as the sum 364,868 + 304,670. So the single-figure rule
 * has no target to be one edit away FROM, and flags nothing. It fails its own positive control on
 * the record it was built from; `profile-summary-figure-block-wireup.test.ts` pinned exactly that
 * while it was the thing wired in.
 *
 * SO DERIVED SUMS ARE BOTH SIDES, and that symmetry is load-bearing in two opposite directions:
 *   - As AGREEMENT: a figure equal to a sum of 2-3 of the person's own stored figures is accounted
 *     for and never examined. This is what clears a CORRECT subtotal — two 2024 grants of $669,538
 *     and $20,000 make a true sentence stating $689,538 — and what cleared all six live
 *     merged-bucket false alarms (Bezos, Resnick, Hubbard, Kelley, Larsen, MacMillan).
 *   - As TYPO TARGETS: a figure one digit-edit from a derived sum is a disagreement. This is what
 *     reaches Jordan.
 * Agreement is tested FIRST and wins. A figure that is BOTH a valid subtotal and one edit from
 * another target is left alone — the tie always resolves toward publishing.
 *
 * THE COST, MEASURED, NOT ASSUMED — and it must never be stated without this shape. Adding targets
 * buys reach and spends recall, because a rich record carries thousands of derived sums and a typo
 * is then often one edit from SEVERAL of them, which the exactly-one-target rule leaves alone. The
 * numbers live on B-045 and in the report; what belongs here is the direction: this catches roughly
 * half of one-digit transcription errors in 2-3 figure derivations, and blocks essentially no true
 * paragraphs. It is NOT "every wrong figure is caught". A report, card or docstring that says so is
 * making a false claim about our own check.
 *
 * WHAT THIS PREDICATE ACTUALLY DOES — CORRECTED 2026-09-15 after an independent review of the
 * rationale that stood here. The old text said "every doubt here resolves to publish". That is not
 * true, and the accurate sentence is sharper: IT FAVOURS PUBLICATION FOR UNCERTAINTY IT RECOGNISES,
 * AND DELETES FOR UNCERTAINTY IT FAILS TO RECOGNISE. It keeps the section on recognised agreement, on
 * missing / unsupported / insufficient-digit stored figures, on an over-cap record, and on zero or
 * MULTIPLE nearby targets. It deletes on exactly one condition: no recognised agreement AND exactly
 * one qualifying nearby target — which requires no binding to a metric, a period or a claim relation.
 * That is why a true BOUND ("more than $123,450") and a derivation this file cannot enumerate (a
 * four-addend total, a difference, an average) reach the delete arm, and why the faithfulness
 * verifier cannot rescue them: deletion happens first.
 *
 * THE COSTS ARE ASYMMETRIC IN BOTH DIRECTIONS AND THE TRADE IS NOT SETTLED HERE. A false block
 * DELETES A TRUE PARAGRAPH about a named living person on a defamation-adjacent surface; a false
 * publication puts a wrong figure on the page whose thesis is that no claim outruns its citation.
 * B-045's own record has asserted each of those as the worse harm on different days. Neither is a
 * measurement, and THIS FILE DOES NOT RESOLVE IT — what is genuinely missing is the justification
 * connecting that harm judgement to this particular threshold. The over-cap path below still refuses
 * to block rather than falling back to a weaker rule, which is that judgement applied in one place.
 *
 * NOT THE LLM VERDICT. The owner ruled the faithfulness verifier stays log-only. This predicate is
 * deterministic and must never be moved inside the `SUMMARY_FAITHFULNESS_ENFORCE` branch — from the
 * outside the two are indistinguishable, which is why the wire-up test asserts the separation.
 */
import {
  MIN_SIGNIFICANT_DIGITS,
  dollarAmounts,
  figureAgrees,
  significantDigits,
  type FigureDisagreement,
} from "./figure-disagreement";

/**
 * Above this many DISTINCT stored figures, the block refuses to run rather than enumerating sums.
 *
 * MEASURED 2026-09-15 across all 946 prod profiles carrying a summary and >=1 stored figure: the
 * distribution is min 0 / p50 20 / p90 32 / p99 36 / **max 39** (David Tepper, Brian Armstrong,
 * MacKenzie Scott), for 2,059,332 2-3 figure sums across the whole corpus. So this cap is 3x the
 * heaviest live record and binds on ZERO profiles today — it is a tripwire against a record that
 * grows, not a throttle on the one we have.
 *
 * (B-045's note says "Jordan's REAL 78-figure record". That 78 is the RAW leaf count; distinct
 * magnitudes, which is what actually gets enumerated, are far fewer. Both numbers are right about
 * different things.)
 *
 * Over the cap the block REFUSES — see `derivedSums` returning null. It does not fall back to the
 * single-figure rule, because that rule's targets are a strict subset while its agreement set is
 * also a strict subset: the fallback would block MORE on a record we understand LESS.
 */
export const MAX_FIGURES_FOR_DERIVATION = 120;

/** Distinct whole-dollar magnitudes — the atoms both the agreement set and the target set are built from. */
function distinctMagnitudes(stored: readonly number[]): number[] {
  const out = new Set<number>();
  for (const n of stored) {
    if (!Number.isFinite(n)) continue;
    const m = Math.round(Math.abs(n));
    if (m >= 1) out.add(m);
  }
  return [...out];
}

/**
 * Every distinct sum of 2 or 3 of the person's own stored figures, ASCENDING.
 *
 * `null` means the record is over `MAX_FIGURES_FOR_DERIVATION` and the caller must not block at all.
 * Null is not an empty result: an empty array says "no derivable sums", null says "not judged".
 * Collapsing the two is how a refusal turns into a clean-looking pass.
 */
export function derivedSums(
  stored: readonly number[],
  maxFigures: number = MAX_FIGURES_FOR_DERIVATION,
): number[] | null {
  const atoms = distinctMagnitudes(stored);
  if (atoms.length > maxFigures) return null;
  const sums = new Set<number>();
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      sums.add(atoms[i] + atoms[j]);
      for (let k = j + 1; k < atoms.length; k++) sums.add(atoms[i] + atoms[j] + atoms[k]);
    }
  }
  return [...sums].sort((a, b) => a - b);
}

/** Is any value of the ASCENDING array within [lo, hi]? Binary search — the arrays run to ~10k entries. */
function anyInRange(ascending: readonly number[], lo: number, hi: number): boolean {
  let left = 0;
  let right = ascending.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (ascending[mid] < lo) left = mid + 1;
    else right = mid;
  }
  return left < ascending.length && ascending[left] <= hi;
}

/**
 * Does `prose` agree with ANY derived sum — within $1, or as a clean rounding of one?
 *
 * The rounding half is range-queried rather than tested sum-by-sum ON PURPOSE. `figureAgrees` is
 * O(digits) per candidate, and a p90 record carries ~5,456 sums; running it over every sum for every
 * prose figure in every section is ~10^8 operations per corpus pass, which would have made the block
 * too slow to preview against prod — and a block nobody previews against prod is the exact mistake
 * B-020 and this row's own history are about. Same predicate, asked from the other side: a figure
 * `prose` is a rounding of `stored` at unit u iff `stored` lies in [prose - u/2, prose + u/2).
 */
function agreesWithAnySum(prose: number, sumsAscending: readonly number[]): boolean {
  const target = Math.round(Math.abs(prose));
  if (anyInRange(sumsAscending, target - 1, target + 1)) return true;
  const digits = String(target).length;
  for (let k = 1; k <= digits; k++) {
    const unit = 10 ** k;
    if (target % unit !== 0) continue; // `prose` is only a rounding AT unit u if it is a multiple of u
    if (anyInRange(sumsAscending, target - unit / 2, target + unit / 2 - 1)) return true;
  }
  return false;
}

/**
 * Optimal-string-alignment distance === 1 between EQUAL-LENGTH digit strings: one substituted digit,
 * or one adjacent transposition. A local copy of `figure-disagreement`'s rule, which is not exported.
 * Kept byte-identical in behaviour and pinned by a test that runs both predicates over the same pairs.
 */
function oneDigitEdit(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  if (diff.length === 1) return true;
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/** A blocking disagreement, plus which side of the target set reached it. */
export interface BlockingFigureDisagreement extends FigureDisagreement {
  /** `stored` — one edit from a single stored figure. `derived` — one edit from a sum of 2-3 of them. */
  via: "stored" | "derived";
}

/** What the block decided about one section. `refused` means the record was over the cap and NOTHING was judged. */
export interface FigureBlockVerdict {
  disagreements: BlockingFigureDisagreement[];
  refused: boolean;
}

/**
 * The AGREEMENT side's sums — deliberately WIDER than `derivedSums`, which stays the TARGET side.
 * Adversarial review 2026-09-15 reproduced two true sections the magnitude-only set deleted:
 *   - two EQUAL grants of $344,769 make a true $689,538, but distinct atoms drop the repeat;
 *   - a refund of -$23,456 nets $669,538 to a true $646,082, but magnitudes drop the sign.
 * So a figure may repeat (every figure already repeats in `storedFiguresForSummary` — raw leaf, shaped
 * leaf, shaped string — so a multiplicity count would allow it anyway) and a negative stays signed,
 * ALONGSIDE its magnitude so this set never shrinks below the measured one. Widening this side can
 * only publish more.
 */
function agreementSums(stored: readonly number[]): number[] {
  const atoms = new Set<number>();
  for (const n of stored) {
    if (!Number.isFinite(n)) continue;
    // Magnitude rounds from |n|, never |round(n)|: they differ at a negative half-dollar, and that
    // made this set NARROWER than derivedSums (review round 2: -12345.5). The caller also checks both.
    const signed = Math.round(n);
    const magnitude = Math.round(Math.abs(n));
    if (signed !== 0) atoms.add(signed);
    if (magnitude !== 0) atoms.add(magnitude);
  }
  const a = [...atoms];
  const sums = new Set<number>();
  for (let i = 0; i < a.length; i++) {
    for (let j = i; j < a.length; j++) {
      sums.add(Math.abs(a[i] + a[j]));
      for (let k = j; k < a.length; k++) sums.add(Math.abs(a[i] + a[j] + a[k]));
    }
  }
  return [...sums].sort((x, y) => x - y);
}

/**
 * The deleting predicate. A dollar figure in `text` blocks the section when ALL of these hold:
 *   1. it agrees with NO stored figure and NO 2-3 figure sum — signed, repeats allowed (agreement is
 *      generous and wins ties);
 *   2. it carries >= 5 significant digits, so round amounts, years and counts can never qualify;
 *   3. it is one digit-edit, at equal digit length, from EXACTLY ONE distinct target among the
 *      person's stored figures and their 2-3 figure sums.
 *
 * `refused: true` (over the cap) always comes with an empty list, and the caller must publish.
 */
export function findBlockingFigureDisagreements(
  text: string | null | undefined,
  storedFigures: readonly number[],
  maxFigures: number = MAX_FIGURES_FOR_DERIVATION,
): FigureBlockVerdict {
  if (typeof text !== "string" || !text.trim()) return { disagreements: [], refused: false };
  const stored = storedFigures.filter((n) => Number.isFinite(n));
  if (stored.length === 0) return { disagreements: [], refused: false };

  const sums = derivedSums(stored, maxFigures);
  if (sums === null) return { disagreements: [], refused: true };

  const storedMagnitudes = distinctMagnitudes(stored);
  const eligibleStored = storedMagnitudes.filter((s) => significantDigits(s) >= MIN_SIGNIFICANT_DIGITS);
  const eligibleSums = sums.filter((s) => significantDigits(s) >= MIN_SIGNIFICANT_DIGITS);

  const agreement = agreementSums(stored);

  const out: BlockingFigureDisagreement[] = [];
  for (const stated of dollarAmounts(text)) {
    if (agreesWithRecord(stated, stored, sums, agreement)) continue;
    if (significantDigits(stated) < MIN_SIGNIFICANT_DIGITS) continue;

    const statedDigits = String(Math.round(Math.abs(stated)));
    const hits = new Map<number, "stored" | "derived">();
    for (const s of eligibleStored) {
      if (oneDigitEdit(statedDigits, String(s))) hits.set(s, "stored");
    }
    for (const s of eligibleSums) {
      if (hits.has(s)) continue; // the same magnitude reachable both ways is ONE target, not two
      if (oneDigitEdit(statedDigits, String(s))) hits.set(s, "derived");
    }
    // One edit from two DIFFERENT targets names neither of them.
    if (hits.size !== 1) continue;
    const [[target, via]] = [...hits];
    out.push({ stated, stored: target, via });
  }
  return { disagreements: out, refused: false };
}

/** The block's WHOLE agreement rule. Both sum sets are asked, so agreement can never be narrower than the measured one. */
function agreesWithRecord(
  stated: number,
  stored: readonly number[],
  sums: readonly number[],
  agreement: readonly number[],
): boolean {
  return stored.some((s) => figureAgrees(stated, s)) || agreesWithAnySum(stated, sums) || agreesWithAnySum(stated, agreement);
}

/**
 * Would the block PUBLISH `stated` as agreeing with this record? Exported for measurement, so a recall
 * probe excludes exactly what the block publishes on purpose — review round 2 found the probe's own
 * copy of the rule had drifted narrower, counting intended agreement as misses. `null` = over the cap.
 */
export function figureAgreesWithRecord(
  stated: number,
  storedFigures: readonly number[],
  maxFigures: number = MAX_FIGURES_FOR_DERIVATION,
): boolean | null {
  const stored = storedFigures.filter((n) => Number.isFinite(n));
  const sums = derivedSums(stored, maxFigures);
  if (sums === null) return null;
  return agreesWithRecord(stated, stored, sums, agreementSums(stored));
}
