import { apiFetch } from "@/lib/api";
import { SMART_LABELS } from "@ba/shared";
import SmartRatingForm from "@/components/SmartRatingForm";
import GoalRewrites from "@/components/GoalRewrites";

interface Kpi {
  name: string;
  unit: string;
  baselineValue: number;
  targetValue: number;
}

interface Milestone {
  title: string;
  targetDate: string;
  targetValue?: string;
  status: "pending" | "reached" | "missed";
}

interface GoalDetail {
  id: string;
  title: string;
  problemStatement: string;
  scope: string;
  baselineMetric: string;
  baselineSourceUrl: string;
  baselineRetrievedAt: string;
  targetMetric: string;
  deadline: string;
  interventions: string[];
  kpis: Kpi[];
  milestones: Milestone[];
  risksAndExternalities: string | null;
  smartRatings: Record<string, number> | null;
  priorityScore: string;
  smartnessScore: string;
  status: string;
}

interface GoalMatch {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  images: string[];
  pbs: string | null;
  reasons: { type: string; label: string }[];
  matchScore: number;
}

interface MatchesResponse {
  data: GoalMatch[];
  heuristic: { states: string[]; industries: string[]; note: string };
}

const CHIP_STYLES: Record<string, { background: string; color: string }> = {
  state: { background: "var(--color-primary-soft)", color: "var(--color-primary)" },
  industry: { background: "var(--color-accent-green-soft)", color: "var(--color-accent-green)" },
  capacity: { background: "var(--color-amber-soft)", color: "var(--color-amber)" },
};

function GoalMatchesSection({ matches }: { matches: MatchesResponse }) {
  if (!matches.data.length) return null;
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h3>Billionaires Positioned to Move This Goal</h3>
      <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginTop: "0.35rem" }}>
        {matches.heuristic.note}
      </p>
      <div className="goal-matches-grid">
        {matches.data.map((m) => (
          <a key={m.id} href={`/billionaires/${m.id}`} className="goal-match-card">
            {m.images?.[0] ? (
              <img src={m.images[0]} alt={m.name} className="goal-match-photo" />
            ) : (
              <div className="goal-match-avatar">
                {m.name.split(" ").map((n) => n[0]).join("")}
              </div>
            )}
            <div className="goal-match-info">
              <div className="goal-match-name">{m.name}</div>
              <div className="goal-match-chips">
                {m.reasons.map((r, i) => (
                  <span
                    key={i}
                    className="goal-match-chip"
                    style={CHIP_STYLES[r.type] ?? CHIP_STYLES.capacity}
                  >
                    {r.label}
                  </span>
                ))}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let goal: GoalDetail | null = null;
  let matches: MatchesResponse | null = null;
  let error: string | null = null;

  try {
    goal = await apiFetch<GoalDetail>(`/api/goals/${id}`, {
      next: { revalidate: 60 },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load goal";
  }

  try {
    matches = await apiFetch<MatchesResponse>(`/api/goals/${id}/matches`, {
      next: { revalidate: 300 },
    });
  } catch {
    // Matches are additive — the goal page renders fine without them
  }

  if (error || !goal) {
    // Canon Wave 2 S1: teach the next action instead of dead-ending.
    return (
      <div className="detail-miss">
        <p>That goal couldn&apos;t be loaded — it may have been removed, or the link is wrong.</p>
        <p>
          See <a href="/goals">all civic goals</a> or head <a href="/">home</a>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <a href="/goals" style={{ color: "var(--color-primary)", fontSize: "0.85rem" }}>
        &larr; All Goals
      </a>

      <div style={{ marginTop: "1.5rem" }}>
        <h1 className="page-title">{goal.title}</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="badge badge-primary">{goal.scope}</span>
          {Number(goal.priorityScore) > 0 ? (
            <span className="pbs-chip" style={{ fontSize: "0.8rem" }}>
              Priority: {Number(goal.priorityScore).toFixed(1)}
            </span>
          ) : null}
          {Number(goal.smartnessScore) > 0 ? (
            <span className="pbs-chip" style={{ fontSize: "0.8rem", background: "var(--color-accent-green)" }}>
              SMART: {Number(goal.smartnessScore).toFixed(1)}
            </span>
          ) : null}
          {Number(goal.priorityScore) <= 0 && Number(goal.smartnessScore) <= 0 && (
            <span className="pbs-chip" style={{ fontSize: "0.8rem" }}>
              Not yet rated — be the first below
            </span>
          )}
        </div>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h3>Problem Statement</h3>
          <p style={{ marginTop: "0.5rem" }}>{goal.problemStatement}</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
          <div className="card">
            <h3>Baseline</h3>
            <p style={{ marginTop: "0.5rem" }}>{goal.baselineMetric}</p>
            <a
              href={goal.baselineSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              Source — {new Date(goal.baselineRetrievedAt).toLocaleDateString()}
            </a>
          </div>
          <div className="card">
            <h3>Target</h3>
            <p style={{ marginTop: "0.5rem" }}>{goal.targetMetric}</p>
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
              Deadline: {goal.deadline}
            </p>
          </div>
        </div>

        {goal.interventions.length > 0 && (
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Interventions</h3>
            <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
              {goal.interventions.map((intervention, i) => (
                <li key={i}>{intervention}</li>
              ))}
            </ul>
          </div>
        )}

        {goal.kpis && goal.kpis.length > 0 && (
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Key Performance Indicators</h3>
            <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginTop: "0.75rem" }}>
              {goal.kpis.map((kpi, i) => {
                const range = kpi.targetValue - kpi.baselineValue;
                const progress = range !== 0 ? ((0 - 0) / range) * 100 : 0;
                return (
                  <div key={i} style={{ padding: "0.75rem", background: "var(--color-bg)", borderRadius: "var(--radius)", border: "1px solid var(--color-border-light)" }}>
                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: "0.25rem" }}>{kpi.name}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                      <span>{kpi.baselineValue} {kpi.unit}</span>
                      <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>{kpi.targetValue} {kpi.unit}</span>
                    </div>
                    <div style={{ height: "6px", background: "var(--color-border)", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: "var(--color-accent-green)", borderRadius: "3px" }} />
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--color-text-secondary)", marginTop: "0.25rem" }}>
                      Baseline &rarr; Target
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {goal.milestones && goal.milestones.length > 0 && (
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Milestones</h3>
            <div style={{ marginTop: "0.75rem" }}>
              {goal.milestones.map((ms, i) => {
                const isLast = i === goal.milestones.length - 1;
                const statusColor = ms.status === "reached" ? "var(--color-accent-green)" : ms.status === "missed" ? "var(--color-accent)" : "var(--color-border)";
                return (
                  <div key={i} style={{ display: "flex", gap: "0.75rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{
                        width: "14px", height: "14px", borderRadius: "50%",
                        border: `3px solid ${statusColor}`,
                        background: ms.status === "reached" ? statusColor : "var(--color-surface)",
                        flexShrink: 0,
                      }} />
                      {!isLast && (
                        <div style={{ width: "2px", flex: 1, background: "var(--color-border)", minHeight: "24px" }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: isLast ? 0 : "1rem" }}>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{ms.title}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                        {new Date(ms.targetDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                        {ms.status !== "pending" && (
                          <span className={`badge ${ms.status === "reached" ? "badge-green" : "badge-accent"}`} style={{ marginLeft: "0.5rem" }}>
                            {ms.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {matches && <GoalMatchesSection matches={matches} />}

        {goal.smartRatings && (
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Community SMART Ratings</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem", marginTop: "0.75rem" }}>
              {(Object.entries(SMART_LABELS) as [string, string][]).map(([key, label]) => (
                <div key={key} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-primary)" }}>
                    {goal.smartRatings?.[key]?.toFixed(1) ?? "—"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {goal.risksAndExternalities && (
          <div className="card" style={{ marginTop: "1rem" }}>
            <h3>Risks &amp; Externalities</h3>
            <p style={{ marginTop: "0.5rem" }}>{goal.risksAndExternalities}</p>
          </div>
        )}

        <SmartRatingForm goalId={goal.id} currentRatings={goal.smartRatings} />

        <GoalRewrites goalId={goal.id} />
      </div>
    </div>
  );
}
