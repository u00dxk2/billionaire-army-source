"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type PendingPerson = {
  id: string;
  name: string;
  industry: string[];
  state: string | null;
  wikidataId: string | null;
  proposalReason: string | null;
  proposedBy: string | null;
  createdAt: string;
};

type Status = "loading" | "unauthed" | "forbidden" | "ready" | "error";

export default function AdminReview() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPerson[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const supabase = createClient();

  const authHeader = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? `Bearer ${session.access_token}` : null;
  }, [supabase]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setStatus("unauthed");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/persons/pending`, {
        headers: { Authorization: auth },
      });
      if (res.status === 401) return setStatus("unauthed");
      if (res.status === 403) return setStatus("forbidden");
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json = await res.json();
      setPending(json.data ?? []);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
      setStatus("error");
    }
  }, [authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, action: "approve" | "reject") {
    setActing(id);
    setError(null);
    try {
      const auth = await authHeader();
      if (!auth) return setStatus("unauthed");
      const res = await fetch(`${API_URL}/api/persons/${id}/review`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      // Drop the just-reviewed row from the queue.
      setPending((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  if (status === "loading") {
    return <div className="auth-card" style={{ maxWidth: "760px" }}><p>Loading review queue…</p></div>;
  }

  if (status === "unauthed") {
    return (
      <div className="auth-card" style={{ maxWidth: "760px" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Sign in required</h2>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem" }}>
          The review queue is for site moderators. Please sign in.
        </p>
        <a href="/login" className="btn btn-primary">Sign In</a>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="auth-card" style={{ maxWidth: "760px" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Not authorized</h2>
        <p style={{ color: "var(--color-text-secondary)" }}>
          Your account doesn&apos;t have moderator access.
        </p>
      </div>
    );
  }

  return (
    <div className="auth-card" style={{ maxWidth: "760px", width: "100%" }}>
      <h2 style={{ marginBottom: "0.25rem" }}>Review Queue</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        User-proposed billionaires awaiting moderation. Approved proposals become
        publicly visible on the index; rejected ones stay hidden.
      </p>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {pending.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>
          Nothing to review right now. New proposals will appear here.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {pending.map((p) => (
            <div
              key={p.id}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                padding: "1rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "1.05rem" }}>{p.name}</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>

              {p.proposalReason && (
                <p style={{ margin: "0.5rem 0", fontSize: "0.9rem" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>Reason: </span>
                  {p.proposalReason}
                </p>
              )}

              <p style={{ margin: "0.25rem 0", fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                {p.industry?.length ? p.industry.join(", ") : "No industry"}
                {p.state ? ` · ${p.state}` : ""}
                {p.wikidataId ? ` · ${p.wikidataId}` : ""}
              </p>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button
                  className="btn btn-primary"
                  style={{ background: "var(--color-accent-green)" }}
                  disabled={acting === p.id}
                  onClick={() => review(p.id, "approve")}
                >
                  {acting === p.id ? "…" : "Approve"}
                </button>
                <button
                  className="btn"
                  style={{ background: "var(--color-border)", color: "var(--color-text)" }}
                  disabled={acting === p.id}
                  onClick={() => review(p.id, "reject")}
                >
                  {acting === p.id ? "…" : "Reject"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
