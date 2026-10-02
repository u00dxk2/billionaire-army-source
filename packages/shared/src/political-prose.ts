import { formatCurrency } from "./format-currency";

/**
 * 2026-09-27 — restate a card's POLITICAL-DONATION TOTAL in its prose at the chip's LIVE figure.
 *
 * THE DEFECT. The curator writes the summary and freezes "$X in political donations" into
 * `contextData.political` in the same pass, from the same `fec_contributions` fact. Both feed routes
 * have rebuilt the CHIP from the live fact since 2026-09-03; the sentence beside it was never touched.
 * When the fact moved, the card contradicted itself about a named living person. Measured 2026-09-26
 * on the served 204: 16 cards, e.g. MacKenzie Scott promoted at #1 reading "$711.59" in prose beside
 * a "$1K" chip and a profile reading $1,202.04; Ken Griffin "$3,000" beside "$359K". Read-only DB
 * check the same night: on all 16 the FROZEN chip equals the prose figure exactly, all 16 tag one
 * person — the prose was written from the frozen chip, and only the live fact moved.
 *
 * WHAT THIS IS AND IS NOT. The ONE source of truth for the figure is the `fec_contributions` fact —
 * the chip and the profile already read it. This makes the sentence read it too. It restates OUR OWN
 * summary of that fact, changes no stored row, and is reversible by reverting one import — the same
 * render-time posture as `repairFoundationProse` and `repairScoreProse` beside it on both routes.
 *
 * DELIBERATELY NARROW (tightened after an adversarial review found a first cut rewriting a foundation
 * total, a single "$3,000 check" and a "$20,000 cap"). A figure is rewritten only when ALL hold:
 * - exactly ONE tagged person, a frozen chip AND a live total in hand;
 * - the figure is written in a TOTAL-SHAPED clause — "$X in (recorded) political donations" or
 *   "political donations total (about) $X" — not merely near the word "political";
 * - it EQUALS the frozen chip: same `formatCurrency` reading, and within the written figure's own
 *   last-digit rounding (so "$2,900" never claims a "$3K" chip, nor "$5 million" a "$4.8M" one);
 * - it is the ONLY such figure in the text, and its sentence names no relative ("her husband's …");
 * - neither its sentence nor the next one JUDGES the size ("a modest …", "close to …") — a judgment
 *   made about the old number is not ours to carry over to a new one;
 * - the rendered result reads back through `formatCurrency` exactly as the live chip.
 * Anything else is left byte-identical — a card the repair skips is no worse than it was.
 */

const PROSE_MONEY_RE =
  /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?)(billion|million|thousand|B|M|K)?\b(?!-)/gi;

const SCALE: Record<string, number> = {
  billion: 1e9,
  b: 1e9,
  million: 1e6,
  m: 1e6,
  thousand: 1e3,
  k: 1e3,
};

const HEDGE = "(?:(?:about|roughly|around|approximately|nearly|some|just|only)\\s+)?";
/** "… political donations total about " immediately BEFORE the figure. */
const TOTAL_BEFORE = new RegExp(
  `\\bpolitical\\s+(?:campaign\\s+)?(?:donations|contributions)\\s+(?:total(?:s|ed)?|of|come\\s+to|came\\s+to|amount(?:s|ed)?\\s+to)\\s+${HEDGE}$`,
  "i",
);
/** " in (recorded|federal …) political donations" immediately AFTER the figure. */
const TOTAL_AFTER =
  /^\s*in\s+(?:(?:recorded|reported|listed|federal|total|known)\s+){0,3}political\s+(?:donations|contributions)\b/i;
/**
 * Words that JUDGE the size of a figure ("a modest", "small next to", "close to", "a large political
 * footprint"). Such a judgment was made about the OLD number and can be false about the new one, so
 * a sentence carrying one — or the sentence right after it — is left for regeneration, not repaired.
 */
const SIZE_JUDGMENT =
  /\b(?:modest|small|smaller|tiny|minor|little|large|larger|sizable|sizeable|huge|massive|big|bigger|significant|close\s+to|compar\w*|than|dwarf\w*|fraction|pale\w*|relative\w*|previously|separately|meager|hefty|substantial|outsized|lopsided|contrast\w*|mere(?:ly)?|only|just)\b/i;
/** A clause about someone else's giving. */
const RELATIVE =
  /\b(?:husband|wife|spouse|partner|son|daughter|father|mother|brother|sister|couple)(?:'s|’s)?\b|\b(?:family|children|household)(?:'s|’s)\s+(?:\w+\s+){0,3}(?:political|donations|contributions)\b/i;

export interface WrittenFigure {
  value: number;
  /** Half of the written figure's LAST-DIGIT place — how far the figure can sit from what it rounds. */
  halfStep: number;
  decimals: number;
}

function readFigure(digits: string, unit: string | undefined): WrittenFigure | null {
  const plain = digits.replace(/,/g, "");
  const n = Number(plain);
  if (!Number.isFinite(n) || n <= 0) return null;
  const scale = unit ? SCALE[unit.toLowerCase()] ?? 1 : 1;
  const decimals = plain.includes(".") ? plain.split(".")[1].length : 0;
  // The literal last digit only. Trailing zeros are NOT read as coarse rounding: "$20,000" is
  // twenty thousand, never "somewhere between 15 and 25 thousand".
  return { value: n * scale, halfStep: (10 ** -decimals * scale) / 2, decimals };
}

/** "$711.5900000000003 in political donations" / "$1.4M in political donations" → the figure. */
export function frozenPoliticalFigure(chip: unknown): WrittenFigure | null {
  if (typeof chip !== "string") return null;
  const m = /^\s*\$\s?([\d,]+(?:\.\d+)?)\s?(B|M|K)?\s+in\s+political donations/i.exec(chip);
  return m ? readFigure(m[1], m[2]) : null;
}

function trimZeroDecimal(s: string): string {
  return s.replace(/\.0(?=\D|$)/, "");
}

/** The live total in the unit and style the author used. */
function inAuthorsStyle(live: number, unit: string | undefined, space: string, written: WrittenFigure): string {
  const long = !!unit && unit.length > 1;
  if (live >= 1e9) return trimZeroDecimal(`$${(live / 1e9).toFixed(1)}`) + (long ? `${space}billion` : unit ? "B" : " billion");
  if (live >= 1e6) return trimZeroDecimal(`$${(live / 1e6).toFixed(1)}`) + (long ? `${space}million` : unit ? "M" : " million");
  // Under $1,000 the chip's own ladder is the only honest rendering — never "$0K", never "$1K".
  if (live < 1e3) return formatCurrency(live);
  const u = unit?.toLowerCase();
  if (u === "k" || u === "thousand") {
    return `$${(live / 1e3).toFixed(0)}${long ? `${space}thousand` : "K"}`;
  }
  // Digits below $1M ("$843,000" reads better than "$0.8 million"), rounded to the thousand the
  // way the chip is — except where the author wrote finer ("$711.59", "$712"), which is kept.
  if (live >= 1e3 && written.value >= 1e3 && (written.decimals === 0 || !!unit)) {
    return `$${(Number((live / 1e3).toFixed(0)) * 1e3).toLocaleString("en-US")}`;
  }
  const d = Math.min(written.decimals, 2);
  return `$${live.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** The sentence holding a figure. Punctuation must be followed by whitespace, so "$1.4" never splits. */
function sentenceAround(text: string, index: number, length: number): string {
  let start = 0;
  for (const m of text.slice(0, index).matchAll(/[.!?]\s+/g)) start = (m.index ?? 0) + m[0].length;
  const after = index + length;
  const endRel = text.slice(after).search(/[.!?](\s|$)/);
  return text.slice(start, endRel < 0 ? text.length : after + endRel + 1);
}

interface TotalFigure {
  index: number;
  whole: string;
  written: WrittenFigure;
  unit: string | undefined;
  space: string;
}

/** Figures written as a political-donation TOTAL: "$X in … political donations" or "… total $X". */
function totalFigures(text: string): TotalFigure[] {
  const out: TotalFigure[] = [];
  for (const m of text.matchAll(PROSE_MONEY_RE)) {
    const index = m.index ?? 0;
    const unit = m[3];
    const bare = unit ? m[0] : m[0].replace(/\s+$/, "");
    const before = text.slice(0, index);
    const afterText = text.slice(index + bare.length);
    if (!TOTAL_BEFORE.test(before) && !TOTAL_AFTER.test(afterText)) continue;
    // A relative anywhere in the SENTENCE ("Unlike her husband, whose political donations total …")
    // — clause bounds would split that name away from the figure it owns.
    if (RELATIVE.test(sentenceAround(text, index, bare.length))) continue;
    const written = readFigure(m[1], unit);
    if (written) out.push({ index, whole: bare, written, unit, space: unit ? m[2] : "" });
  }
  return out;
}

export function repairPoliticalProse(
  text: string,
  frozenChip: unknown,
  liveTotal: number | null | undefined,
  taggedPersonCount: number,
): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (taggedPersonCount !== 1) return text;
  if (liveTotal == null || !Number.isFinite(liveTotal) || liveTotal <= 0) return text;
  const anchor = frozenPoliticalFigure(frozenChip);
  if (!anchor) return text;
  const liveChip = formatCurrency(liveTotal);
  if (formatCurrency(anchor.value) === liveChip) return text;

  const totals = totalFigures(text);
  // One stated total or none: two totals in one summary is a text we cannot read confidently.
  if (totals.length !== 1) return text;
  const [t] = totals;
  const sentence = sentenceAround(text, t.index, t.whole.length);
  const sentenceEnd = text.indexOf(sentence) + sentence.length;
  const nextSentence = text.slice(sentenceEnd).match(/^\s*[^.!?]*[.!?]?/)?.[0] ?? "";
  if (SIZE_JUDGMENT.test(sentence) || SIZE_JUDGMENT.test(nextSentence)) return text;

  const sameReading = formatCurrency(t.written.value) === formatCurrency(anchor.value) || anchor.value < 1e3;
  const withinDigits = Math.abs(t.written.value - anchor.value) <= Math.max(t.written.halfStep, 0.005) * 1.0001;
  if (!sameReading || !withinDigits) return text;

  const rendered = inAuthorsStyle(liveTotal, t.unit, t.space, t.written);
  const back = totalFigures(`political donations total ${rendered}`)[0];
  if (!back || formatCurrency(back.written.value) !== liveChip) return text;

  return text.slice(0, t.index) + rendered + text.slice(t.index + t.whole.length);
}

/**
 * The dollar figures this prose states as a political-donation TOTAL. What a gate or test imports to
 * ask whether the card's prose and its political chip agree, rather than re-deriving the clause rules
 * (AGENTS.md, B-037).
 */
export function politicalProseFigures(text: string): number[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return totalFigures(text).map((t) => t.written.value);
}
