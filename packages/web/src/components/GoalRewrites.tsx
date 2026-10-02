"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Rewrite {
  id: string;
  changes: Record<string, string | string[]>;
  comment: string;
  upvotes: number;
  downvotes: number;
  status: string;
  createdAt: string;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  problemStatement: "Problem Statement",
  scope: "Scope",
  targetMetric: "Target Metric",
  deadline: "Deadline",
  interventions: "Interventions",
};

export default function GoalRewrites({ goalId }: { goalId: string }) {
  const [rewrites, setRewrites] = useState<Rewrite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState("");
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [activeField, setActiveField] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetch(`${API_URL}/api/goals/${goalId}/rewrites`)
      .then((r) => r.json())
      .then((d) => setRewrites(d.data || []))
      .catch(() => {});
  }, [goalId]);

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("You must be signed in to suggest a rewrite.");
        setSubmitting(false);
        return;
      }

      const filteredChanges: Record<string, string> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value.trim()) filteredChanges[key] = value.trim();
      }

      if (Object.keys(filteredChanges).length === 0) {
        setError("Add at least one field change.");
        setSubmitting(false);
        return;
      }

      const res = await fetch(`${API_URL}/api/goals/${goalId}/rewrites`, {
        method: "POST",
        headers,
        body: JSON.stringify({ changes: filteredChanges, comment }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Error (${res.status})`);
      }

      const rewrite = await res.json();
      setRewrites((prev) => [rewrite, ...prev]);
      setShowForm(false);
      setComment("");
      setChanges({});
      setActiveField(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(rewriteId: string, direction: "up" | "down") {
    const headers = await getAuthHeaders();
    if (!headers) return;

    const res = await fetch(`${API_URL}/api/goals/${goalId}/rewrites/${rewriteId}/vote`, {
      method: "POST",
      headers,
      body: JSON.stringify({ direction }),
    });

    if (res.ok) {
      const { upvotes, downvotes } = await res.json();
      setRewrites((prev) =>
        prev.map((r) => r.id === rewriteId ? { ...r, upvotes, downvotes } : r)
      );
    }
  }

  const pending = rewrites.filter((r) => r.status === "pending");
  const resolved = rewrites.filter((r) => r.status !== "pending");

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.25rem" }}>Community Rewrites</h2>
        <button
          className="btn btn-primary"
          style={{ fontSize: "0.85rem" }}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "Suggest Rewrite"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Propose Changes</h3>

          {error && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{error}</p>}

          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn ${activeField === key || changes[key] ? "btn-primary" : ""}`}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.3rem 0.6rem",
                  background: changes[key] ? "var(--color-primary)" : activeField === key ? "var(--color-primary-light)" : "var(--color-border)",
                  color: changes[key] || activeField === key ? "white" : "var(--color-text)",
                }}
                onClick={() => setActiveField(activeField === key ? null : key)}
              >
                {label} {changes[key] ? " (edited)" : ""}
              </button>
            ))}
          </div>

          {activeField && (
            <label className="form-label" style={{ marginBottom: "1rem" }}>
              New {FIELD_LABELS[activeField]}
              <textarea
                className="form-input"
                value={changes[activeField] || ""}
                onChange={(e) => setChanges((prev) => ({ ...prev, [activeField]: e.target.value }))}
                rows={3}
                style={{ resize: "vertical" }}
                placeholder={`Enter your proposed ${FIELD_LABELS[activeField].toLowerCase()}...`}
              />
            </label>
          )}

          <label className="form-label" style={{ marginBottom: "1rem" }}>
            Why this rewrite?
            <textarea
              className="form-input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              style={{ resize: "vertical" }}
              placeholder="Explain what you're improving..."
              required
              minLength={5}
            />
          </label>

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ fontSize: "0.85rem" }}>
            {submitting ? "Submitting..." : "Submit Rewrite"}
          </button>
        </form>
      )}

      {pending.length === 0 && resolved.length === 0 && (
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
          No rewrites proposed yet. Think this goal could be sharper? Suggest a rewrite.
        </p>
      )}

      {pending.map((rewrite) => (
        <div key={rewrite.id} className="card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
            <span className="badge badge-primary" style={{ fontSize: "0.7rem" }}>Pending</span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
              {new Date(rewrite.createdAt).toLocaleDateString()}
            </span>
          </div>

          <p style={{ fontSize: "0.85rem", fontStyle: "italic", color: "var(--color-text-secondary)", marginBottom: "0.5rem" }}>
            &ldquo;{rewrite.comment}&rdquo;
          </p>

          <div style={{ marginBottom: "0.75rem" }}>
            {Object.entries(rewrite.changes).map(([key, value]) => (
              <div key={key} style={{ marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-primary)" }}>
                  {FIELD_LABELS[key] || key}:
                </span>
                <p style={{ fontSize: "0.85rem", margin: "0.15rem 0 0", paddingLeft: "0.5rem", borderLeft: "2px solid var(--color-accent-green)" }}>
                  {String(value)}
                </p>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              className="btn"
              style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem", background: "var(--color-accent-green)", color: "white" }}
              onClick={() => vote(rewrite.id, "up")}
            >
              Approve ({rewrite.upvotes})
            </button>
            <button
              className="btn"
              style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem", background: "var(--color-accent)", color: "white" }}
              onClick={() => vote(rewrite.id, "down")}
            >
              Reject ({rewrite.downvotes})
            </button>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
              Net: {rewrite.upvotes - rewrite.downvotes} / 5 needed
            </span>
          </div>
        </div>
      ))}

      {resolved.length > 0 && (
        <details style={{ marginTop: "0.75rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
            {resolved.length} resolved rewrite{resolved.length !== 1 ? "s" : ""}
          </summary>
          {resolved.map((rewrite) => (
            <div key={rewrite.id} className="card" style={{ marginTop: "0.5rem", opacity: 0.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className={`badge ${rewrite.status === "approved" ? "badge-green" : "badge-accent"}`} style={{ fontSize: "0.7rem" }}>
                  {rewrite.status}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                  {new Date(rewrite.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>&ldquo;{rewrite.comment}&rdquo;</p>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
