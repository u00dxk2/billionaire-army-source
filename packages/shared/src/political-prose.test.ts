import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency } from "./format-currency";
import {
  frozenPoliticalFigure,
  politicalProseFigures,
  repairPoliticalProse,
} from "./political-prose";

/**
 * The 16 cards measured on prod 2026-09-26 (served feed + a READ-ONLY database read that night):
 * frozen chip = what the curator wrote beside the summary; live = today's `fec_contributions`
 * total, which the served chip and the profile already show. The POLITICAL CLAUSE of each sentence
 * is the card's own, verbatim; some leading/trailing clauses were abbreviated or added as context.
 */
const MEASURED: Array<{ id: string; frozen: string; live: number; sentence: string }> = [
  { id: "5f5ad59f", frozen: "$711.59 in political donations", live: 1202.0399999999995, sentence: "Scott has an estimated net worth of $59.4 billion and a giving grade of A (92 of 100), while her recorded political donations total $711.59." },
  { id: "16087e43", frozen: "$711.5900000000003 in political donations", live: 1202.0399999999995, sentence: "Scott’s listed political donations total about $712." },
  { id: "0f34d0d4", frozen: "$711.5900000000003 in political donations", live: 1202.0399999999995, sentence: "Meanwhile, her reported federal political donations total about $712." },
  { id: "6650f2cf", frozen: "$1.4M in political donations", live: 843035.0000000002, sentence: "Her inherited wealth is listed at roughly $7.0 billion; associated political donations total about $1.4 million." },
  { id: "c6e4d15d", frozen: "$3K in political donations", live: 53191.409999999996, sentence: "Larry Ellison, whose wealth is estimated at $62.5 billion, is central to the family’s media-financing power; his recorded federal political donations total about $3,000." },
  { id: "7a7d2a73", frozen: "$17K in political donations", live: 3664.55, sentence: "Fish is worth about $3.6 billion, while available FEC records show roughly $17,000 in political donations; the firm is private." },
  { id: "87665b16", frozen: "$8K in political donations", live: 15027, sentence: "His foundation reports roughly $7 million in assets, while FEC records list about $8,000 in political donations." },
  { id: "7be2ac93", frozen: "$311K in political donations", live: 1880904.69, sentence: "Paulson’s estimated net worth is $9.8 billion, while associated foundation assets total roughly $1.4 billion and political donations total $311,000." },
  { id: "3a96943d", frozen: "$3K in political donations", live: 358918.99, sentence: "Griffin is worth $45 billion; available records list $3,000 in federal political donations and $6 million in foundation assets." },
  { id: "9fa39950", frozen: "$76K in political donations", live: 188135.62, sentence: "Armstrong has an estimated net worth of $12.9 billion and $76,000 in recorded political donations; his pledge is public." },
  { id: "199f1ec3", frozen: "$4.8M in political donations", live: 6702500, sentence: "Penske is worth $3.9 billion; his recorded political donations total $4.8 million, alongside a foundation with roughly $116 million in assets." },
  { id: "6bdaf9b3", frozen: "$139K in political donations", live: 6687748.7299999995, sentence: "Larsen is worth $3 billion; his recorded political donations total $139,000, while his foundation reports roughly $6 million in assets." },
  { id: "d694abc8", frozen: "$10K in political donations", live: 7005.389999999999, sentence: "Dell’s estimated net worth is $37.6 billion, while his reported federal political donations total $10,000." },
  { id: "568da697", frozen: "$706K in political donations", live: 689487.7, sentence: "Simonyi’s estimated net worth is $8.4 billion, and his recorded political donations total about $706,000 — a reminder that even remote work can come with a flight deck." },
  { id: "f36f1051", frozen: "$189.1M in political donations", live: 131450160.46999998, sentence: "Musk’s net worth is estimated at about $270.1B, and his political donations total $189.1M — a reminder that capital markets can be very generous." },
  { id: "6dee0914", frozen: "$6K in political donations", live: 10873.98, sentence: "The couple’s reported political donations total about $6,000, and their foundation holds roughly $1 million in assets." },
];

/** Cards the repair deliberately LEAVES: the clause is about someone else's giving too. */
const SKIPPED_ON_PURPOSE = new Set(["6dee0914"]); // "The couple’s reported political donations…"

test("the couple's card is left byte-identical — a relative's giving is not this person's record", () => {
  const cohen = MEASURED.find((c) => c.id === "6dee0914")!;
  assert.equal(repairPoliticalProse(cohen.sentence, cohen.frozen, cohen.live, 1), cohen.sentence);
});

test("every other measured card: after repair, the prose political figure reads back as the live chip", () => {
  for (const c of MEASURED.filter((m) => !SKIPPED_ON_PURPOSE.has(m.id))) {
    const chip = `${formatCurrency(c.live)} in political donations`;
    const before = politicalProseFigures(c.sentence).map(formatCurrency);
    // The defect is real on every fixture: the chip's figure is absent from the prose before.
    assert.ok(!before.includes(formatCurrency(c.live)), `${c.id} already agreed before repair`);

    const repaired = repairPoliticalProse(c.sentence, c.frozen, c.live, 1);
    const after = politicalProseFigures(repaired).map(formatCurrency);
    assert.ok(after.includes(formatCurrency(c.live)), `${c.id}: "${repaired}" does not state ${chip}`);
    const stale = formatCurrency(frozenPoliticalFigure(c.frozen)!.value);
    assert.ok(!after.includes(stale), `${c.id}: "${repaired}" still states the stale ${stale}`);
  }
});

test("only the political figure changes — net worth, foundation totals and grammar are untouched", () => {
  const griffin = MEASURED.find((c) => c.id === "3a96943d")!;
  assert.equal(
    repairPoliticalProse(griffin.sentence, griffin.frozen, griffin.live, 1),
    "Griffin is worth $45 billion; available records list $359,000 in federal political donations and $6 million in foundation assets.",
  );
  const scott = MEASURED.find((c) => c.id === "5f5ad59f")!;
  assert.equal(
    repairPoliticalProse(scott.sentence, scott.frozen, scott.live, 1),
    "Scott has an estimated net worth of $59.4 billion and a giving grade of A (92 of 100), while her recorded political donations total $1,202.04.",
  );
  const penske = MEASURED.find((c) => c.id === "199f1ec3")!;
  assert.equal(
    repairPoliticalProse(penske.sentence, penske.frozen, penske.live, 1),
    "Penske is worth $3.9 billion; his recorded political donations total $6.7 million, alongside a foundation with roughly $116 million in assets.",
  );
  const paulson = MEASURED.find((c) => c.id === "7be2ac93")!;
  assert.equal(
    repairPoliticalProse(paulson.sentence, paulson.frozen, paulson.live, 1),
    "Paulson’s estimated net worth is $9.8 billion, while associated foundation assets total roughly $1.4 billion and political donations total $1.9 million.",
  );
});

test("a figure that is NOT the frozen total is never rewritten, even in a political sentence", () => {
  // A single contribution quoted from an article is a different claim from the running total.
  const s = "He gave $2,900 to one campaign; his recorded political donations total $3,000.";
  assert.equal(
    repairPoliticalProse(s, "$3K in political donations", 358918.99, 1),
    "He gave $2,900 to one campaign; his recorded political donations total $359,000.",
  );
  // Same figure outside a total-shaped clause stays as written.
  const t = "The gala raised $3,000. His recorded political donations total $3,000.";
  assert.equal(
    repairPoliticalProse(t, "$3K in political donations", 358918.99, 1),
    "The gala raised $3,000. His recorded political donations total $359,000.",
  );
});

// Adversarial review, 2026-09-27: every one of these was rewritten by the first cut, into a false
// specific figure about a named living person. Each must now come back byte-identical.
test("REGRESSION: round figures near the total are not the total", () => {
  const cases: Array<[string, string, number]> = [
    ["His recorded political donations total $4.8 million, alongside a foundation with roughly $5 million in assets.", "$4.8M in political donations", 6702500],
    ["Her political donations total about $1.4 million, including $1 million to a single super PAC.", "$1.4M in political donations", 843035],
    ["His political donations, including a $100,000 gift, reached new highs.", "$139K in political donations", 6687748.73],
    ["He stayed short of the $20,000 cap on political giving.", "$17K in political donations", 3664.55],
    ["Worth $3 billion, his political donations are modest.", "$2.8B in political donations", 1e8],
  ];
  for (const [s, frozen, live] of cases) {
    const out = repairPoliticalProse(s, frozen, live, 1);
    // The first case HAS a real total ($4.8 million) — only that figure may move.
    if (s.includes("$4.8 million")) {
      assert.equal(out, s.replace("$4.8 million", "$6.7 million"));
    } else if (s.includes("total about $1.4 million")) {
      assert.equal(out, s.replace("$1.4 million", "$843,000"));
    } else {
      assert.equal(out, s, s);
    }
  }
});

test("REGRESSION: the total's value used for something else is left alone", () => {
  const frozen = "$3K in political donations";
  for (const s of [
    "His only recorded political donation was a $3,000 check to the Romney campaign.",
    "He attended a $3,000-a-plate political fundraiser.",
    "The apolitical founder's gala raised $3,000.",
    "His political donations total $3,000 — the same as the $3,000 he gave the library.",
    "Unlike her husband, whose political donations total $3,000, she gives nothing.",
    "His family's recorded political donations total $3,000.",
  ]) {
    const out = repairPoliticalProse(s, frozen, 358918.99, 1);
    if (s.startsWith("His political donations total $3,000 —")) {
      assert.equal(out, s.replace("total $3,000", "total $359,000"), s);
    } else {
      assert.equal(out, s, s);
    }
  }
});

test("REGRESSION: a live total under $1,000 never renders as a false zero or a rounded-up K", () => {
  assert.equal(
    repairPoliticalProse("He has $3K in political donations.", "$3K in political donations", 400, 1),
    "He has $400 in political donations.",
  );
  assert.equal(
    repairPoliticalProse("He has $3K in political donations.", "$3K in political donations", 711.59, 1),
    "He has $711.59 in political donations.",
  );
});

test("a sentence that JUDGES the size of the old total is left for regeneration", () => {
  const frozen = "$125K in political donations";
  for (const s of [
    "Schwab has $125,000 in political donations — a modest sum for his fortune.",
    "His reported $125,000 in political donations is small next to his wealth.",
    "He has $125,000 in political donations. That is a tiny share of his giving.",
  ]) {
    assert.equal(repairPoliticalProse(s, frozen, 1524445.15, 1), s, s);
  }
});

test("two stated totals in one text: skipped rather than guessed", () => {
  const s = "His political donations total $3,000. Separately, records list $3,000 in political donations for 2024.";
  assert.equal(repairPoliticalProse(s, "$3K in political donations", 358918.99, 1), s);
});

test("drop on doubt: no edit without one tagged person, a frozen anchor and a live total", () => {
  const c = MEASURED[0];
  assert.equal(repairPoliticalProse(c.sentence, c.frozen, c.live, 2), c.sentence);
  assert.equal(repairPoliticalProse(c.sentence, null, c.live, 1), c.sentence);
  assert.equal(repairPoliticalProse(c.sentence, "no figure here", c.live, 1), c.sentence);
  assert.equal(repairPoliticalProse(c.sentence, c.frozen, null, 1), c.sentence);
  assert.equal(repairPoliticalProse(c.sentence, c.frozen, 0, 1), c.sentence);
  assert.equal(repairPoliticalProse("", c.frozen, c.live, 1), "");
});

test("POSITIVE CONTROL: a card whose frozen and live figures agree is left byte-identical", () => {
  const s = "Musk’s reach comes alongside $131.5 million in recorded political donations, and $539 million in foundation assets.";
  assert.equal(repairPoliticalProse(s, "$131.5M in political donations", 131450160.47, 1), s);
});

test("idempotent: repairing a repaired sentence changes nothing", () => {
  for (const c of MEASURED) {
    const once = repairPoliticalProse(c.sentence, c.frozen, c.live, 1);
    assert.equal(repairPoliticalProse(once, c.frozen, c.live, 1), once, c.id);
  }
});

test("frozenPoliticalFigure reads the curator's chip shapes, including the raw float", () => {
  assert.equal(frozenPoliticalFigure("$711.5900000000003 in political donations")?.value, 711.5900000000003);
  assert.equal(frozenPoliticalFigure("$1.4M in political donations")?.value, 1.4e6);
  assert.equal(frozenPoliticalFigure("$3K in political donations")?.value, 3000);
  assert.equal(frozenPoliticalFigure(null), null);
  assert.equal(frozenPoliticalFigure("$6.0B in foundation assets"), null);
});
