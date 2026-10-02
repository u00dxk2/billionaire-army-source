import { apiFetch } from "@/lib/api";
import FeedView from "@/components/FeedView";
import type { FeedItem } from "@/lib/feed-types";

export const dynamic = "force-dynamic";

interface FeedResponse {
  data: FeedItem[];
  pagination: { page: number; limit: number; total: number; promotedCount?: number };
}

// Journey-walk 2026-06-25: the cold first scroll repeats the same billionaire
// (Gates ×3, Musk ×3, Ullal ×2 — one card's own summary admits it's a
// duplicate), which reads as an auto-aggregator on a curated-receipts brand.
// Collapse the displayed feed to the strongest (most-recent) card per person.
// owner-greenlit 2026-06-26 (in-session): dedup is now the DEFAULT for all
// traffic (was staged opt-in behind ?dedup=1). The flag stays as a reversible
// kill-switch — no code revert needed to roll back:
//   - default (no env, no param)      → dedup ON for every visitor.
//   - NEXT_PUBLIC_FEED_DEDUP === "0"  → global kill-switch (set on Render to
//     disable platform-wide without a code change). Full revert = git revert.
//   - ?dedup=1 / ?dedup=0             → per-request override for the headless
//     before/after preview, zero deploy. The query param wins over the env.
function feedDedupEnabled(envKill: boolean, param?: string): boolean {
  if (param === "1") return true;
  if (param === "0") return false;
  return !envKill;
}

function feedFreshness(items: FeedItem[]): { label: string; days: number } | null {
  let newest = 0;
  for (const item of items) {
    const t = new Date(item.createdAt).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!newest) return null;
  return {
    label: new Date(newest).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    days: Math.floor((Date.now() - newest) / 86_400_000),
  };
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ dedup?: string }>;
}) {
  const { dedup } = await searchParams;
  const dedupByPerson = feedDedupEnabled(
    process.env.NEXT_PUBLIC_FEED_DEDUP === "0",
    dedup
  );

  let feed: FeedResponse | null = null;
  let error: string | null = null;

  try {
    feed = await apiFetch<FeedResponse>("/api/feed?limit=20", {
      cache: "no-store",
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load feed";
  }

  const freshness = feedFreshness(feed?.data || []);

  return (
    <div>
      <div className="feed-hero">
        <span className="hero-badge">Accountability Feed</span>
        <h1 className="feed-hero-title">The Feed</h1>
        <p className="feed-hero-desc">
          Billionaire news — enriched with political donations, foundation data,
          and a giving grade — how much of their wealth
          they actually give. The grade rates their giving record, not the story
          it sits beside. Facts first.
        </p>
        {freshness && (
          <p
            className={`feed-freshness${
              freshness.days > 7 ? " feed-freshness--stale" : ""
            }`}
          >
            {freshness.days > 7
              ? `Last updated ${freshness.label} — ${freshness.days} days ago. New items appear here as fresh reporting is curated.`
              : `Updated ${freshness.label}`}
          </p>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--color-accent)", textAlign: "center", padding: "1rem" }}>
          {error} — try refreshing in a moment.
        </p>
      )}

      <FeedView
        initialItems={feed?.data || []}
        initialTotal={feed?.pagination?.total || 0}
        dedupByPerson={dedupByPerson}
      />
    </div>
  );
}
