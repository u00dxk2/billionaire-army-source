import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findSelfNarration, summarySelfNarration } from "./summary-self-narration";

// The HAND SPLIT (B-060, 2026-09-25): every candidate sentence from the B-043 regeneration snapshots
// (tmp/b043-regen-summary-snapshot.json + -after.json, 20 persons each), read and classed by hand.
// (a) = the generator narrating its own inputs. Every one must count.
const A_CLASS = [
  "The supplied NewsAPI results include two validated articles published from July 22 to July 27, 2026, both concerning B9 Beverages and Jain's stake or board role.",
  "NewsAPI validated two articles dated August 16–17, 2026, concerning Ergen’s reported MobileX transaction.",
  "Two validated news articles from August 14–15, 2026 reported on federal grants for Amtrak’s Chicago maintenance-facility relocation.",
  "Two validated news articles published August 15–17, 2026 reported on a court case involving Overdeck.",
  "Two validated August 2026 articles reported on the proposed MobileX transaction [NewsAPI].",
  "The provided annual Form 990 tax filings list three organizations named Jain Foundation or Jain Foundation Inc.",
  "The provided 2023 Form 990 records list two foundations named Sanford Foundation [ProPublica 990].",
  "The FEC reports 1,132 contributions overall, but the provided financial figures cover only the sample [FEC].",
  "A SEC EDGAR record in the supplied data identifies Bluegreen Vacations Holding Corp.",
  "The results also show filings for Automatic Data Processing Inc.",
  "EchoStar has 1,004 SEC filings in the provided records, including 670 insider filings [SEC EDGAR].",
  // Found by reading the OLD-prompt sample, which the first vocabulary missed (singular "result").
  "A validated August 4, 2026 news result reported the Joby Aviation–Atoms vertiport partnership [NewsAPI].",
  "The news dataset returned 201 results, with one validated result in the reported date range [NewsAPI].",
  "The search reported 19,111 total results and an average sentiment score of -0.0118.",
];

// (b) = legitimate attribution to a SOURCE, or ordinary English that shares a word. None may count.
// This is the negative control: if one starts failing, NARROW the pattern — never delete the control.
const B_CLASS = [
  "FEC records show 22 contributions totaling $49,200 from October 21, 1996, through December 29, 2025 [FEC].",
  "ProPublica records list three Scott Foundations that reported a combined $4,515,507 in grants paid.",
  "According to SEC filings, he holds a controlling stake in EchoStar.",
  "Recent records include a Schedule 13G, which reports certain beneficial ownership stakes.",
  "In July 2026, The Economic Times reported that Anicut Capital had taken control of his pledged shares [NewsAPI].",
  "[NewsAPI]",
  "He provided $5 million to the University of Washington in 2024.",
  "Meta said the data provided to Cambridge Analytica was obtained improperly.",
  "The election results show a narrow margin in the district.",
  "Quarterly results show a roughly $603 million loss tied to an interest-rate hedging strategy.",
  "Nvidia supplied chips to the lab under the contract.",
  "FEC data shows at least 100 federal contributions; the figures below cover only the 100 most recent records.",
  "The company reported 3 quarterly results in a row above guidance.",
  "Scale AI said it labeled the dataset used to train the model.",
];

describe("B-060 hand split: every (a) sentence counts", () => {
  for (const s of A_CLASS) {
    it(`counts: ${s.slice(0, 60)}…`, () => assert.equal(findSelfNarration(s).length, 1, s));
  }
});

describe("B-060 hand split: no (b) sentence counts (negative control)", () => {
  for (const s of B_CLASS) {
    it(`never counts: ${s.slice(0, 60)}…`, () => assert.deepEqual(findSelfNarration(s), [], s));
  }
});

describe("summarySelfNarration", () => {
  it("reads only the five prose sections and reports each hit with its section", () => {
    const out = summarySelfNarration({
      overview: "Ankur Jain is an entrepreneur [Wikidata].",
      newsDigest: `${A_CLASS[0]} ${B_CLASS[4]}`,
      model: "the supplied data results include validated articles", // metadata, not prose
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].section, "newsDigest");
    assert.equal(out[0].hits.length, 1);
  });
  it("non-objects and empty text read as no hits, never a throw", () => {
    assert.deepEqual(summarySelfNarration(null), []);
    assert.deepEqual(summarySelfNarration("text"), []);
    assert.deepEqual(findSelfNarration(undefined), []);
  });
});
