"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface VoteStats {
  approvals: number;
  disapprovals: number;
  total: number;
  approvalRate: number;
}

export default function VoteButtons({ personId }: { personId: string }) {
  const [stats, setStats] = useState<VoteStats | null>(null);
  const [voted, setVoted] = useState<"approve" | "disapprove" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Canon P0-1: a guest's vote is never recorded. Disclose it in place —
  // the old hard redirect to /login threw away the profile they were reading.
  const [guest, setGuest] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    fetch(`${API_URL}/api/votes/stats/${personId}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [personId]);

  async function handleVote(direction: "approve" | "disapprove") {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setGuest(true);
      return;
    }

    setLoading(true);
    setError(false);
    setGuest(false);
    try {
      const voteRes = await fetch(`${API_URL}/api/votes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        // B-051: when this verdict was chosen, so a fast change of mind keeps the LAST one.
        body: JSON.stringify({ personId, direction, castAt: Date.now() }),
      });
      if (!voteRes.ok) throw new Error("vote failed");

      setVoted(direction);

      // Refresh stats
      const r = await fetch(`${API_URL}/api/votes/stats/${personId}`);
      setStats(await r.json());
    } catch {
      // Canon Wave 2 S4: a failed vote must not fail silently.
      setError(true);
    }
    setLoading(false);
  }

  const pct = stats && stats.total > 0
    ? Math.round(stats.approvalRate * 100)
    : null;

  return (
    <div className="vote-section">
      <div className="vote-buttons">
        <button
          className={`btn btn-approve ${voted === "approve" ? "voted" : ""}`}
          onClick={() => handleVote("approve")}
          disabled={loading}
        >
          Approve
        </button>
        <button
          className={`btn btn-disapprove ${voted === "disapprove" ? "voted" : ""}`}
          onClick={() => handleVote("disapprove")}
          disabled={loading}
        >
          Disapprove
        </button>
      </div>
      {guest && (
        <p className="daily-guest-note" role="alert">
          That vote wasn&apos;t recorded — <a href="/login">sign in</a> so your
          votes count on the scoreboard.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" style={{ marginTop: "0.5rem" }}>
          That vote didn&apos;t save — try again.
        </p>
      )}
      {stats && stats.total > 0 && (
        <div className="vote-stats">
          <div className="vote-bar">
            <div
              className="vote-bar-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="vote-count">
            {pct}% approve ({stats.total} vote{stats.total !== 1 ? "s" : ""})
          </span>
        </div>
      )}
    </div>
  );
}
