# Public Benefit Score (PBS) — Methodology

*Version 2 (`PBS_VERSION = "v2"` in `packages/shared/src/pbs.ts`). This document describes the code in this repository. Where the two disagree, the code is what runs. Population counts below are dated snapshots of the production dataset, labelled as such; this repository does not contain that dataset, so they cannot be reproduced from it and will differ on a fresh install.*

## What it is

The Public Benefit Score is a 0–100 numeric proxy built from public records. It combines how much a person gives relative to their wealth, how much they give in absolute terms, whether they have signed The Giving Pledge, and how much public information is held about them. It is a proxy, not an objective measure of public benefit.

The scorer derives its inputs from stored facts and person fields, excluding summary-quarantine facts. In the arithmetic, missing giving data counts as zero giving. A Giving Pledge badge or fact is accepted as given. Generated summaries and a profile image count toward information coverage. For a graded person with a stored score, the profile page shows philanthropy and transparency as rounded percentages, with their weights of 65% and 35%. It does not show every sub-term of the calculation.

## Not graded

The batch scorer computes and stores a score for each person it processes, whether or not giving data exists. That score is not served for everyone. A person who holds neither a `total_giving` fact nor a `foundation_990s` fact is **not graded** (`gradeStatus()` in `packages/shared/src/pbs-evidence.ts`). For that person the API routes that serve a score return none (`packages/api/src/grade-status.ts`), and the pages print "Not graded" in place of a letter and a number. Among the entries the leaderboard returns, not-graded people follow graded people, ordered by name and without a rank.

The reason is in the formula below. When extracted annual giving is zero, philanthropy equals its pledge term, so before rounding the score is `9.75 × pledge + 35 × min((distinct counted fact types + 1 if a profile image exists) ÷ 8, 1)`: a pledge flag plus a measure of how much data has been collected about the person. A Giving Pledge badge or fact alone does not make a person graded. A person who holds a giving fact that reports no giving stays graded.

Feed cards follow the same rule. A card that tags a not-graded person carries no score, and if its stored summary mentions the score by name the summary is not served (`withholdScoreProse()` in `packages/shared/src/score-vocabulary.ts`). That check looks for the score's name; it does not detect a grade stated without it.

## Why v2 replaced v1

*This section is history. The history of this repository starts after v1, so neither v1's code nor its data is here to check these statements against.*

v1 weighted five components, three of which were hardcoded constants: Goal Impact (30%, always 0), Low Controversy (15%, always 0.7) and Community Approval (10%, always 0.5). That pulled every score toward the middle. v1 also stored scores on a 0–1 scale while the grade bands checked a 0–100 scale, so every person graded F.

v2 drops the constant components, scores from the two signals that have data behind them, reweights them to sum to 100%, and puts the score on a 0–100 scale.

## The signals

| Signal | Coverage (production snapshot, 2026-06-16, 1,142 people) | Used as |
| --- | --- | --- |
| Net worth | 100% | denominator for generosity |
| Foundation 990 giving figure (see below) | 73% (829 of 1,142) | philanthropy |
| Documented direct giving (curated, cited list) | 7 curated entries | philanthropy — annualized; generosity uses the larger of this and the 990 figure |
| Foundation 990 assets | 74% | not a numeric input to philanthropy (a foundation fact still adds a fact type to transparency) |
| The Giving Pledge | ~10% (112, after import) | philanthropy, at 15% of that component |
| Distinct counted fact types held, plus 1 for a profile image | counted per person; the term reaches its maximum at 8 | transparency |
| Goal adoption, controversy, community votes | none | not scored |

## The formula

**PBS = 100 × (0.65 × Philanthropy + 0.35 × Transparency)**, rounded to two decimals.

### Philanthropy (65%)

`0.15 × pledge + 0.65 × generosity + 0.2 × scale`, clamped to [0, 1].

**Annual giving** is `max(990 figure, annualized direct giving)`. The larger input is used; the two are never added.

- **The 990 figure** comes from foundation filings matched to the person (up to three foundations). For each, the fetcher takes the latest filing's exempt-purpose expenses (`totexpnsexempt`) and falls back to total functional expenses (`totfuncexpns`) when that field is missing or zero (`packages/jobs/src/fetchers/propublica-990.ts`). It is an expense-derived figure, not a count of grants paid: operating and administrative expenses can count, and a foundation reporting zero exempt-purpose expenses is credited with its total expenses. Foundation assets are not part of the arithmetic, so assets alone do not raise philanthropy.
- **Annualized direct giving** comes from the curated list in `packages/jobs/src/fetchers/direct-giving-data.ts`: cumulative giving ÷ max(1, 2026 − start year), unless the entry sets a positive `annualUsdOverride`, which is then used instead.

The three terms:

- **generosity**: `clamp(log10(1 + (giving / net worth) × 5000) / 3, 0, 1)`. Zero when giving or net worth is missing or zero.
- **scale**: `clamp((log10(giving) − 6) / 4, 0, 1)`, so $1M → 0 and $10B → 1. Zero when giving is zero.
- **pledge**: 1 when the person's `givingPledge` badge is true or they hold a `giving_pledge` fact, otherwise 0. The pledge is a stated intention, so it carries only 15% of philanthropy.

### Transparency (35%)

`clamp((distinct counted fact types + 1 if a profile image exists) / 8, 0, 1)`.

This counts distinct fact **types**, not distinct sources: two counted facts of different types taken from the same URL count twice, and a generated summary counts as a type. Facts holding quarantined summary text are excluded.

**An FEC contributions fact matched by name alone is not counted.** The fetcher uses contributor name as its only person-identifying criterion, with no employer, occupation or state check (`packages/jobs/src/fetchers/fec.ts`), so a stored record may include contributions from a different person with the same name. When fact types are counted, a `fec_contributions` fact is skipped unless its value carries its own `employerVerifiedCount` that is a whole number of at least 1; when the fact also has a numeric `count`, the verified number must not exceed it (`fecFactCountsTowardScore()` in `packages/shared/src/fec-attribution.ts`, applied in `packages/jobs/src/pbs-signals.ts`). That field is meant to record how many of the fact's contributions also matched the person's own company; the check trusts the stored number and does not verify the match itself. No production ingestion code here populates the field (only test fixtures set it), so a fact written by the current FEC fetcher does not count. The skip affects only this count. The profile still shows the record with a name-match warning, unless `isFecRecordImpossible()` withholds it because its earliest contribution predates the person's 18th year. Because the count depends on what the pipeline has collected, transparency partly measures data coverage, not only the person's own disclosure.

## Grade bands

| Grade | Score | Share of population (production snapshot, 2026-06-16) |
| --- | --- | --- |
| A | ≥ 60 | 66 (6%) |
| B | ≥ 45 | 148 (13%) |
| C | ≥ 30 | 384 (34%) |
| D | ≥ 15 | 386 (34%) |
| F | < 15 | 158 (14%) |

The bands were set against that snapshot's score distribution. A later production snapshot, 2026-10-03, taken after name-only FEC facts stopped counting and covering only the 736 graded people: A 41, B 99, C 245, D 331, F 20. A grade depends on all four inputs (generosity, scale, pledge and coverage), not on generosity alone.

## The curated direct-giving list

These are the inputs as encoded in `direct-giving-data.ts` and the annual figure the code derives from each. Scores for named people are not listed here: they also depend on net worth, 990 data and coverage in the production database, which this repository does not contain.

| Person | Encoded figure | Period used | Annual giving as scored |
| --- | --- | --- | --- |
| MacKenzie Scott | $26B via Yield Giving | start year 2019 (assumed; the cited page does not state a start year) | ≈ $3.714B |
| Warren Buffett | $60B | since 2006 | ≈ $3.0B |
| George Soros | $32B to the Open Society Foundations | since 1984 | ≈ $0.762B |
| Mark Zuckerberg | ~$7B (Chan Zuckerberg Initiative) | since 2015 | ≈ $0.636B |
| Michael Bloomberg | $21B+ lifetime | `annualUsdOverride` of $3.7B (2024) | $3.7B |
| Pierre Omidyar | $4B+ (Omidyar Network) | since 2004 | ≈ $0.182B |
| Phil Knight | ≥ $2.7B to OHSU | since 2008 | ≈ $0.15B |

## Limitations

- **Direct giving counts only where a curated figure exists.** Everyone not on the list above is scored on 990 data alone, which understates people who give through LLCs, donor-advised funds or direct gifts. Each entry carries a citation, but not every scoring assumption is established by its citation: MacKenzie Scott's 2019 start year, which drives her annual figure, is not stated on the cited page.
- **The 990 figure is expense-derived.** See the philanthropy section: it can include non-grant expenses, and it falls back to total expenses when exempt-purpose expenses are missing or zero.
- **A donor and the foundation that disburses the gift can both be credited.** Scoring is per person, with no cross-person accounting, so crediting Buffett's giving to Buffett does not lower anyone else's score.
- **Pledge status is only as accurate as the badge and fact data.** The sample rows in `packages/db/src/seed.ts` are for local development and are not verified facts.
- **Transparency is coverage-influenced** (see above).
- **Curated foundation attribution reviews apply only to the production dataset.** `packages/jobs/src/fetchers/foundation-trustee-review.ts` restricts which foundations a reviewed person may be attached to. Its entries are keyed by production person ids, and a fresh install generates new ids, so on a fresh install those reviews match no one and the protections do not apply.
- **Goal impact, controversy and community approval are not scored.** They may be added in a later version if data for them exists.

