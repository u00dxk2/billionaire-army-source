/**
 * Flow 1 (the Feed Gut-Punch), Cycle 13 follow-on / R-081. Deterministic, read-only, no LLM, no DB.
 *
 * The feed card's grade badge says GIVING, not PBS — R-041 relabelled it because beside a
 * political or controversy card a bare letter reads as the platform's overall verdict and
 * exonerates the card meant to indict. PBS labelling was deliberately KEPT on profile /
 * leaderboard / compare, which are score-comparison contexts with the methodology on the screen.
 *
 * The GPT-written summary went on saying it anyway. Measured on the served 40 on 2026-09-03:
 * FIVE cards read "has a PBS score of 91.60" three inches from a badge reading "GIVING A (92)",
 * one of them PROMOTED at position 1 — one unexplained acronym that collides with a broadcaster,
 * one number at two roundings, on the same card, about the same person.
 *
 * THE ASSERTION IS ON THE SERVED TEXT, not on the curator's prompt and not on the database. The
 * write-path fix reaches only cards published after it, the render-path repair reaches the ones
 * already published, and only the served card can tell you whether a reader is still looking at
 * the contradiction. So this gate reads what is actually being served.
 *
 * THE PREDICATE IS IMPORTED (`namesInternalScore` from `@ba/shared`), never restated here. AGENTS.md
 * carries the anchor: a checker written to verify the B-037 fix was FORKED from its guard, dropped
 * one condition, and reported 16 where the page withheld 13 — and that 16 reached a commit message,
 * two reports and a primer.
 *
 * Exit: 0 CLEAN · 1 bad input / selftest failure · 2 UNREADABLE · 3 FINDING.
 * A zero denominator is UNREADABLE, never a green — an audit that inspected nothing is not clean.
 */

import { namesInternalScore, readerFacingScoreFigures, readerFacingScoreValue } from "@ba/shared";

// Required: the API base to read /api/feed from (e.g. http://localhost:3001). There is no default.
const API = process.env.BA_API_URL?.trim() || "";
const LIMIT = Number(process.env.PROBE_LIMIT ?? 40);

type Verdict = "CLEAN" | "FINDING" | "UNREADABLE";
type RunResult = { code: number; verdict: Verdict };

type ServedCard = {
  id?: unknown;
  headline?: unknown;
  summary?: unknown;
  promoted?: unknown;
  contextData?: { pbs?: unknown } | null;
  persons?: Array<{ name?: unknown }> | null;
};

/**
 * The bucket arithmetic, pulled out so the selftest can drive it in BOTH directions without a
 * network read. Same shape as `check-fec-withheld-prose.ts`.
 */
export function evaluateBuckets(
  denominator: number,
  clean: number,
  findings: number,
  unreadable: number,
): RunResult {
  if (denominator === 0 || clean + findings + unreadable !== denominator || unreadable > 0) {
    return { code: 2, verdict: "UNREADABLE" };
  }
  if (findings > 0) return { code: 3, verdict: "FINDING" };
  return { code: 0, verdict: "CLEAN" };
}

/** The card's badge figure, at the badge's own rounding — `null` when the badge renders none. */
export function badgeFigure(card: ServedCard): number | null {
  const raw = card.contextData?.pbs;
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return readerFacingScoreValue(n);
}

/** Everything on the card a reader reads as the card's own prose. */
export function readerFacingText(card: ServedCard): string {
  const headline = typeof card.headline === "string" ? card.headline : "";
  const summary = typeof card.summary === "string" ? card.summary : "";
  return `${headline}\n${summary}`;
}

function runSelftest(): number {
  const checks: Array<[string, () => boolean]> = [
    [
      "POSITIVE CONTROL — one card naming the internal score drives the live arm to exit 3",
      () => evaluateBuckets(40, 39, 1, 0).code === 3,
    ],
    [
      "ZERO DENOMINATOR — an empty feed read is UNREADABLE, never clean",
      () => evaluateBuckets(0, 0, 0, 0).code === 2,
    ],
    [
      "BUCKETS THAT DO NOT SUM are UNREADABLE, never clean",
      () => evaluateBuckets(40, 38, 1, 0).code === 2,
    ],
    [
      "CLEAN POLARITY — a full sweep with no finding is exit 0",
      () => evaluateBuckets(40, 40, 0, 0).code === 0,
    ],
    [
      "THE LIVE 2026-09-03 SENTENCE is detected by the imported predicate",
      () =>
        namesInternalScore(
          "Scott is estimated to be worth $59.4 billion and has a PBS score of 91.60; the article " +
            "describes her as having given away nearly half her fortune.",
        ),
    ],
    [
      "THE REPAIRED SENTENCE is not detected — the gate would go green on the fix, not on silence",
      () =>
        !namesInternalScore(
          "Scott is estimated to be worth $59.4 billion and has a giving score of 92; the article " +
            "describes her as having given away nearly half her fortune.",
        ),
    ],
    [
      "THE BROADCASTER is not a finding — a real donation story must still be carryable",
      () => !namesInternalScore("The foundation gave $5 million to PBS NewsHour this year."),
    ],
    [
      "STALE FIGURE under the APPROVED name is a finding — the gate must not certify the " +
        "contradiction it is named for",
      () => {
        const text = "Scott has a giving score of 92 today.";
        const badge = badgeFigure({ contextData: { pbs: "40.2" } });
        return (
          !namesInternalScore(text) &&
          badge === 40 &&
          readerFacingScoreFigures(text).filter((n) => Math.round(n) !== badge).length === 1
        );
      },
    ],
    [
      "AN AGREEING FIGURE under the approved name is NOT a finding",
      () => {
        const badge = badgeFigure({ contextData: { pbs: "91.6" } });
        return (
          badge === 92 &&
          readerFacingScoreFigures("Scott has a giving score of 92 today.").filter(
            (n) => Math.round(n) !== badge,
          ).length === 0
        );
      },
    ],
    [
      "BADGE FIGURE is the badge's rounding, and absent rather than zero when unstatable",
      () =>
        badgeFigure({ contextData: { pbs: "91.6" } }) === 92 &&
        badgeFigure({ contextData: { pbs: "" } }) === null &&
        badgeFigure({ contextData: { pbs: null } }) === null &&
        badgeFigure({ contextData: null }) === null,
    ],
  ];

  let failed = 0;
  for (const [name, fn] of checks) {
    let ok = false;
    try {
      ok = fn();
    } catch {
      ok = false;
    }
    console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`RESULT: SELFTEST ${checks.length - failed}/${checks.length} (exit ${failed ? 1 : 0})`);
  return failed ? 1 : 0;
}

const args = process.argv.slice(2);
// `npm run check:card-badge -- --selftest` forwards the flag; `npm run check:card-badge --selftest`
// does NOT — npm eats it into config. Both shapes are accepted so the documented command works.
const selftestRequested =
  (args.length === 1 && args[0] === "--selftest") ||
  (args.length === 0 && process.env.npm_config_selftest === "true");

if (selftestRequested) {
  process.exitCode = runSelftest();
} else if (args.length > 0) {
  console.log(`RESULT: BAD INPUT — unrecognised argument(s): ${args.join(" ")} (exit 1)`);
  process.exitCode = 1;
} else if (!API) {
  console.log("RESULT: BAD INPUT — set BA_API_URL to the API base to probe, e.g. http://localhost:3001 (exit 1)");
  process.exitCode = 1;
} else {
  let code = 2;
  try {
    const res = await fetch(`${API}/api/feed?limit=${LIMIT}`);
    if (!res.ok) {
      console.log(`RESULT: UNREADABLE — /api/feed returned HTTP ${res.status} (exit 2)`);
      process.exitCode = 2;
    } else {
      const json = (await res.json()) as { data?: ServedCard[] };
      const cards = Array.isArray(json.data) ? json.data : [];

      let clean = 0;
      let findings = 0;
      let unreadable = 0;
      const offenders: string[] = [];

      for (const card of cards) {
        const text = readerFacingText(card);
        // A card with neither a headline nor a summary is not a card we can judge.
        if (text.trim() === "") {
          unreadable += 1;
          continue;
        }
        const figure = badgeFigure(card);
        // TWO ways a card can contradict its badge, and the second is the one a vocabulary-only
        // gate certifies as clean: naming the score correctly and then stating a STALE figure
        // beside it. `contextData.pbs` is overridden live, so any figure frozen into prose drifts
        // on the next score:all — the defect this gate is named for, under an approved label.
        const namedInternally = namesInternalScore(text);
        const disagreeing =
          figure == null ? [] : readerFacingScoreFigures(text).filter((n) => Math.round(n) !== figure);

        if (namedInternally || disagreeing.length > 0) {
          findings += 1;
          const person = card.persons?.[0]?.name;
          const why = namedInternally
            ? "names the score by its internal name"
            : `states ${disagreeing.join(", ")} where the badge reads ${figure}`;
          offenders.push(
            `  ${card.promoted ? "PROMOTED" : "in-stream"} ${String(card.id).slice(0, 8)} — ` +
              `${typeof person === "string" ? person : "(person unknown)"}: ${why}`,
          );
        } else {
          clean += 1;
        }
      }

      const promoted = cards.filter((c) => c.promoted === true).length;
      console.log(`read ${cards.length} served card(s) from ${API}/api/feed?limit=${LIMIT}`);
      console.log(`  promoted (above the fold):                  ${promoted}`);
      console.log(`  contradicts its own badge (name or figure):  ${findings}`);
      console.log(`  clean:                                       ${clean}`);
      console.log(`  UNREADABLE — no headline and no summary:     ${unreadable}`);
      console.log(`SUM-CHECK ${clean + findings + unreadable} = ${cards.length}`);
      for (const line of offenders) console.log(line);

      const { code: c, verdict } = evaluateBuckets(cards.length, clean, findings, unreadable);
      code = c;
      if (verdict === "UNREADABLE") {
        console.log(
          `RESULT: UNREADABLE — ${cards.length} card(s) read, buckets ${clean}/${findings}/${unreadable} (exit 2)`,
        );
      } else if (verdict === "FINDING") {
        console.log(
          `RESULT: FINDING — ${findings} of ${cards.length} served card(s) contradict the GIVING ` +
            `badge beside them, by name or by figure (exit 3)`,
        );
      } else {
        console.log(
          `RESULT: CLEAN — 0 of ${cards.length} served card(s) contradict their own badge, by ` +
            `name or by figure (exit 0)`,
        );
      }
      process.exitCode = code;
    }
  } catch (err) {
    console.log(`RESULT: UNREADABLE — ${err instanceof Error ? err.message : String(err)} (exit 2)`);
    process.exitCode = 2;
  }
}
