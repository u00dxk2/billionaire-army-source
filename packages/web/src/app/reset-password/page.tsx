"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { authErrorMessage } from "@/lib/auth-error";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Memoized: createClient() returns a new object each call, which would re-fire the
  // effect below on every render.
  const supabase = useMemo(() => createClient(), []);

  // The recovery link lands here directly. supabase-js picks the session up off the URL
  // itself (detectSessionInUrl) — either a PKCE `?code=` or an implicit `#access_token=`
  // fragment — and does it asynchronously, so listen as well as check once.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setHasSession(true);
        setChecking(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setHasSession(true);
        setChecking(false);
      } else {
        // ponytail: give detectSessionInUrl a beat before declaring the link dead,
        // so a valid link doesn't flash "invalid" for a frame.
        setTimeout(() => setChecking(false), 1500);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(authErrorMessage(updateError));
    } else {
      setMessage("Password updated. Taking you back to the site...");
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="page-title">Set a New Password</h1>

        {checking ? (
          <p className="page-subtitle" role="status">
            Checking your reset link...
          </p>
        ) : !hasSession ? (
          <>
            <p className="page-subtitle">
              This reset link is invalid or has expired. Reset links are single-use and
              time-limited.
            </p>
            <a href="/login" className="btn btn-primary btn-full">
              Request a new one
            </a>
          </>
        ) : (
          <>
            <p className="page-subtitle">Choose a new password for your account.</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <label className="form-label">
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="form-input"
                  placeholder="At least 6 characters"
                />
              </label>

              <label className="form-label">
                Confirm new password
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  className="form-input"
                  placeholder="Type it again"
                />
              </label>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="form-success" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading}
              >
                {loading ? "..." : "Update Password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
