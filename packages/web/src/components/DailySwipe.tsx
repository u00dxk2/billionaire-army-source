"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { pbsGrade, topPartyLabel, NOT_GRADED_LABEL } from "@ba/shared";
import { SITE_URL } from "@/lib/site";
import { useVoteSaves } from "@/lib/use-vote-saves";
import VoteSaveNotices from "./VoteSaveNotices";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Highlights {
  netWorth: string | null;
  /** B-065 — "A net worth stated in this summary may be out of date." (netWorthSummaryNote), or null. */
  netWorthNote?: string | null;
  summary: string | null;
  political: {
    total: string;
    topRecipient: string;
    partyBreakdown: Record<string, number>;
  } | null;
  philanthropy: {
    totalAssets: string;
    totalGrants: string;
    foundations: number;
  } | null;
  givingPledge: boolean;
  receiptHook: { tag: string; text: string } | null;
  factCount: number;
}

interface Person {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  badges: { givingPledge?: boolean };
  images: string[];
  pbs: string | null;
  /** "not_graded": no giving record on file, so the API serves no score for this person. */
  gradeStatus?: "graded" | "not_graded";
  highlights: Highlights | null;
}

// B-038. This was one of TWO byte-identical forks of the same picker (the other lived in
// api/src/routes/persons.ts) and both returned the RAW FEC CODE, so a card could read "mostly NNE".
// Both now read `topPartyLabel` from @ba/shared, which also folds DEM/Dem before comparing — the
// unfolded version compared fragments of one party and could name the wrong lean.

const QUIPS_APPROVE = [
  "One of the good ones? We'll see.",
  "Benefit of the doubt. Noted.",
  "The scoreboard is watching.",
  "Trust, but verify.",
  "Approved. Receipts pending.",
];

const QUIPS_DISAPPROVE = [
  "The people have spoken.",
  "Noted. Moving on.",
  "Room for improvement.",
  "The scoreboard doesn't lie.",
  "Disapproved. The data agrees.",
];

const QUIPS_SKIP = [
  "Not enough info? Fair.",
  "Skipped. No judgment.",
  "Moving on.",
];

export default function DailySwipe({ persons, date }: { persons: Person[]; date: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animation, setAnimation] = useState<"left" | "right" | "up" | null>(null);
  const [results, setResults] = useState<Record<string, "approve" | "disapprove" | "skip">>({});
  const [quip, setQuip] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Canon P0-1: guests' votes are never recorded, but the hero promises "your
  // call shapes the scoreboard" — surface the truth instead of faking success
  // (design-canon review 2026-07-18).
  // null until the mount session read resolves, so an unknown visitor is never taken for a
  // signed-in one whose session has since disappeared.
  const [isGuest, setIsGuest] = useState<boolean | null>(null);
  // Canon Wave 2 S4 + B-050: a signed-in vote whose POST fails (or is still
  // in flight) is disclosed on the results screen, never shown as counted.
  const saves = useVoteSaves();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsGuest(!session);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = persons[currentIndex];
  const done = currentIndex >= persons.length;

  function showQuip(quips: string[]) {
    setQuip(quips[Math.floor(Math.random() * quips.length)]);
    setTimeout(() => setQuip(null), 1800);
  }

  async function vote(direction: "approve" | "disapprove") {
    if (!current) return;

    setAnimation(direction === "approve" ? "right" : "left");
    setResults((prev) => ({ ...prev, [current.id]: direction }));
    // Canon P0-1: the quip celebrates a recorded vote. A guest's vote is never
    // recorded, so celebrating it is fake success — the guest banner is their
    // feedback instead. (This fired BEFORE the session read below, so guests
    // got the success quip regardless.)
    // `=== false`, not `!isGuest`: before the mount read resolves this is null, and celebrating a
    // recorded vote for a visitor who may be a guest is the fake success this branch exists to avoid.
    if (isGuest === false) {
      showQuip(direction === "approve" ? QUIPS_APPROVE : QUIPS_DISAPPROVE);
    }

    // B-051: stamped HERE, when the verdict was chosen — not inside the thunk below, which runs when
    // the request is actually sent. Back-then-re-vote is exactly the overlap this ordering resolves.
    const castAt = Date.now();

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Fire-and-forget so the card advance isn't delayed — but track the
      // save so the results screen can disclose it.
      saves.track(current.id, current.name, () => fetch(`${API_URL}/api/votes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ personId: current.id, direction, castAt }),
      }));
    } else if (isGuest !== true) {
      // No session, and we do not KNOW this is a guest (signed out in another tab since the page
      // loaded, or the mount read has not resolved yet): the verdict was never sent, so it must
      // not read as counted. A known guest is covered by the guest note instead.
      saves.markUnsent(current.id, current.name);
    }

    setTimeout(() => {
      setAnimation(null);
      setCurrentIndex((i) => i + 1);
    }, 300);
  }

  function skip() {
    if (!current) return;
    setAnimation("up");
    setResults((prev) => ({ ...prev, [current.id]: "skip" }));
    showQuip(QUIPS_SKIP);
    setTimeout(() => {
      setAnimation(null);
      setCurrentIndex((i) => i + 1);
    }, 300);
  }

  function goBack() {
    if (currentIndex <= 0) return;
    setCurrentIndex((i) => i - 1);
    // Remove previous result so they can re-vote
    const prevPerson = persons[currentIndex - 1];
    setResults((prev) => {
      const copy = { ...prev };
      delete copy[prevPerson.id];
      return copy;
    });
  }

  // ─── Results screen ───
  if (done) {
    const voted = Object.entries(results).filter(([, v]) => v !== "skip");
    const approved = voted.filter(([, v]) => v === "approve").length;
    const disapproved = voted.filter(([, v]) => v === "disapprove").length;
    const skipped = Object.values(results).filter((v) => v === "skip").length;

    const dateLabel = new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

    // Carry the receipt into the share — the would-tell-a-friend moment is a
    // sourced fact, not a bare name scorecard. Lead with the day's sharpest
    // receipt (lowest PBS = biggest wealth↔giving gap), carrying net worth ·
    // grade · the strongest sourced fact; tag each verdict line with its grade.
    // Reuses on-screen data, no invented editorial. (Mirrors FeedCard's share.)
    const graded = persons
      .map((p) => {
        const n = p.pbs !== null && Number.isFinite(Number(p.pbs)) ? Number(p.pbs) : null;
        return n !== null ? { p, pbs: n, grade: pbsGrade(n) } : null;
      })
      .filter((x): x is { p: Person; pbs: number; grade: ReturnType<typeof pbsGrade> } => x !== null)
      .sort((a, b) => a.pbs - b.pbs);
    const lead = graded.find((g) => g.p.highlights?.receiptHook) ?? graded[0] ?? null;

    const gradeOf = (p: Person): string | null => {
      const n = p.pbs !== null && Number.isFinite(Number(p.pbs)) ? Number(p.pbs) : null;
      return n !== null ? pbsGrade(n).letter : null;
    };
    const summaryLines = persons.map((p) => {
      const r = results[p.id];
      const sym = r === "approve" ? "+" : r === "disapprove" ? "-" : "~";
      const g = gradeOf(p);
      return `${sym} ${p.name}${g ? ` (${g})` : p.gradeStatus === "not_graded" ? ` (${NOT_GRADED_LABEL.toLowerCase()})` : ""}`;
    });

    const leadLines: string[] = [];
    if (lead) {
      const nw = lead.p.highlights?.netWorth;
      leadLines.push([lead.p.name, nw, `giving grade ${lead.grade.letter} (${Math.round(lead.pbs)})`].filter(Boolean).join(" · "));
      const hook = lead.p.highlights?.receiptHook?.text;
      if (hook) leadLines.push(hook);
      leadLines.push("");
    }

    // R-083 — same fix as FeedCard's share: the link belongs in the `url` FIELD, because a
    // target only unfurls what it is handed there. A URL inside the text blob is characters,
    // and /today's Open Graph card never appeared for the person on the other end.
    const shareUrl = `${SITE_URL}/today`;
    const shareBody = [
      `Billionaire Army — Today's 10 (${dateLabel})`,
      "",
      ...leadLines,
      `My verdict — ${approved} approved, ${disapproved} disapproved${skipped > 0 ? `, ${skipped} skipped` : ""}:`,
      ...summaryLines,
    ].join("\n");
    // The clipboard has no `url` field, so ITS copy keeps the link inline or the pasted
    // message has nowhere to go. Native gets the body plus `url` and would otherwise print
    // the same link twice.
    const clipboardText = `${shareBody}\n\nSee the receipts → ${shareUrl}`;

    function handleShare() {
      if (navigator.share) {
        navigator.share({ text: shareBody, url: shareUrl }).catch(() => {});
      } else {
        navigator.clipboard.writeText(clipboardText).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }
    }

    return (
      <div className="daily-results">
        <div className="daily-results-header">
          <h2>Your Daily 10 Results</h2>
          <p className="daily-results-date">
            {new Date(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="daily-results-summary">
          <div className="daily-results-stat">
            <span className="daily-results-stat-value" style={{ color: "var(--color-accent-green)" }}>
              {approved}
            </span>
            <span className="daily-results-stat-label">Approved</span>
          </div>
          <div className="daily-results-divider" />
          <div className="daily-results-stat">
            <span className="daily-results-stat-value" style={{ color: "var(--color-accent)" }}>
              {disapproved}
            </span>
            <span className="daily-results-stat-label">Disapproved</span>
          </div>
          {skipped > 0 && (
            <>
              <div className="daily-results-divider" />
              <div className="daily-results-stat">
                <span className="daily-results-stat-value" style={{ color: "var(--color-text-muted)" }}>
                  {skipped}
                </span>
                <span className="daily-results-stat-label">Skipped</span>
              </div>
            </>
          )}
        </div>

        <div className="daily-results-list">
          {persons.map((p) => {
            const r = results[p.id];
            const pbs = p.pbs ? Number(p.pbs) : null;
            const grade = pbs !== null ? pbsGrade(pbs) : null;
            const cls = r === "approve" ? "daily-result--approved" : r === "disapprove" ? "daily-result--disapproved" : "daily-result--skipped";
            return (
              <a key={p.id} href={`/billionaires/${p.id}`} className={`daily-result-row ${cls}`}>
                <div className="daily-result-vote">
                  {r === "approve" ? "+" : r === "disapprove" ? "-" : "~"}
                </div>
                {p.images?.[0] ? (
                  <img src={p.images[0]} alt="" className="daily-result-photo" />
                ) : (
                  <div className="daily-result-avatar">
                    {p.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </div>
                )}
                <div className="daily-result-info">
                  <span className="daily-result-name">{p.name}</span>
                  <span className="daily-result-meta">
                    {p.highlights?.netWorth}{p.highlights?.netWorth && p.state ? " · " : ""}{p.state}
                  </span>
                </div>
                {grade ? (
                  <div className="daily-result-grade" style={{ background: grade.color }}>
                    {grade.letter}
                  </div>
                ) : p.gradeStatus === "not_graded" ? (
                  <div className="daily-card-not-graded">{NOT_GRADED_LABEL}</div>
                ) : null}
              </a>
            );
          })}
        </div>

        <div className="daily-results-actions">
          <button className="btn btn-primary" onClick={handleShare} aria-live="polite">
            {copied ? "Copied!" : "Share Results"}
          </button>
          <a href="/billionaires" className="btn btn-secondary">
            Browse All Profiles
          </a>
        </div>

        {isGuest && (
          <p className="daily-guest-note">
            These verdicts weren&apos;t recorded — <a href="/login">sign in</a> so your votes count on the scoreboard.
          </p>
        )}
        <VoteSaveNotices disclosure={saves.disclosure} />

        <p className="daily-results-footer">
          New profiles every day. Come back tomorrow for a fresh 10.
        </p>
      </div>
    );
  }

  // ─── Swipe card ───
  const pbs = current?.pbs ? Number(current.pbs) : null;
  const grade = pbs !== null ? pbsGrade(pbs) : null;
  const h = current?.highlights;
  const party = h?.political ? topPartyLabel(h.political.partyBreakdown) : null;

  return (
    <div className="daily-swipe-container">
      {/* Progress dots */}
      <div className="daily-progress">
        {persons.map((_, i) => {
          const r = results[persons[i]?.id];
          let cls = "";
          if (i < currentIndex) {
            cls = r === "approve" ? "daily-dot--approved" : r === "disapprove" ? "daily-dot--disapproved" : "daily-dot--skipped";
          } else if (i === currentIndex) {
            cls = "daily-dot--current";
          }
          return <div key={i} className={`daily-dot ${cls}`} />;
        })}
      </div>

      {/* Quip toast */}
      {quip && <div className="daily-quip" role="status">{quip}</div>}

      {/* Card */}
      <div className={`swipe-card daily-card ${animation ? (animation === "up" ? "swipe-up" : `swipe-${animation}`) : ""}`}>
        <div className="daily-card-inner">
          {/* Header row: photo + name + stats */}
          <div className="daily-card-header">
            {current.images?.[0] ? (
              <img src={current.images[0]} alt={current.name} className="daily-card-photo" />
            ) : (
              <div className="daily-card-avatar">
                {current.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
              </div>
            )}
            <div className="daily-card-identity">
              <h2 className="daily-card-name">{current.name}</h2>
              <div className="daily-card-meta">
                {h?.netWorth && <span className="daily-card-nw">{h.netWorth}</span>}
                {current.state && <span>{current.state}</span>}
                {current.industry.slice(0, 2).map((ind) => (
                  <span key={ind}>{ind}</span>
                ))}
              </div>
            </div>
            {grade ? (
              <div className="daily-card-grade" style={{ background: grade.color }}>
                <span className="daily-card-grade-letter">{grade.letter}</span>
                <span className="daily-card-grade-score">{pbs!.toFixed(1)}</span>
              </div>
            ) : current.gradeStatus === "not_graded" ? (
              // Not graded: the API serves no score for a person with no giving record on file.
              <div className="daily-card-not-graded" title="No charitable giving record on file, so we do not score this person.">
                {NOT_GRADED_LABEL}
              </div>
            ) : null}
          </div>

          {/* Receipt hook — the single strongest sourced fact, leading the card */}
          {h?.receiptHook && (
            <p className="daily-card-hook">
              <span className="daily-card-hook-tag">{h.receiptHook.tag}</span>
              <span>{h.receiptHook.text}</span>
            </p>
          )}

          {/* Summary */}
          {h?.summary && (
            <p className="daily-card-summary">{h.summary}</p>
          )}
          {/* B-065: the API's stated sentence when this person's net worth is not current. */}
          {h?.netWorthNote && (
            <p className="daily-card-summary daily-card-nw-note">{h.netWorthNote}</p>
          )}

          {/* Fact nuggets */}
          <div className="daily-card-facts">
            {h?.political && (
              <div className="daily-fact">
                <span className="daily-fact-icon">FEC</span>
                <span className="daily-fact-text">
                  {h.political.total} in political contributions
                  {party ? ` (mostly ${party})` : ""}
                  {h.political.topRecipient ? `. Top: ${h.political.topRecipient}` : ""}
                </span>
              </div>
            )}

            {h?.philanthropy && (
              <div className="daily-fact">
                <span className="daily-fact-icon">990</span>
                <span className="daily-fact-text">
                  {h.philanthropy.foundations} foundation{h.philanthropy.foundations !== 1 ? "s" : ""}
                  {h.philanthropy.totalAssets ? ` with ${h.philanthropy.totalAssets} in assets` : ""}
                  {h.philanthropy.totalGrants ? `, ${h.philanthropy.totalGrants} in grants` : ""}
                </span>
              </div>
            )}

            {h?.givingPledge && (
              <div className="daily-fact">
                <span className="daily-fact-icon daily-fact-icon--green">GP</span>
                <span className="daily-fact-text">Signed the Giving Pledge</span>
              </div>
            )}

            {!h?.receiptHook && !h?.political && !h?.philanthropy && !h?.summary && !h?.givingPledge && (
              <div className="daily-fact">
                <span className="daily-fact-icon">?</span>
                <span className="daily-fact-text daily-fact-text--muted">Limited public data available for this person.</span>
              </div>
            )}
          </div>

          {/* Counter + profile link */}
          <div className="daily-card-footer">
            <span className="daily-card-counter">{currentIndex + 1} of {persons.length}</span>
            <a href={`/billionaires/${current.id}`} className="source-link" target="_blank" rel="noopener">
              Full profile
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="daily-card-actions">
          <button className="btn btn-disapprove daily-action-btn" onClick={() => vote("disapprove")}>
            Disapprove
          </button>
          <button className="btn daily-action-btn daily-action-skip" onClick={skip}>
            Skip
          </button>
          <button className="btn btn-approve daily-action-btn" onClick={() => vote("approve")}>
            Approve
          </button>
        </div>
      </div>

      {/* Guest notice — votes aren't recorded without an account */}
      {isGuest && (
        <p className="daily-guest-note">
          Browsing as a guest — <a href="/login">sign in</a> to make your votes count.
        </p>
      )}

      {/* Back button */}
      {currentIndex > 0 && (
        <button className="daily-back-btn" onClick={goBack}>
          Back
        </button>
      )}
    </div>
  );
}
