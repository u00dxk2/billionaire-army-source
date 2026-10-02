import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  META_COMMENTARY_PATTERNS,
  PROFILE_COMMENTARY_PATTERNS,
  matchMetaCommentary,
  splitSentences,
  stripPipelineCommentary,
  hasPipelineCommentary,
  WRITE_TIME_LEAK_PATTERNS,
  hasWriteTimeLeak,
} from "./meta-commentary";

// --- the control that decides whether this is safe to render through -----------------
// Legitimate sourcing says something TRUE ABOUT THE WORLD. It must survive untouched.
// If any of these ever start failing, the detector has become a false-positive machine
// and the fix is to narrow the pattern, NOT to delete the control.
describe("legitimate sourcing language is never suppressed", () => {
  const LEGIT = [
    "Public records do not disclose the amount.",
    "No 990 filing reports grants for this foundation.",
    "The foundation has not published a grants total.",
    "Federal filings show no itemized contributions.",
    "Foundation filings show $9,747,795 in total grants paid [ProPublica 990].",
    "FEC records show 100 contributions totaling $221,100 [FEC].",
    "The company has not responded to requests for comment.",
    "Wikidata lists no date of death for him.",
  ];

  for (const s of LEGIT) {
    it(`keeps: ${s.slice(0, 52)}`, () => {
      assert.equal(hasPipelineCommentary(s), false);
      assert.equal(stripPipelineCommentary(s), s);
    });
  }
});

// --- observed on the live profile surface, 2026-08-25 -------------------------------
describe("pipeline-referential sentences are dropped (all observed live)", () => {
  const OBSERVED = [
    "The provided data does not include the scholarship amount or the name of the administering organization.",
    "Her wealth is associated with a diversified business background, but the provided data does not include a specific company role or operating business detail.",
    "The provided data identifies Menard's industry as retail.",
    "No additional business details were included in the dataset.",
    "No validated news articles were available in the provided dataset.",
    "GDELT returned 54 total results for John Stanton, but none were validated in the provided dataset.",
    "He was born in 1940 and is identified in the data as an American racing driver.",
    "These headlines are not specific to Elizabeth Johnson based on the provided titles alone.",
  ];

  for (const s of OBSERVED) {
    it(`drops: ${s.slice(0, 52)}`, () => {
      assert.equal(hasPipelineCommentary(s), true);
      assert.equal(stripPipelineCommentary(s), undefined);
    });
  }
});

describe("sentence-level, not word-level", () => {
  it("keeps the good sentence and drops only the plumbing one", () => {
    const input =
      "Julia Koch was born in 1962 and based in New York. Her wealth is associated with a diversified background, but the provided data does not include a specific company role. She has an estimated net worth of ~$81.2B.";
    const out = stripPipelineCommentary(input);
    assert.ok(out, "something should survive");
    assert.ok(out!.includes("born in 1962"), "leading claim kept");
    assert.ok(out!.includes("$81.2B"), "trailing claim kept");
    assert.ok(!out!.includes("provided data"), "plumbing sentence removed");
  });

  it("returns undefined when a section is nothing BUT plumbing, so the caller omits it", () => {
    assert.equal(
      stripPipelineCommentary("No validated news articles were available in the provided dataset."),
      undefined
    );
  });

  it("handles empty / missing input", () => {
    assert.equal(stripPipelineCommentary(undefined), undefined);
    assert.equal(stripPipelineCommentary(""), undefined);
    assert.equal(stripPipelineCommentary("   "), undefined);
  });
});

// --- the trap CLAUDE.md names by name ------------------------------------------------
describe("sentence splitting does not break on abbreviations or decimals", () => {
  it("does not split 'U.S.'", () => {
    assert.deepEqual(splitSentences("Frank Slootman is a U.S. citizen."), [
      "Frank Slootman is a U.S. citizen.",
    ]);
  });

  it("does not split a decimal like $3.0B", () => {
    assert.deepEqual(splitSentences("He is worth $3.0B today."), ["He is worth $3.0B today."]);
  });

  it("a U.S. sentence carrying plumbing still strips cleanly, keeping the rest", () => {
    const out = stripPipelineCommentary(
      "Slootman is a U.S. executive worth $3.0B. The provided data does not include his role."
    );
    assert.equal(out, "Slootman is a U.S. executive worth $3.0B.");
  });

  it("keeps a trailing sentence that has no terminal punctuation", () => {
    assert.equal(
      stripPipelineCommentary("He founded the firm in 1998. It remains private"),
      "He founded the firm in 1998. It remains private"
    );
  });
});

// --- blast-radius separation ---------------------------------------------------------
describe("the FEED matcher stays scoped to feed patterns", () => {
  it("matchMetaCommentary does NOT fire on profile-only phrasing", () => {
    // The purge script DELETES on this answer. Widening it here would silently widen a
    // destructive script's blast radius, which is why the two arrays stay separate.
    assert.deepEqual(matchMetaCommentary("", "No validated news articles were available."), []);
  });

  it("matchMetaCommentary fires on the phrase card 1a1b49a6 shipped (B-056) — and only that phrase", () => {
    // The scan read 0 while this was live, because the phrase lived only in the profile list.
    assert.ok(
      matchMetaCommentary("", "Pritzker's estimated net worth is about $3.9 billion; records in the provided data list $2.4 million in political donations.").length > 0
    );
    // Narrow on purpose: this list deletes. The profile entry's wider forms stay out of it.
    assert.deepEqual(matchMetaCommentary("", "No validated news articles were available in the provided dataset."), []);
    assert.deepEqual(matchMetaCommentary("", "Public records list $2.4 million in political donations."), []);
  });

  it("the B-056 feed pattern records the card it was observed on, and stays narrow", () => {
    const added = META_COMMENTARY_PATTERNS.filter((p) => /provided data/.test(p.re.source));
    assert.equal(added.length, 1);
    assert.match(added[0].seenOn ?? "", /1a1b49a6/);
    // NARROW on purpose: this list is what the purge DELETES on. The wider `the provided data`
    // form matches ordinary privacy-story sentences.
    assert.deepEqual(matchMetaCommentary("", "Meta said the provided data was anonymized before it reached advertisers."), []);
    assert.deepEqual(matchMetaCommentary("", "Palantir said the provided data-sharing agreement with ICE was lawful."), []);
  });

  it("the WRITE-TIME set is feed patterns plus only the flagged profile ones", () => {
    const flagged = PROFILE_COMMENTARY_PATTERNS.filter((p) => p.writeTimeSafe);
    assert.equal(WRITE_TIME_LEAK_PATTERNS.length, META_COMMENTARY_PATTERNS.length + flagged.length);
    // The unflagged profile patterns are the ones that fire on real news sentences.
    assert.equal(hasWriteTimeLeak("Meta fined $5 billion over the data provided to Cambridge Analytica"), false);
    assert.equal(hasWriteTimeLeak("No articles were available to readers after the Post pulled the op-ed"), false);
    // ...while the plumbing sentences they were written for still fire at render time.
    assert.equal(hasPipelineCommentary("No validated news articles were available."), true);
    assert.equal(hasWriteTimeLeak("records in the provided data list $2.4 million in political donations."), true);
    assert.equal(hasWriteTimeLeak("No validated news articles were available in the provided dataset."), true);
  });

  it("matchMetaCommentary still fires on the feed phrasing it always did", () => {
    assert.ok(matchMetaCommentary("", "Public records in the provided context show ...").length > 0);
    assert.ok(matchMetaCommentary("", "...so it lands lower.").length > 0);
  });

  it("every pattern carries a human-readable label", () => {
    for (const p of [...META_COMMENTARY_PATTERNS, ...PROFILE_COMMENTARY_PATTERNS]) {
      assert.ok(p.label && p.label.length > 8, `pattern ${p.re} needs a label`);
    }
  });

  it("every PROFILE pattern records where it was observed (no speculative patterns)", () => {
    for (const p of PROFILE_COMMENTARY_PATTERNS) {
      assert.ok(p.seenOn && p.seenOn.length > 4, `pattern ${p.re} must name the page it was seen on`);
    }
  });
});
