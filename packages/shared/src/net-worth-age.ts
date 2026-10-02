import { givingRatio, parseNetWorth, type GivingRatio } from "./giving-ratio";

/**
 * How old is the net worth we are about to show — and are we even allowed to say?
 *
 * THE DEFECT (B-065, 2026-09-29). `fetch:wikidata` reads Wikidata's truthy P2218 and never its P585
 * ("point in time") qualifier, then stamps the fact `retrievedAt: now`. So Michael Bloomberg's
 * "~$55.5B" — Wikidata's preferred value AS OF 2019-01-01 — rendered on the card and the profile as a
 * current figure "retrieved 2026-09-27", beside a linked source saying $109 billion. Measured the same
 * night over the whole index: 139 of 429 dated Wikidata net worths are from 2022 or earlier (Ellison,
 * Zuckerberg, Brin, Ballmer at 2019; Gates at 2017), and on the served 100 cards 42 carried one, 16 of
 * them dividing a giving ratio by it — a ratio that flatters the billionaire, the opposite of a receipt.
 *
 * THE RULE: an age we cannot state is treated as STALE. `retrievedAt` is when WE fetched, and for a
 * Wikidata row it says nothing about when the figure was true — so a Wikidata figure is "undated"
 * until the fetcher stores the statement's own P585 (the carried half of B-065). A realtime-index
 * scrape (RTB, a curated realtime figure) IS dated by its retrieval, because that source reports the
 * figure at the moment it is read. Any other or missing source is "undated" too: claim less.
 *
 * Nothing here changes a stored row, a score or a rank. It changes what a figure is allowed to SAY,
 * the same posture as `philanthropyZeroKind()` and `givingRatio()`'s absent-never-zero rule.
 */

/** Past this age a dated figure is labelled with its date and no longer divides anything. */
export const NET_WORTH_MAX_AGE_DAYS = 365;

/** Sources whose `retrievedAt` IS the figure's as-of date — each reports a live figure when read. */
export const NET_WORTH_DATED_BY_RETRIEVAL = ["rtb", "realtime_index"] as const;

export type NetWorthAge =
  | { kind: "current"; asOf: Date }
  | { kind: "stale"; asOf: Date }
  | { kind: "undated" };

export interface NetWorthFactLike {
  sourceType?: string | null;
  retrievedAt?: Date | string | null;
}

export function netWorthAge(fact: NetWorthFactLike | null | undefined, now: Date = new Date()): NetWorthAge {
  if (!fact) return { kind: "undated" };
  const source = fact.sourceType ?? "";
  if (!(NET_WORTH_DATED_BY_RETRIEVAL as readonly string[]).includes(source)) return { kind: "undated" };
  if (fact.retrievedAt == null) return { kind: "undated" };
  const asOf = fact.retrievedAt instanceof Date ? fact.retrievedAt : new Date(fact.retrievedAt);
  if (Number.isNaN(asOf.getTime())) return { kind: "undated" };
  const ageDays = (now.getTime() - asOf.getTime()) / 86_400_000;
  return ageDays > NET_WORTH_MAX_AGE_DAYS ? { kind: "stale", asOf } : { kind: "current", asOf };
}

/**
 * The words that ride beside a figure that is not current: "undated estimate" or "as of Mar 2024".
 * `null` for a current figure — it renders exactly as before.
 */
export function netWorthAgeLabel(age: NetWorthAge): string | null {
  if (age.kind === "current") return null;
  if (age.kind === "undated") return "undated estimate";
  const month = age.asOf.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `as of ${month} ${age.asOf.getUTCFullYear()}`;
}

/** "~$55.5B (undated estimate)" — the figure with its label, for surfaces that print one string. */
export function netWorthWithAge(value: unknown, fact: NetWorthFactLike | null | undefined, now?: Date): string | null {
  if (value == null) return null;
  const label = netWorthAgeLabel(netWorthAge(fact, now));
  return label ? `${String(value)} (${label})` : String(value);
}

/**
 * The card's giving ratio, only when its DENOMINATOR is current. A ratio divided by a 2019 fortune is a
 * precise-looking number about a named living person that is false today, so it is absent instead —
 * the same absent-never-wrong rule `givingRatio()` already applies to a missing numerator.
 */
export function currentGivingRatio(
  netWorthFact: (NetWorthFactLike & { factValue?: unknown }) | null | undefined,
  totalGivingFactValue: unknown,
  now?: Date,
): GivingRatio | null {
  if (!netWorthFact || netWorthAge(netWorthFact, now).kind !== "current") return null;
  return givingRatio(netWorthFact.factValue, totalGivingFactValue);
}

/**
 * Does the giving GRADE divide by net worth? Only through `generosity` (annual giving ÷ net worth,
 * `computePbs`); with no giving, net worth never enters the score and a note would be false.
 */
export function gradeUsesNetWorth(features: unknown): boolean {
  const g = Number((features as { generosity?: unknown } | null | undefined)?.generosity);
  return Number.isFinite(g) && g > 0;
}

export interface CardNetWorthDisplay {
  /** The chip's figure: the LIVE fact's value when one exists, else the chip frozen at curation. */
  netWorth: string | null;
  /** "undated estimate" / "as of Jun 2025", or null when the figure is current (or absent). */
  netWorthAsOf: string | null;
  /** True when the giving grade divides by a figure that is not current. */
  gradeUsesStaleNetWorth: boolean;
  /**
   * The figure the card's TEXT was written from, when it differs from the chip's figure — e.g. a frozen
   * "~$1.2B" beside a live "~$1.7B". The headline and prose may state it, nothing dates it, and the chip
   * no longer shows it, so the card says so. Null otherwise.
   */
  textFigure: string | null;
}

/**
 * Everything a feed card says about net worth, from the three inputs both feed routes hold. One pure
 * function so the list route and the deep-link route cannot drift, and so the wire-up is testable
 * (KP-93: a lookup miss must never read as "current").
 *
 * A live row whose value is null counts as NO live fact: its metadata cannot date a figure it does not
 * hold. A frozen chip with no live figure behind it is undated by construction.
 */
export function cardNetWorthDisplay(
  frozenChip: unknown,
  liveFact: (NetWorthFactLike & { factValue?: unknown }) | null | undefined,
  scoreFeatures: unknown,
  now?: Date,
): CardNetWorthDisplay {
  const live = liveFact && liveFact.factValue != null ? liveFact : undefined;
  const netWorth = live ? String(live.factValue) : frozenChip ? String(frozenChip) : null;
  if (!netWorth) return { netWorth: null, netWorthAsOf: null, gradeUsesStaleNetWorth: false, textFigure: null };
  const label = netWorthAgeLabel(netWorthAge(live, now));
  const liveN = live ? parseNetWorth(live.factValue) : null;
  const frozenN = frozenChip != null ? parseNetWorth(frozenChip) : null;
  return {
    netWorth,
    netWorthAsOf: label,
    gradeUsesStaleNetWorth: label != null && gradeUsesNetWorth(scoreFeatures),
    textFigure: live && frozenN != null && frozenN > 0 && frozenN !== liveN ? String(frozenChip) : null,
  };
}

/**
 * The stated sentence(s) a feed card carries whenever its net worth is not current, or its text was
 * written from a different figure than the chip now shows. THIS carries the guarantee that the card never
 * presents an undated figure as current — in the chip, the headline or the prose.
 *
 * WHY THERE IS NO INLINE PROSE LABEL (2026-09-29). The first two cuts also labelled the figure inside
 * the prose ("about $55.5 billion (undated estimate)"). Three cross-family review rounds each found that
 * matcher labelling money that was NOT the net worth ("$1 billion in grants", "grants worth $1 billion",
 * a second person's fortune) or missing forms it should have caught. A false label is a false claim about
 * a named living person's figures, so under the stop-patching rule the matcher was REMOVED rather than
 * patched a fourth time. Each sentence below speaks only about figures whose age we actually hold, and
 * never dates a figure it cannot see.
 */
export function netWorthAgeNote(
  netWorthAsOf: string | null,
  gradeUsesStale: boolean,
  textFigure: string | null = null,
  currentFigure: string | null = null,
): string | null {
  const parts: string[] = [];
  if (netWorthAsOf) {
    const what = netWorthAsOf === "undated estimate" ? "an undated estimate" : `a figure ${netWorthAsOf}`;
    parts.push(`The net worth shown on this card is ${what}.`);
  }
  if (textFigure) {
    parts.push(
      netWorthAsOf || !currentFigure
        ? `This card was written from an earlier net-worth figure, ${textFigure}, whose date we do not have.`
        : `This card was written from an earlier net-worth figure, ${textFigure}, whose date we do not have; the current figure is ${currentFigure}.`,
    );
  }
  // Worded not to assert that the SHOWN figure is the one scored: the fact refresh and score:all run at
  // different times, so the grade used our net-worth figure as of its last scoring (Codex r3-4 #5).
  if (netWorthAsOf && gradeUsesStale)
    parts.push("The giving grade is computed from our net-worth figure, so treat the grade as approximate.");
  return parts.length ? parts.join(" ") : null;
}

/**
 * The stated sentence for surfaces with no card — the profile summary and the /today bio. It makes NO
 * claim about which figure the prose states or when it was true (Codex r3-3 #1, #2); it says only that
 * a stated net worth may be out of date, and it appears when EITHER holds:
 * - our stored net worth is not current (undated, or older than the age line), OR
 * - the summary was written BEFORE our current net-worth figure was retrieved (or we cannot tell when it
 *   was written), so the prose may state an earlier figure than the one shown.
 * No net-worth fact at all → null: there is no figure of ours for the prose to be out of step with.
 */
export function netWorthSummaryNote(
  netWorthFact: NetWorthFactLike | null | undefined,
  summaryWrittenAt: string | Date | null | undefined,
  now?: Date,
): string | null {
  if (!netWorthFact) return null;
  const NOTE = "A net worth stated in this summary may be out of date.";
  if (netWorthAge(netWorthFact, now).kind !== "current") return NOTE;
  const written = summaryWrittenAt == null ? NaN : new Date(summaryWrittenAt).getTime();
  const retrieved = netWorthFact.retrievedAt == null ? NaN : new Date(netWorthFact.retrievedAt).getTime();
  if (!Number.isFinite(written) || !Number.isFinite(retrieved)) return NOTE;
  return written < retrieved ? NOTE : null;
}
