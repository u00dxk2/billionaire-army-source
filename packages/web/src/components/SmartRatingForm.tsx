"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { SMART_LABELS } from "@ba/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Props {
  goalId: string;
  currentRatings: Record<string, number> | null;
}

export default function SmartRatingForm({ goalId, currentRatings }: Props) {
  const [priority, setPriority] = useState(3);
  const [smart, setSmart] = useState<Record<string, number>>({
    S: 3, M: 3, A: 3, R: 3, T: 3,
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/goals/${goalId}/rate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ priority, smart }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to submit rating");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <div className="card" style={{ marginTop: "1rem", textAlign: "center" }}>
        <p className="form-success" style={{ fontSize: "1rem" }}>
          Rating submitted! Refresh to see updated scores.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h3>Rate This Goal</h3>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", marginTop: "0.25rem" }}>
        How important is this goal, and how well-formed is it?
      </p>

      <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
        <div style={{ marginBottom: "1.25rem" }}>
          <label className="form-label">
            Priority (how important is this?)
            <div className="rating-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`rating-btn ${priority === n ? "active" : ""}`}
                  aria-pressed={priority === n}
                  aria-label={`Priority ${n} of 5`}
                  onClick={() => setPriority(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>
        </div>

        <div className="smart-grid">
          {(Object.entries(SMART_LABELS) as [string, string][]).map(([key, label]) => (
            <div key={key}>
              <label className="form-label">
                <strong>{key}</strong> — {label}
                <div className="rating-row">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`rating-btn ${smart[key] === n ? "active" : ""}`}
                      aria-pressed={smart[key] === n}
                      aria-label={`${label} ${n} of 5`}
                      onClick={() => setSmart({ ...smart, [key]: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </label>
            </div>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: "1rem" }}>
          {loading ? "Submitting..." : "Submit Rating"}
        </button>
      </form>

      {currentRatings && (
        <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginTop: "0.75rem" }}>
          Current community averages: S:{currentRatings.S?.toFixed(1)} M:{currentRatings.M?.toFixed(1)} A:{currentRatings.A?.toFixed(1)} R:{currentRatings.R?.toFixed(1)} T:{currentRatings.T?.toFixed(1)}
        </p>
      )}
    </div>
  );
}
