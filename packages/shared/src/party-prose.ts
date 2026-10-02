/**
 * Does a profile's political PROSE account for every party bucket its own stored FEC fact carries?
 *
 * B-038. `fec.ts` stores the FEC party code verbatim, so the generator is handed sixteen keys for
 * about six parties (`DEM`/`Dem`, `DFL`, `NNE`, `UNK`…). It renders the buckets it recognises and
 * silently drops the rest, so the paragraph's own parts fall short of the total it states one
 * sentence earlier. Measured 2026-09-11 by `npm run check:party-sum`: 50 of 792 judged profiles,
 * gaps running from $518.75 (Alec Gores, one dropped DFL bucket) to $380,190.92 of $699,570.70
 * (David Golub) — over half the record omitted while the stated parts read as the whole story.
 * The STORED DATA is correct and the profile's own bars render every bucket; only the prose drops
 * one, directly above the bars that contradict it.
 *
 * THIS IS THE ONE COPY OF THE PREDICATE. `scripts/check-party-breakdown-sum.mjs` measures the
 * corpus with it and the profile withholds with it. A checker that re-derives the render's rule
 * minus a guard is this lane's recorded way of reporting a number the page never produced
 * (2026-08-31), so neither side re-implements this.
 *
 * IT MATCHES ON AMOUNTS, NEVER ON PARTY WORDS. The prose calls `DEM` "Democrats" / "Democratic" /
 * "Democratic recipients" and `PAC/Other` "PACs or other recipients" / "not coded to a party", so a
 * word list would be a fork of the generator's phrasing and would rot. A dollar amount is the one
 * token both sides must agree on.
 *
 * ⚠ THIS IS AN INSTRUMENT, NOT A RENDER GATE, and that is a dated ruling rather than an oversight.
 * On 2026-09-11 it was wired into the profile to WITHHOLD a paragraph that does not reconcile.
 * Three adversarial rounds reproduced THIRTEEN false withholds — a paragraph stating the merged
 * amount the generator was handed; equivalent money spellings; a bucket equal to the total; one
 * figure spent on two buckets; a refund netted the wrong way; allocation order deciding the verdict
 * from stored key order; and finally the one that ended it: **the figures in prose carry no
 * context, so a top recipient's amount is indistinguishable from a party subtotal.** A predicate
 * that cannot tell those apart must not delete a true paragraph from a live profile. As a
 * MEASUREMENT the same imprecision is affordable — it sizes a defect and its errors are visible in
 * a report — so `check:party-sum` uses it and nothing user-facing does. Re-wiring it into a render
 * means re-running that review and answering the recipient-collision case.
 *
 * KNOWN CEILINGS, all measured 2026-09-11, all in the direction of over-reporting: a figure written
 * in words or scaled ("500 dollars", "about .2 million") is not tokenised; allocation is greedy and
 * first-fit, so an exotic combination of equal amounts can starve a group the paragraph did state;
 * and a top recipient's amount can be allocated to a party bucket.
 *
 * CONSERVATIVE IN THREE WAYS, each of which keeps a true paragraph on the page:
 *   1. It judges only prose that CITES THE STORED TOTAL — prose stating no total makes no
 *      arithmetic claim a reader could catch short.
 *   2. Prose citing the total but NO bucket at all is THIN, not self-contradictory.
 *   3. Fewer than two non-zero buckets: there is nothing to drop.
 * Every one of those returns "not a drop", because withholding a true paragraph costs a reader
 * real information.
 */
import { partyBucketCode } from "./party-breakdown";

/**
 * Render an amount the way the generator's prose does: grouped, decimals only when non-integral.
 * Exported so an instrument PRINTS the same string this file MATCHED — a reporter with its own
 * formatter can name a figure the predicate never looked for.
 */
export function proseAmount(amount: number): string {
  const integral = Math.abs(amount - Math.round(amount)) < 0.005;
  return integral
    ? Math.round(amount).toLocaleString("en-US")
    : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Spaces a model writes between digit groups that are not the ASCII space: NBSP, narrow NBSP, thin. */
const ODD_SPACES = /[   ]/g;

/**
 * Every money figure the prose states, as NUMBERS, with multiplicity.
 *
 * WHY A TOKENISER AND NOT A MATCHER PER BUCKET. The first two versions of this file asked "does
 * this amount appear in the text?" once per bucket, and an adversarial review reproduced SEVEN
 * defects across two rounds against that shape: "$100" matched inside "$100,000"; one "$1,000"
 * occurrence satisfied two different $1,000 buckets; a bucket equal to the total was satisfied by
 * the total's own words. Each fix was a new guard on the same fragile question. Reading the
 * paragraph's figures ONCE into a multiset and then ALLOCATING them answers all of it with one
 * mechanism — the same lesson this lane wrote on 2026-09-10, when nine defects across two surgical
 * designs became zero across a blunt one.
 *
 * A figure counts as money when it is written as money: a `$` prefix, a thousands separator, or
 * exact cents. A bare integer is NOT money here — "93 contributions" and "2025" are not amounts,
 * and reading them as amounts would hand the allocator figures the author never claimed.
 */
export function proseAmounts(text: string): number[] {
  // "1 234" (non-breaking or thin space) is a grouped figure written with the other separator.
  const normalised = text.replace(ODD_SPACES, " ").replace(/(\d) (?=\d{3}\b)/g, "$1,");
  const TOKEN = /\$\s?\d+(?:,\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}\b/g;
  const out: number[] = [];
  for (const match of normalised.match(TOKEN) ?? []) {
    const value = Number(match.replace(/[$,\s]/g, ""));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Take one occurrence of `amount` out of the pool, if it holds one. Cent-tolerant. */
function consume(pool: number[], amount: number): boolean {
  const at = pool.findIndex((v) => Math.abs(v - amount) < 0.005);
  if (at < 0) return false;
  pool.splice(at, 1);
  return true;
}

export type PartyProseVerdict =
  /** No prose, no breakdown, or no usable total — nothing to judge. */
  | "no-data"
  /** Fewer than two non-zero buckets: nothing can be dropped. */
  | "too-few-buckets"
  /** The prose never states the stored total, so it makes no arithmetic claim. */
  | "no-total-cited"
  /** States the total but no bucket at all — thin, not self-contradictory. */
  | "thin"
  /** Every non-zero bucket's amount appears in the prose. */
  | "clean"
  /** States some buckets and omits others: a reader can add them up and come short. */
  | "drops-bucket";

export interface PartyProseReading {
  verdict: PartyProseVerdict;
  /** Buckets whose amount never appears in the prose (empty unless `thin` or `drops-bucket`). */
  missing: { code: string; amount: number }[];
  /** Sum of `missing` — the money a reader cannot find in the paragraph. */
  gap: number;
}

/** The full reading, for an instrument that needs to report WHICH buckets went missing. */
export function readPartyProse(
  prose: string | null | undefined,
  partyBreakdown: Record<string, unknown> | null | undefined,
  totalAmount: number | null | undefined,
): PartyProseReading {
  const none = (verdict: PartyProseVerdict): PartyProseReading => ({ verdict, missing: [], gap: 0 });

  const text = typeof prose === "string" ? prose.trim() : "";
  if (!text || !partyBreakdown || typeof partyBreakdown !== "object") return none("no-data");

  /* GROUP FIRST, by the SAME policy the bars and the generator's input use, and on SIGNED amounts.
     Since B-038's write-path half the model is handed MERGED buckets, so correct new prose says
     "$1,250 to Democrats" where the stored fact still carries DEM 1000 and Dem 250 — and "$750"
     where it carries DEM 1000 and a Dem -250 refund. Merging signed and only THEN dropping
     non-positive groups is what keeps this predicate agreeing with the paragraph the generator was
     asked to write; filtering refunds first made the two disagree (adversarial review, 2026-09-11).
     A group is accounted for when the prose states its merged amount OR every one of its members. */
  const groups = new Map<string, { amount: number; members: number[] }>();
  for (const [rawKey, rawAmount] of Object.entries(partyBreakdown)) {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount)) continue;
    const code = partyBucketCode(rawKey);
    const group = groups.get(code) ?? { amount: 0, members: [] };
    group.amount += amount;
    if (amount > 0) group.members.push(amount);
    groups.set(code, group);
  }

  if (typeof totalAmount !== "number" || !Number.isFinite(totalAmount)) return none("no-data");

  const judgeable = [...groups.entries()]
    .filter(([, g]) => g.amount > 0)
    .map(([code, g]) => ({ code, amount: g.amount, members: g.members }));
  if (judgeable.length < 2) return none("too-few-buckets");

  /* ALLOCATE, never merely match. The paragraph's figures are a multiset and each claim consumes
     one: the total first, then each group. So one "$1,000" cannot satisfy two $1,000 buckets, and a
     bucket that happens to equal the total cannot be satisfied by the total's own words — the two
     shapes that read CLEAN over a real omission before. Merged amount first, then all members,
     because the merged spelling is what a regenerated paragraph states. */
  const pool = proseAmounts(text);
  if (!consume(pool, totalAmount)) return none("no-total-cited");

  const missing: { code: string; amount: number }[] = [];
  for (const group of judgeable) {
    if (consume(pool, group.amount)) continue;
    const trial = [...pool];
    if (group.members.length > 0 && group.members.every((m) => consume(trial, m))) {
      pool.length = 0;
      pool.push(...trial);
      continue;
    }
    missing.push({ code: group.code, amount: group.amount });
  }
  if (missing.length === 0) return none("clean");

  const gap = missing.reduce((sum, b) => sum + b.amount, 0);
  // States the total and NOT ONE bucket: thin, counted apart. Merging it into the drop count
  // overstates B-038 — the defect is specifically a paragraph a reader can add up and catch short,
  // which needs at least one bucket stated.
  if (missing.length === judgeable.length) return { verdict: "thin", missing, gap };

  return { verdict: "drops-bucket", missing, gap };
}

/**
 * The render's question: may this political paragraph be published as it stands?
 * True means the paragraph states some party amounts and omits others.
 */
export function politicalProseDropsBucket(
  prose: string | null | undefined,
  partyBreakdown: Record<string, unknown> | null | undefined,
  totalAmount: number | null | undefined,
): boolean {
  return readPartyProse(prose, partyBreakdown, totalAmount).verdict === "drops-bucket";
}
