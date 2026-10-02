"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function ProposeGoalForm() {
  const [form, setForm] = useState({
    title: "",
    problemStatement: "",
    scope: "",
    baselineMetric: "",
    baselineSourceUrl: "",
    targetMetric: "",
    deadline: "",
    interventions: [""],
    risksAndExternalities: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Canon Wave 3 (Rules 21/31): disclose the sign-in requirement up front.
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

  function updateIntervention(index: number, value: string) {
    setForm((prev) => {
      const interventions = [...prev.interventions];
      interventions[index] = value;
      return { ...prev, interventions };
    });
  }

  function addIntervention() {
    setForm((prev) => ({ ...prev, interventions: [...prev.interventions, ""] }));
  }

  function removeIntervention(index: number) {
    setForm((prev) => ({
      ...prev,
      interventions: prev.interventions.filter((_, i) => i !== index),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("You must be signed in to propose a goal.");
        setSubmitting(false);
        return;
      }

      const body = {
        ...form,
        interventions: form.interventions.filter((s) => s.trim().length > 0),
      };

      const res = await fetch(`${API_URL}/api/goals`, {
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
      setForm({
        title: "",
        problemStatement: "",
        scope: "",
        baselineMetric: "",
        baselineSourceUrl: "",
        targetMetric: "",
        deadline: "",
        interventions: [""],
        risksAndExternalities: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit goal");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="auth-card" style={{ maxWidth: "640px" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Goal Proposed!</h2>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem" }}>
          Your goal has been submitted for community review.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <a href="/goals" className="btn btn-primary">View Goals</a>
          <button className="btn btn-primary" style={{ background: "var(--color-accent-green)" }} onClick={() => setSuccess(false)}>
            Propose Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-card" style={{ maxWidth: "640px" }}>
      <h2 style={{ marginBottom: "0.25rem" }}>Propose a Goal</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Goals should be SMART: Specific, Measurable, Achievable, Relevant, and Time-bound.
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
          Title
          <input className="form-input" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g., Reduce Denver rent burden below 30%" required minLength={5} maxLength={200} />
        </label>

        <label className="form-label">
          Problem Statement
          <textarea className="form-input" value={form.problemStatement} onChange={(e) => update("problemStatement", e.target.value)} placeholder="Describe the problem this goal addresses..." required minLength={10} rows={3} style={{ resize: "vertical" }} />
        </label>

        <label className="form-label">
          Geographic Scope
          <input className="form-input" value={form.scope} onChange={(e) => update("scope", e.target.value)} placeholder="e.g., Denver Metro Area, CO" required minLength={5} />
        </label>

        <label className="form-label">
          Baseline Metric (current state)
          <input className="form-input" value={form.baselineMetric} onChange={(e) => update("baselineMetric", e.target.value)} placeholder="e.g., 52% of Denver renters are cost-burdened (2024)" required minLength={5} />
        </label>

        <label className="form-label">
          Baseline Source URL
          <input className="form-input" type="url" value={form.baselineSourceUrl} onChange={(e) => update("baselineSourceUrl", e.target.value)} placeholder="https://data.census.gov/..." required />
        </label>

        <label className="form-label">
          Target Metric (desired outcome)
          <input className="form-input" value={form.targetMetric} onChange={(e) => update("targetMetric", e.target.value)} placeholder="e.g., Reduce to &lt; 30% by 2030" required minLength={5} />
        </label>

        <label className="form-label">
          Deadline
          <input className="form-input" type="date" value={form.deadline} onChange={(e) => update("deadline", e.target.value)} required />
        </label>

        <fieldset style={{ border: "none", padding: 0 }}>
          <legend className="form-label" style={{ marginBottom: "0.5rem" }}>Proposed Interventions</legend>
          {form.interventions.map((intervention, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input className="form-input" style={{ flex: 1 }} value={intervention} onChange={(e) => updateIntervention(i, e.target.value)} placeholder={`Intervention ${i + 1}`} />
              {form.interventions.length > 1 && (
                <button type="button" onClick={() => removeIntervention(i)} className="btn" style={{ background: "var(--color-border)", color: "var(--color-text)", padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>Remove</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addIntervention} className="btn" style={{ background: "var(--color-border)", color: "var(--color-text)", fontSize: "0.8rem" }}>+ Add Intervention</button>
        </fieldset>

        <label className="form-label">
          Risks &amp; Externalities (optional)
          <textarea className="form-input" value={form.risksAndExternalities} onChange={(e) => update("risksAndExternalities", e.target.value)} placeholder="Any potential downsides or unintended consequences..." rows={2} style={{ resize: "vertical" }} />
        </label>

        <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Goal Proposal"}
        </button>
      </div>
    </form>
  );
}
