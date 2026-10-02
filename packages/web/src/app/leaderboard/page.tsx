import { apiFetch } from "@/lib/api";
import LeaderboardView from "@/components/LeaderboardView";

interface LeaderboardEntry {
  person: { id: string; name: string; state: string | null; industry: string[] };
  pbs: string | null;
  features: Record<string, number> | null;
}

interface LeaderboardResponse {
  data: LeaderboardEntry[];
}

export default async function LeaderboardPage() {
  let leaderboard: LeaderboardResponse | null = null;
  let error: string | null = null;

  try {
    leaderboard = await apiFetch<LeaderboardResponse>(
      "/api/persons/leaderboard?limit=2000",
      { next: { revalidate: 60 } }
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load leaderboard";
  }

  return (
    <div>
      <h1 className="page-title">Leaderboard</h1>
      <p className="page-subtitle">
        Ranked by giving score. Open formula, adjustable weights.
        Filter by state or industry to find the best billionaire near you.
        People we hold no charitable giving record for are listed at the end as Not graded,
        never ranked.
      </p>

      {error && (
        <p style={{ color: "var(--color-accent)" }}>
          {error} — try refreshing in a moment.
        </p>
      )}

      {leaderboard?.data && leaderboard.data.length > 0 ? (
        <LeaderboardView entries={leaderboard.data} />
      ) : (
        !error && (
          <div className="empty-state">
            <p>No scores yet. Scores are computed after data is seeded.</p>
          </div>
        )
      )}
    </div>
  );
}
