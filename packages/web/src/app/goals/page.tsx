import { apiFetch } from "@/lib/api";

interface Goal {
  id: string;
  title: string;
  problemStatement: string;
  scope: string;
  targetMetric: string;
  deadline: string;
  priorityScore: string;
  smartnessScore: string;
  status: string;
}

interface GoalsResponse {
  data: Goal[];
  pagination: { page: number; limit: number; total: number };
}

export default async function GoalsPage() {
  let goals: GoalsResponse | null = null;
  let error: string | null = null;

  try {
    goals = await apiFetch<GoalsResponse>("/api/goals?limit=50&status=active", {
      next: { revalidate: 60 },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load goals";
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">The Assignment</h1>
        <a href="/goals/propose" className="btn btn-approve btn-sm">
          + Write one
        </a>
      </div>
      {/* R-053: "Civic Goals" was the most institutional phrase on the site, and it sat on the
          one page where the PUBLIC does the work. "The Assignment" resolves the army metaphor at
          the moment it needs resolving, without claiming any billionaire has accepted one — the
          last sentence is the honest version of what the old copy implied by omission, and it is
          more damning than the implication was. The ROUTE stays /goals: renaming a URL breaks
          every existing link for a copy change, and nobody reads URLs. */}
      <p className="page-subtitle">
        What the public says needs doing, with a number and a deadline attached. Anyone can
        write one. Anyone can rate one. Nobody has to accept it — that is what makes the
        record interesting.
      </p>

      {error && (
        <p style={{ color: "var(--color-accent)" }}>
          {error} — try refreshing in a moment.
        </p>
      )}

      <div className="card-grid">
        {goals?.data.map((goal) => (
          <a
            key={goal.id}
            href={`/goals/${goal.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="card goal-card">
              <div className="goal-card-header">
                <h3 className="goal-card-title">{goal.title}</h3>
                <span className="pbs-chip">
                  {Number(goal.priorityScore) > 0
                    ? `Priority ${Number(goal.priorityScore).toFixed(1)}`
                    : "Not yet rated"}
                </span>
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <span className="badge badge-outline">{goal.scope}</span>
              </div>
              <p className="goal-card-body">
                {goal.problemStatement.slice(0, 150)}
                {goal.problemStatement.length > 150 ? "..." : ""}
              </p>
              <div className="goal-card-footer">
                <span>Target: {goal.targetMetric}</span>
                <span>Due: {goal.deadline}</span>
              </div>
            </div>
          </a>
        ))}

        {goals?.data.length === 0 && (
          <div className="empty-state">
            <p>No goals yet.</p>
            <p className="empty-hint">
              Be the first — <a href="/goals/propose">propose a goal</a> for the public to rate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
