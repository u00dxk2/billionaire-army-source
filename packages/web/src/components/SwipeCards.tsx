"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useVoteSaves } from "@/lib/use-vote-saves";
import VoteSaveNotices from "./VoteSaveNotices";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Person {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  badges: { givingPledge?: boolean };
  images: string[];
  pbs: string | null;
}

export default function SwipeCards({ persons }: { persons: Person[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animation, setAnimation] = useState<"left" | "right" | null>(null);
  const [results, setResults] = useState<Record<string, "approve" | "disapprove">>({});
  // Canon P0-1: guests' votes are never POSTed, so the results screen must not
  // claim they were. Mirrors DailySwipe's disclosure.
  // null until the mount session read resolves, so an unknown visitor is never taken for a
  // signed-in one whose session has since disappeared.
  const [isGuest, setIsGuest] = useState<boolean | null>(null);
  // B-050: whether each vote POST saved, disclosed on the results screen.
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

  async function vote(direction: "approve" | "disapprove") {
    if (!current) return;

    setAnimation(direction === "approve" ? "right" : "left");
    setResults((prev) => ({ ...prev, [current.id]: direction }));

    // B-051: stamped HERE, when the verdict was chosen — not inside the thunk below, which runs when
    // the request is actually sent. The API keeps the voter's last verdict by comparing these stamps.
    const castAt = Date.now();

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Fire-and-forget so the card advance isn't delayed — which is why a failed save can only be
      // disclosed on the results screen, never on the card that was voted on.
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

  if (done) {
    const approved = Object.values(results).filter((v) => v === "approve").length;
    const total = Object.keys(results).length;
    return (
      <div className="swipe-done">
        <h2>All caught up!</h2>
        <p>
          You {isGuest ? "rated" : "voted on"} {total} profile{total !== 1 ? "s" : ""}: {approved} approved, {total - approved} disapproved.
        </p>
        {isGuest && (
          <p className="daily-guest-note">
            These verdicts weren&apos;t recorded — <a href="/login">sign in</a> so your votes count on the scoreboard.
          </p>
        )}
        <VoteSaveNotices disclosure={saves.disclosure} />
        <button className="btn btn-primary" onClick={() => { setCurrentIndex(0); setResults({}); saves.restart(); }}>
          Start Over
        </button>
      </div>
    );
  }

  return (
    <div className="swipe-container">
      <div className={`swipe-card ${animation ? `swipe-${animation}` : ""}`}>
        <div className="swipe-card-inner">
          {current.images && current.images.length > 0 ? (
            <img src={current.images[0]} alt={current.name} className="swipe-card-photo" />
          ) : (
            <div className="swipe-card-avatar">
              {current.name.split(" ").map((n: string) => n[0]).join("")}
            </div>
          )}
          <h2 className="swipe-card-name">{current.name}</h2>
          {current.pbs && (
            <div className="pbs-chip" style={{ margin: "0.5rem auto", display: "inline-flex" }}>
              Giving score: {Number(current.pbs).toFixed(1)}
            </div>
          )}
          {current.state && (
            <p style={{ color: "var(--color-text-secondary)" }}>{current.state}</p>
          )}
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "center", marginTop: "0.75rem" }}>
            {current.industry.map((ind) => (
              <span key={ind} className="badge badge-primary">{ind}</span>
            ))}
            {current.badges?.givingPledge && (
              <span className="badge badge-green">Giving Pledge</span>
            )}
          </div>
          <a href={`/billionaires/${current.id}`} className="source-link" style={{ marginTop: "1rem", display: "inline-block" }}>
            View full profile
          </a>
        </div>
        <div className="swipe-actions">
          <button className="btn btn-disapprove swipe-btn" onClick={() => vote("disapprove")}>
            Disapprove
          </button>
          <button className="btn btn-approve swipe-btn" onClick={() => vote("approve")}>
            Approve
          </button>
        </div>
      </div>
      <p className="swipe-counter">
        {currentIndex + 1} of {persons.length}
      </p>
    </div>
  );
}
