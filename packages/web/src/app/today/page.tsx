import { apiFetch } from "@/lib/api";
import DailySwipe from "@/components/DailySwipe";

export const dynamic = "force-dynamic";

interface Person {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  badges: { givingPledge?: boolean };
  images: string[];
  pbs: string | null;
  highlights: {
    netWorth: string | null;
    summary: string | null;
    political: { total: string; topRecipient: string; partyBreakdown: Record<string, number> } | null;
    philanthropy: { totalAssets: string; totalGrants: string; foundations: number } | null;
    givingPledge: boolean;
    receiptHook: { tag: string; text: string } | null;
    factCount: number;
  } | null;
}

interface DailyTenResponse {
  data: Person[];
  date: string;
}

export default async function TodayPage() {
  let daily: DailyTenResponse | null = null;
  let error: string | null = null;

  try {
    daily = await apiFetch<DailyTenResponse>("/api/persons/daily-ten", {
      cache: "no-store",
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load today's profiles";
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      <div className="daily-hero">
        <span className="hero-badge">Daily Briefing</span>
        <h1 className="daily-hero-title">Today&apos;s 10</h1>
        <p className="daily-hero-date">{dateStr}</p>
        <p className="daily-hero-desc">
          Ten billionaires, fresh daily — each with a sourced receipt: net worth, giving, and the grade.
          <br />
          You decide: approve or disapprove. Your call shapes the scoreboard.
        </p>
      </div>

      {error && (
        <p style={{ color: "var(--color-accent)", textAlign: "center", padding: "1rem" }}>
          {error} — try refreshing in a moment.
        </p>
      )}

      {daily?.data && daily.data.length > 0 && (
        <DailySwipe persons={daily.data} date={daily.date} />
      )}
    </div>
  );
}
