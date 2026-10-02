"use client";

/**
 * Comment moderation panel for /admin.
 *
 * WHY THIS EXISTS (2026-07-28): the moderation BACKEND shipped without its
 * frontend. `GET /api/feed/comments/recent` and
 * `POST /api/feed/comments/:commentId/moderate` were built, gated by the
 * fail-closed ADMIN_USER_IDS allowlist, documented in CLAUDE.md, and pinned by
 * the invariant that every public comment read filters `flagged = false` — but
 * nothing in the product ever called them. The first time a human posted a real
 * comment and went looking for the hide control, there wasn't one.
 *
 * That is the project's own lesson one level down: a feature nobody has used is
 * UNKNOWN, and a feature with no way to reach it is UNREACHABLE — regardless of
 * how well the route behind it is tested.
 *
 * Soft-hide semantics: moderating sets `flagged`, it does not delete. Hidden
 * comments stay in the table (and in THIS list) so a takedown decision remains
 * auditable and reversible. Restore is the same endpoint with `hidden: false`.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Comment = {
  id: string;
  body: string;
  flagged: boolean;
  createdAt: string;
  feedItemId: string;
  userId: string;
};

type Status = "loading" | "unauthed" | "forbidden" | "ready" | "error";

export default function AdminComments() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
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
      const res = await fetch(`${API_URL}/api/feed/comments/recent`, {
        headers: { Authorization: auth },
      });
      if (res.status === 401) return setStatus("unauthed");
      if (res.status === 403) return setStatus("forbidden");
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json = await res.json();
      setComments(json.data ?? []);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments");
      setStatus("error");
    }
  }, [authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  async function moderate(id: string, hidden: boolean) {
    setActing(id);
    setError(null);
    try {
      const auth = await authHeader();
      if (!auth) return setStatus("unauthed");
      const res = await fetch(`${API_URL}/api/feed/comments/${id}/moderate`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const updated = await res.json();
      // Keep the row and flip its state in place — a hidden comment must stay
      // visible HERE so it can be restored. Trust the server's returned row
      // rather than assuming the write took the value we sent.
      setComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, flagged: updated.flagged } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  if (status === "loading") {
    return (
      <div className="auth-card" style={{ maxWidth: "760px", width: "100%" }}>
        <p>Loading comments…</p>
      </div>
    );
  }

  // Sign-in and authorization states are handled by the sibling review panel on
  // this page; rendering a second copy of the same message would just be noise.
  if (status === "unauthed" || status === "forbidden") return null;

  const hiddenCount = comments.filter((c) => c.flagged).length;

  return (
    <div className="auth-card" style={{ maxWidth: "760px", width: "100%" }}>
      <h2 style={{ marginBottom: "0.25rem" }}>Comments</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        The 100 most recent comments, hidden ones included. Hiding is reversible and
        does not delete — a hidden comment disappears from the public feed and its
        counts, but stays here so the decision can be reviewed or undone.
        {hiddenCount > 0 && ` ${hiddenCount} currently hidden.`}
      </p>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {comments.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>No comments yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {comments.map((c) => (
            <div
              key={c.id}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                padding: "1rem",
                opacity: c.flagged ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                  {new Date(c.createdAt).toLocaleString()}
                </span>
                {c.flagged && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      // --color-amber is the real token; the palette has no red.
                      color: "var(--color-amber)",
                      fontWeight: 600,
                    }}
                  >
                    Hidden
                  </span>
                )}
              </div>

              <p style={{ margin: "0.5rem 0", fontSize: "0.95rem", whiteSpace: "pre-wrap" }}>
                {c.body}
              </p>

              <p style={{ margin: "0.25rem 0", fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                on <a href={`/feed/${c.feedItemId}`}>this card</a>
              </p>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                {c.flagged ? (
                  <button
                    className="btn"
                    style={{ background: "var(--color-border)", color: "var(--color-text)" }}
                    disabled={acting === c.id}
                    onClick={() => moderate(c.id, false)}
                  >
                    {acting === c.id ? "…" : "Restore"}
                  </button>
                ) : (
                  <button
                    className="btn"
                    style={{ background: "var(--color-border)", color: "var(--color-text)" }}
                    disabled={acting === c.id}
                    onClick={() => moderate(c.id, true)}
                  >
                    {acting === c.id ? "…" : "Hide"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
