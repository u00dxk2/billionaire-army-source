/**
 * Does this person's federal political spending DWARF their documented charitable giving?
 *
 * WHY THIS EXISTS. `/today`'s receipt hook — the sourced dek that LEADS each card — is picked by a
 * fixed availability ladder: documented giving > parked foundation assets > Giving Pledge >
 * political. It never compares magnitudes, so it leads with whichever number happens to exist
 * rather than with the number that is the story.
 *
 * MEASURED ON THE LIVE DAILY TEN, 2026-09-04: J. Christopher Reyes, net worth ~$13.1B, carries
 * $30.0M in federal political contributions (top recipient SENATE LEADERSHIP FUND, $16.5M) and
 * $23K of foundation grants. The card's lead line read, in full, *"Gave $23K through 3 foundations,
 * per its latest IRS 990."* — the $30M was on the card's chips but not in the sentence a reader
 * actually reads. That is the OPPOSITE of this product's would-tell-a-friend moment: the reader
 * skims a small charity number and moves on, and the receipt that would have landed never gets sent
 * to anyone.
 *
 * THE THRESHOLD IS AN ORDER OF MAGNITUDE, NOT "MORE", and that is the whole calibration. A person
 * who gives $275K and spends $433K on politics is not a story — the numbers are the same size and
 * a card that editorialised about them would be making a claim its own sources do not support. At
 * 10x the contrast is not a judgment call. Calibrated against the live ten on the day it shipped:
 * exactly ONE of ten cards fires (Reyes, ~1,300x) and the other nine stay silent, including the
 * two whose political and charitable figures are within 2x of each other.
 *
 * WHAT THIS IS NOT. It states two sourced numbers side by side; it draws no conclusion. "Gave $23K
 * … — and $30.0M to federal politics" is two facts and a dash. This repo separates facts from
 * commentary by rule, and a hook that said "chose politics over charity" would be commentary about
 * a named living person's motives, which is a claim no filing supports.
 */

/**
 * The ratio at which political spending stops being comparable to charitable giving and starts
 * being the card's actual subject.
 */
export const POLITICAL_DOMINANCE_RATIO = 10;

/**
 * True only when BOTH figures are real and political is at least an order of magnitude larger.
 *
 * ABSENT IS NEVER ZERO here, in both directions. A missing political total must not read as "gives
 * generously by comparison", and a missing giving figure must not read as an infinite ratio — with
 * no charitable number there is nothing to contrast, and the ladder's plain political hook already
 * covers that person correctly. So both sides must be finite and above zero before this can fire.
 *
 * The political input is already B-037-guarded upstream: a record the age test withholds leaves
 * `politicalRaw` at 0 in the route, so a withheld figure cannot reach a card through this path
 * either. That is a property of the CALL SITE, not of this function — do not weaken it there.
 */
export function politicalDominatesGiving(
  givingRaw: number | null | undefined,
  politicalRaw: number | null | undefined,
): boolean {
  if (typeof givingRaw !== "number" || !Number.isFinite(givingRaw) || givingRaw <= 0) return false;
  if (typeof politicalRaw !== "number" || !Number.isFinite(politicalRaw) || politicalRaw <= 0) return false;
  return politicalRaw >= givingRaw * POLITICAL_DOMINANCE_RATIO;
}

/**
 * Does this person's curated DIRECT giving dwarf the foundation grants their 990 shows?
 *
 * The same availability-not-magnitude defect as above, one tier up. The /today ladder puts 990
 * grants first because an IRS filing is the more auditable record, and it picks by what EXISTS, so
 * any grant above zero wins. MEASURED ON PROD 2026-09-21 across the 7 curated givers: Warren
 * Buffett's card led with a $2,276 foundation figure ("Gave $2K through …") against a sourced $60B
 * since 2006; MacKenzie Scott's with $4.5M against over $26B, though her curated note says she has no
 * private foundation, so those rows are likely the B-021 attribution ceiling; George Soros's with
 * $1.6M against $32B. A card telling a reader Buffett gave a four-figure sum is the opposite of the
 * receipt moment, and it misleads about a named living person.
 *
 * SAME BASIS OR NO COMPARISON. A 990's grants are ONE filing year, so the curated side is its
 * ANNUALIZED figure. Comparing the cumulative total would weigh two decades against one year. The
 * annualized figure is for this comparison ONLY: the card still states the cumulative figure with
 * its own period, never a rate, because most annualized figures are a lifetime spread evenly.
 *
 * Calibrated on the day it shipped: Buffett and Soros fire, by hundreds to a million times. Scott's
 * figure dwarfs hers too, but her curated row names no sourced period, so it is refused upstream and
 * cannot lead; a numerical margin never licenses an unsourced sentence. Bloomberg ($3.7B a year against
 * $1.42B, 2.6x) stays on his 990 lead, which is correct. Zuckerberg and Omidyar hold no grants, so the
 * ladder already reached their receipt.
 */
export const DIRECT_GIVING_DOMINANCE_RATIO = 10;

/** True only when BOTH figures are real and the annualized direct figure is at least 10x the grants. */
export function directGivingDominatesGrants(
  grantsRaw: number | null | undefined,
  directAnnual: number | null | undefined,
): boolean {
  if (typeof grantsRaw !== "number" || !Number.isFinite(grantsRaw) || grantsRaw <= 0) return false;
  if (typeof directAnnual !== "number" || !Number.isFinite(directAnnual) || directAnnual <= 0) return false;
  return directAnnual >= grantsRaw * DIRECT_GIVING_DOMINANCE_RATIO;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * PHILANTHROPY FACT DISPATCH — extracted 2026-09-14 because the defect it fixes is ORDER-DEPENDENT,
 * and an order-dependent defect cannot be held by a source-shape test.
 *
 * `philanthropy` is a factTYPE shared by three different value shapes, and only one carries
 * foundations. `foundationTotals()` on a `giving_pledge` or `total_giving` value returns {0, 0}, so
 * a route that branched on the TYPE let whichever row Postgres returned last reset a real 990
 * record to zero. MEASURED on prod 2026-09-14: 88 approved persons carry BOTH `foundation_990s` and
 * `giving_pledge` (Michael Bloomberg, Elon Musk, Larry Ellison, Ray Dalio, Sara Blakely …), the
 * daily-ten fact query has no ORDER BY, and the losing case drops the card's lead to "a public
 * promise to give most of it away" — erasing a sourced billions-scale giving record. It is also the
 * real cause of Cycle 14's Finding 2, which had been diagnosed as the B-021 attribution ceiling.
 *
 * So dispatch is BY KEY and the result is order-independent by construction. The tests assert that
 * over every permutation, which is the only shape of test that could have caught this.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** The subset of a person_fact this dispatch reads. */
export interface PhilanthropyFactInput {
  factKey: string;
  factType: string;
  factValue: unknown;
}

export interface PhilanthropyReading {
  /** Foundation grants paid — the strongest documented giving receipt. */
  givingRaw: number;
  /** Foundation assets held. */
  assetsRaw: number;
  foundationsCount: number;
  /**
   * Curated direct giving, already validated as renderable. Absent, never partial. `annual` is the
   * ANNUALIZED figure, for comparing against one 990 year only — never render it.
   */
  directGiving: { amount: number; period: string; source: string; annual: number | null } | null;
  givingPledge: boolean;
}

/**
 * A curated period label is only usable when it IS a period.
 *
 * The stored `periodLabel` is not uniform: Michael Bloomberg's reads "$21B+ lifetime" and Phil
 * Knight's "≥$2.7B to OHSU" — an amount-qualifier and a recipient. Interpolating those produced
 * "Gave $21.0B $21B+ lifetime, per CNBC / Chronicle of Philanthropy." Refusing them leaves those
 * cards exactly as they were; normalising the curated rows is data work, not a template hack.
 */
export const CURATED_PERIOD_SHAPE = /^since \d{4}$/;

/** Smallest curated figure that may lead a card. `fmtMoney(0.0001)` renders "$0.00" — a false zero. */
export const MIN_CURATED_GIVING = 1e6;

/**
 * Read every philanthropy-shaped fact into one reading, independent of the order they arrive in.
 * `foundationTotals` is injected so this stays in the shared package without importing the route's
 * collapse helper into a cycle — the caller passes the ONE shared implementation.
 */
export function readPhilanthropyFacts(
  facts: readonly PhilanthropyFactInput[],
  foundationTotals: (value: unknown) => { totalAssets: number; totalGrants: number },
): PhilanthropyReading {
  const out: PhilanthropyReading = {
    givingRaw: 0,
    assetsRaw: 0,
    foundationsCount: 0,
    directGiving: null,
    givingPledge: false,
  };

  for (const f of facts) {
    const val = f.factValue as Record<string, unknown> | null;

    if (f.factKey === "giving_pledge" || f.factType === "giving_pledge") {
      out.givingPledge = true;
      continue;
    }

    if (f.factKey === "total_giving") {
      if (!val || typeof val !== "object") continue;
      const amount = val.cumulativeGiving;
      const period = typeof val.periodLabel === "string" ? val.periodLabel.trim() : "";
      const source = typeof val.source === "string" ? val.source.trim() : "";
      // `Number(true)` is 1 and `Number("Infinity")` is Infinity — both rendered on a card about a
      // real person during review. Require a real finite number, not a coercible one.
      if (
        typeof amount === "number" &&
        Number.isFinite(amount) &&
        amount >= MIN_CURATED_GIVING &&
        CURATED_PERIOD_SHAPE.test(period) &&
        source
      ) {
        // Held to the same bar as the amount: a real finite number, never a coercible one
        // (`Number(true)` is 1 and `Number("5e9")` is 5e9).
        const annual = val.annualGiving;
        out.directGiving = {
          amount,
          period,
          source,
          annual: typeof annual === "number" && Number.isFinite(annual) && annual > 0 ? annual : null,
        };
      }
      continue;
    }

    if (f.factType === "philanthropy" && val && typeof val === "object") {
      /* The shape test reads the COLLAPSED result, never the fetcher's raw stored sums. Testing for
         the presence of those two legacy fields — even without reading their values — trips B-030's
         fork guard, correctly, and naming them even in a comment trips it too (this repo's own rule:
         do not write prose about a linter inside the field that linter reads). They are the
         un-collapsed sums that published a 2x figure on the Gates profiles. Asking foundationTotals
         is both the allowed read and the honest one, since a fact it cannot total contributes
         nothing here anyway. */
      const { totalAssets, totalGrants } = foundationTotals(val);
      if (Array.isArray(val.foundations) || totalAssets > 0 || totalGrants > 0) {
        out.foundationsCount = Array.isArray(val.foundations) ? val.foundations.length : 0;
        out.assetsRaw = totalAssets;
        out.givingRaw = totalGrants;
      }
    }
  }

  return out;
}
