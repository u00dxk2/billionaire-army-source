import { apiFetch } from "@/lib/api";
import FeedCardSolo from "@/components/FeedCardSolo";
import type { FeedItem } from "@/lib/feed-types";

interface PersonsResponse {
  pagination: { total: number };
}

interface GoalsResponse {
  pagination: { total: number };
}

interface FeedResponse {
  data: FeedItem[];
}

interface FeedItemResponse {
  data: FeedItem;
}

// R-066, 2026-08-20 — THERE IS NOW ONE HERO. The owner: "kill the classic".
//
// This file used to carry two full hero variants behind `heroReceiptEnabled()`
// (NEXT_PUBLIC_HERO_RECEIPT + a ?hero= preview override). The receipt hero won:
// the first statement on the page is a billionaire's receipt, not our manifesto.
// The cost of the pair was real rather than theoretical — R-053's copy ship had
// to be applied twice on 2026-08-20 for exactly this reason.
//
// The receipt BLOCK is still conditional, and that is not a second hero: when the
// feed is thin or the API is down there is no card to show, so the hero renders
// without it. Deleting that path along with the variant would have left an empty
// home page on the one day the feed breaks.
//
// `NEXT_PUBLIC_HERO_RECEIPT` is now inert — nothing reads it. It is still SET on
// ba-web; removing a Render env var is a separate deliberate action, and an unread
// var is harmless. `?hero=classic` / `?hero=receipt` no longer do anything.

// Pick the card that lands the "fury → clarity → I have the receipt" gut-punch:
// the most-recent article that carries a full receipt (a tagged person, a
// verifiable source, a live PBS verdict, and a net-worth contrast). Falls back
// gracefully so the hero is never empty when the feed is thin.
function pickHeroReceipt(items: FeedItem[]): FeedItem | null {
  if (!items?.length) return null;
  const hasFullReceipt = (it: FeedItem) => {
    const ctx = it.contextData || {};
    return (
      (it.persons?.length ?? 0) > 0 &&
      Boolean(it.sourceUrl) &&
      ctx.pbs != null &&
      Boolean(ctx.netWorth)
    );
  };
  return (
    items.find(hasFullReceipt) ||
    items.find((it) => (it.persons?.length ?? 0) > 0 && Boolean(it.sourceUrl)) ||
    items[0]
  );
}

// Resolve which card the hero shows. A curated marquee pick wins over the
// auto-pick so a demo never opens on a weak card #1:
//   1. ?card=<id>                  — per-request preview (the owner eyeballs a candidate)
//   2. NEXT_PUBLIC_HERO_FEATURED_ID — a curated marquee pin. CLEARED 2026-07-25
//      and meant to stay that way: while set, the hero bypasses the R-040 punch
//      ranking entirely, and the last pin went stale for 19 days as the site's
//      first impression. The owner's rule — pin only for a deliberate campaign, with
//      an expiry date on the tracker item.
//   3. most-recent fully-sourced   — auto-pick fallback
// A targeted id is fetched via /api/feed/:id so it works even if the card has
// aged out of the top-20; if it 404s we fall through to the auto-pick.
async function resolveHeroReceipt(cardParam?: string): Promise<FeedItem | null> {
  const targetId = cardParam || process.env.NEXT_PUBLIC_HERO_FEATURED_ID || "";
  if (targetId) {
    try {
      const res = await apiFetch<FeedItemResponse>(
        `/api/feed/${encodeURIComponent(targetId)}`,
        { cache: "no-store" }
      );
      if (res?.data) return res.data;
    } catch {}
  }
  try {
    const feed = await apiFetch<FeedResponse>("/api/feed?limit=20", {
      cache: "no-store",
    });
    return pickHeroReceipt(feed?.data || []);
  } catch {
    return null;
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const { card } = await searchParams;

  let personCount = 0;
  let goalCount = 0;

  try {
    const persons = await apiFetch<PersonsResponse>("/api/persons?limit=1", {
      next: { revalidate: 300 },
    });
    personCount = persons?.pagination?.total ?? 0;
  } catch {}

  try {
    const goals = await apiFetch<GoalsResponse>("/api/goals?limit=1&status=active", {
      next: { revalidate: 300 },
    });
    goalCount = goals?.pagination?.total ?? 0;
  } catch {}

  const receipt: FeedItem | null = await resolveHeroReceipt(card);

  const stats = (personCount > 0 || goalCount > 0) && (
    <div className="hero-stats">
      {personCount > 0 && (
        <div className="hero-stat">
          <div className="hero-stat-value">{personCount.toLocaleString()}</div>
          <div className="hero-stat-label">Billionaires Tracked</div>
        </div>
      )}
      {goalCount > 0 && (
        <div className="hero-stat">
          <div className="hero-stat-value">{goalCount}</div>
          <div className="hero-stat-label">Active Goals</div>
        </div>
      )}
      <div className="hero-stat">
        <div className="hero-stat-value">5</div>
        <div className="hero-stat-label">Data Sources</div>
      </div>
    </div>
  );

  // ─── The hero (R-013 receipt hero; sole variant since R-066) ───
  // The first statement on the page is a billionaire's receipt, not our
  // manifesto. Anti-institutional, stakes-first.
  return (
    <div>
      <section className="hero">
        <span className="hero-badge">Every claim below is source-linked</span>
        <h1 className="hero-title hero-title--compact">Billionaire Army</h1>
        {/* R-053: the first line on the site that does any work with the name — until
            now "Billionaire Army" was a title with no idea attached. It is a statement
            about US, not about any named person, so it costs nothing to defend. The count
            is read LIVE, never hardcoded: it moved 1,102 -> 1,092 on 2026-08-19. */}
        <p className="hero-tagline">Enlisted, whether they like it or not.</p>
        <p className="hero-receipt-sub">
          You bring the argument. We bring the receipt —{" "}
          {personCount > 0 ? personCount.toLocaleString() : "every indexed"} American
          billionaires, scored on how much of their wealth they actually give away
          wherever we hold a record of their giving. Open formula, every figure linked to its filing.
        </p>

        {/* Conditional because the FEED can be thin or the API down — not because there
            is a second hero. Without a card the promise above still stands on its own;
            with one, it is demonstrated. */}
        {receipt && (
          <div className="hero-receipt">
            <span className="hero-receipt-eyebrow">Featured receipt</span>
            <div className="hero-receipt-card">
              <FeedCardSolo item={receipt} />
            </div>
            <p className="hero-receipt-legend">
              <strong>The giving score</strong> — how much of their
              wealth they actually give. Open, versioned, source-linked.
            </p>
            <a href="/feed" className="hero-receipt-more">
              See the full feed &rarr;
            </a>
          </div>
        )}

        <div className="hero-ctas">
          <a href="/today" className="btn btn-secondary">
            Start Today&apos;s 10
          </a>
          <a href="/billionaires" className="btn btn-secondary">
            Browse {personCount > 0 ? personCount.toLocaleString() : ""} Profiles
          </a>
          <a href="/leaderboard" className="btn btn-secondary">
            Leaderboard
          </a>
        </div>

        {stats}
      </section>
    </div>
  );
}
