"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Comment {
  id: string;
  body: string;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

export default function FeedComments({ feedItemId }: { feedItemId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetch(`${API_URL}/api/feed/${feedItemId}/comments`)
      .then((r) => r.json())
      .then((d) => setComments(d.data || []))
      .catch(() => {});
  }, [feedItemId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Sign in to comment.");
        setSubmitting(false);
        return;
      }

      const res = await fetch(`${API_URL}/api/feed/${feedItemId}/comments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Error (${res.status})`);
      }

      const comment = await res.json();
      setComments((prev) => [comment, ...prev]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="feed-comments">
      <div className="feed-comments-header">
        <span className="feed-comments-label">Commentary</span>
        <span className="feed-comments-count">{comments.length} comment{comments.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="feed-comment-form">
        {error && <p className="form-error" style={{ marginBottom: "0.5rem", fontSize: "0.8rem" }}>{error}</p>}
        <textarea
          className="form-input feed-comment-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add your commentary..."
          rows={2}
          minLength={5}
          maxLength={1000}
          required
        />
        <button
          type="submit"
          className="btn btn-primary feed-comment-submit"
          disabled={submitting || body.length < 5}
        >
          {submitting ? "Posting..." : "Post"}
        </button>
      </form>

      {/* Comments list */}
      {comments.map((comment) => (
        <div key={comment.id} className="feed-comment">
          <p className="feed-comment-body">{comment.body}</p>
          <span className="feed-comment-meta">
            {new Date(comment.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
      ))}

      {comments.length === 0 && (
        <p className="feed-comments-empty">No comments yet. Be the first.</p>
      )}
    </div>
  );
}
