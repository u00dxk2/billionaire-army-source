"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function ProposePersonForm() {
  const [form, setForm] = useState({
    name: "",
    reason: "",
    industry: [""],
    state: "",
    wikidataId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Canon Wave 3 (Rules 21/31): say the sign-in requirement UP FRONT, not
  // after the user has filled the whole form.
  const [isGuest, setIsGuest] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsGuest(!session);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateIndustry(index: number, value: string) {
    setForm((prev) => {
      const industry = [...prev.industry];
      industry[index] = value;
      return { ...prev, industry };
    });
  }

  function addIndustry() {
    setForm((prev) => ({ ...prev, industry: [...prev.industry, ""] }));
  }

  function removeIndustry(index: number) {
    setForm((prev) => ({
      ...prev,
      industry: prev.industry.filter((_, i) => i !== index),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("You must be signed in to propose a billionaire.");
        setSubmitting(false);
        return;
      }

      const body = {
        name: form.name,
        reason: form.reason,
        industry: form.industry.filter((s) => s.trim().length > 0),
        state: form.state || undefined,
        wikidataId: form.wikidataId || undefined,
      };

      const res = await fetch(`${API_URL}/api/persons/propose`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Server error (${res.status})`);
      }

      setSuccess(true);
      setForm({ name: "", reason: "", industry: [""], state: "", wikidataId: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit proposal");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="auth-card" style={{ maxWidth: "640px" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Billionaire Proposed!</h2>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem" }}>
          Your proposal has been submitted for review. Once approved, it will appear on the index.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <a href="/billionaires" className="btn btn-primary">View Profiles</a>
          <button className="btn btn-primary" style={{ background: "var(--color-accent-green)" }} onClick={() => setSuccess(false)}>
            Propose Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-card" style={{ maxWidth: "640px" }}>
      <h2 style={{ marginBottom: "0.25rem" }}>Propose a Billionaire</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Know a U.S. billionaire who should be on the index? Propose them here.
        Proposals are reviewed before going live.
      </p>

      {isGuest && (
        <p className="form-notice" role="status">
          Submitting requires an account — <a href="/login">sign in</a> first so
          you don&apos;t lose what you type here.
        </p>
      )}

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="auth-form" style={{ marginTop: 0 }}>
        <label className="form-label">
          Full Name
          <input className="form-input" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g., MacKenzie Scott" required minLength={2} maxLength={200} />
        </label>

        <label className="form-label">
          Why should they be included?
          <textarea className="form-input" value={form.reason} onChange={(e) => update("reason", e.target.value)} placeholder="Explain why this person qualifies as a U.S. billionaire with public relevance..." required minLength={10} maxLength={1000} rows={3} style={{ resize: "vertical" }} />
        </label>

        <label className="form-label">
          State (optional)
          <input className="form-input" value={form.state} onChange={(e) => update("state", e.target.value)} placeholder="e.g., Washington" maxLength={100} />
        </label>

        <fieldset style={{ border: "none", padding: 0 }}>
          <legend className="form-label" style={{ marginBottom: "0.5rem" }}>Industries</legend>
          {form.industry.map((ind, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input className="form-input" style={{ flex: 1 }} value={ind} onChange={(e) => updateIndustry(i, e.target.value)} placeholder={`Industry ${i + 1}`} />
              {form.industry.length > 1 && (
                <button type="button" onClick={() => removeIndustry(i)} className="btn" style={{ background: "var(--color-border)", color: "var(--color-text)", padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>Remove</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addIndustry} className="btn" style={{ background: "var(--color-border)", color: "var(--color-text)", fontSize: "0.8rem" }}>+ Add Industry</button>
        </fieldset>

        <label className="form-label">
          Wikidata ID (optional)
          <input className="form-input" value={form.wikidataId} onChange={(e) => update("wikidataId", e.target.value)} placeholder="e.g., Q18918145" maxLength={50} />
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
            Find it at wikidata.org — helps us auto-import facts.
          </span>
        </label>

        <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Proposal"}
        </button>
      </div>
    </form>
  );
}
