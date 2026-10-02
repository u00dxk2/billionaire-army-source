"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { authErrorMessage } from "@/lib/auth-error";

export const dynamic = "force-dynamic";

// Shown when a confirmation link bounces back through /auth/callback. Covers both
// real cases without guessing which one this is: the link was already used (the
// account is fine — sign in), or it expired (sign up again with the same email and
// a fresh link is sent).
const AUTH_LINK_FAILED =
  "That confirmation link didn't work — it may have expired or already been used. If you already confirmed your email, just sign in below. If not, choose Create one and use the same email to get a fresh link.";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const supabase = createClient();

  // /auth/callback sends a failed or expired confirmation link here as ?error=auth.
  // This page used to ignore it, so the person landed on a plain Sign In form with no
  // idea whether they were confirmed. Read with window.location rather than
  // useSearchParams so the page needs no Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      setError(AUTH_LINK_FAILED);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (mode === "reset") {
      // Point straight at /reset-password, NOT through /auth/callback: that route is a
      // SERVER handler, and Supabase returns the recovery tokens in the URL *fragment*
      // whenever PKCE isn't in play (verified 2026-07-21 — see R-033). Fragments never
      // reach the server, so the callback would see no code and bounce the user to
      // /login?error=auth. The client page below handles both ?code= and #access_token=.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(authErrorMessage(resetError));
      } else {
        setMessage("If that email has an account, a reset link is on its way.");
      }
    } else if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (signUpError) {
        setError(authErrorMessage(signUpError));
      } else {
        // NOT an unconditional "check your email" (B-024, 2026-08-09). Signing up with an
        // address that ALREADY has a confirmed account is GoTrue's anti-enumeration path:
        // it returns 200 with a FABRICATED confirmation_sent_at and a FAKE random user id,
        // and sends nothing. Measured against this project on 2026-08-09 — that call
        // returns in ~101ms with identities.length === 0, against ~1214ms and length 1 for
        // a real send. So the old copy told a returning user to wait for an email that
        // could never arrive, which is exactly how the founder's own signup dead-ended and
        // sent four days of investigation into SPF, DMARC and the SendGrid credential.
        // Phrased to cover both branches without confirming whether the address is
        // registered — the same non-enumerating posture the reset path above already uses.
        setMessage(
          "If that email is new, a confirmation link is on its way. If you already have an account, nothing was sent — sign in instead, or use Forgot password."
        );
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(authErrorMessage(signInError));
      } else {
        window.location.href = "/";
      }
    }

    setLoading(false);
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="page-title">
          {mode === "login"
            ? "Sign In"
            : mode === "signup"
            ? "Create Account"
            : "Reset Password"}
        </h1>
        <p className="page-subtitle">
          {mode === "login"
            ? "Sign in to vote, rate goals, and track billionaire accountability."
            : mode === "signup"
            ? "Join the army. Help define what matters."
            : "Enter your email and we'll send you a link to set a new password."}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="form-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="form-input"
              placeholder="you@example.com"
            />
          </label>

          {mode !== "reset" && (
            <label className="form-label">
              Password
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
          )}

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

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading
              ? "..."
              : mode === "login"
              ? "Sign In"
              : mode === "signup"
              ? "Create Account"
              : "Send Reset Link"}
          </button>
        </form>

        {mode === "login" && (
          <p className="auth-toggle">
            <button onClick={() => setMode("reset")} className="link-btn">
              Forgot password?
            </button>
          </p>
        )}

        <p className="auth-toggle">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button onClick={() => setMode("signup")} className="link-btn">
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button onClick={() => setMode("login")} className="link-btn">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
