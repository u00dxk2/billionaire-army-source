"use client";

import { useState, Fragment } from "react";
import FeedCard from "./FeedCard";
import type { FeedItem } from "@/lib/feed-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const CATEGORIES = [
  { key: "", label: "All" },
  { key: "politics", label: "Politics" },
  { key: "philanthropy", label: "Philanthropy" },
  { key: "business", label: "Business" },
  { key: "sec_filing", label: "SEC Filing" },
  { key: "controversy", label: "Controversy" },
];

// Collapse the list to the strongest (most-recent) card per tagged person. The
// API returns items publishedAt-desc, so the first occurrence is the freshest.
// Untagged items (no person) are always kept — they can't be a per-person dup.
function dedupeByPerson(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const item of items) {
    const primary = item.persons?.[0]?.id;
    if (!primary) {
      out.push(item);
      continue;
    }
    if (seen.has(primary)) continue;
    seen.add(primary);
    out.push(item);
  }
  return out;
}

export default function FeedView({
  initialItems,
  initialTotal,
  dedupByPerson = false,
}: {
  initialItems: FeedItem[];
  initialTotal: number;
  dedupByPerson?: boolean;
}) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [activeCategory, setActiveCategory] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  async function fetchFeed(category: string, pageNum: number, append: boolean) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20", page: String(pageNum) });
      if (category) params.set("category", category);
      const res = await fetch(`${API_URL}/api/feed?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setItems(append ? (prev) => [...prev, ...data.data] : data.data);
      setTotal(data.pagination.total);
    } catch {
      // Keep existing items on error
    } finally {
      setLoading(false);
    }
  }

  function handleCategoryChange(category: string) {
    setActiveCategory(category);
    setPage(1);
    fetchFeed(category, 1, false);
  }

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFeed(activeCategory, nextPage, true);
  }

  function updateItem(id: string, updates: Partial<FeedItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }

  // Dedup the DISPLAYED list (flag-gated). Recomputed each render so it also
  // covers client-loaded pages (Load More) and category re-fetches.
  const displayItems = dedupByPerson ? dedupeByPerson(items) : items;

  // R-063 — only split the list when a promoted slice actually survived to the screen.
  // A category filter, a dedup pass or an older cached response can leave nothing
  // promoted, and a lone "Newest first" header over an unsplit list would be noise.
  const hasPromotedZone = displayItems.some((it) => it.promoted);

  return (
    <div className="feed-container">
      {/* Category tabs */}
      <div className="feed-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`feed-tab ${activeCategory === cat.key ? "feed-tab--active" : ""}`}
            aria-pressed={activeCategory === cat.key}
            onClick={() => handleCategoryChange(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Feed items */}
      <div className="feed-list">
        {displayItems.length === 0 && !loading && (
          <div className="feed-empty">
            {activeCategory ? (
              <>
                <p>Nothing in this category right now.</p>
                <p className="empty-hint">
                  Try another filter, or check back — the feed refreshes as new reporting lands.
                </p>
              </>
            ) : (
              <>
                <p>The feed is quiet for the moment.</p>
                <p className="empty-hint">
                  Fresh items land as new reporting comes in — check back soon.
                </p>
              </>
            )}
          </div>
        )}

        {displayItems.map((item, i) => {
          const prev = i > 0 ? displayItems[i - 1] : undefined;
          // First card of each zone carries the header. Driven by the per-item flag, NOT by a
          // count, because dedupeByPerson() above can drop promoted cards and move the
          // boundary — a "first N are promoted" assumption would mislabel the split.
          const startsPromoted = hasPromotedZone && Boolean(item.promoted) && !prev?.promoted;
          const startsStream = hasPromotedZone && !item.promoted && (i === 0 || Boolean(prev?.promoted));
          return (
            <Fragment key={item.id}>
              {startsPromoted && (
                <div className="feed-zone">
                  <h2 className="feed-zone-title">The ones that land hardest</h2>
                  <p className="feed-zone-desc">
                    Picked for what they prove, not for when they landed — several of these are
                    weeks old.
                  </p>
                </div>
              )}
              {startsStream && (
                <div className="feed-zone feed-zone--stream">
                  <h2 className="feed-zone-title">Newest first</h2>
                  <p className="feed-zone-desc">Everything else, most recent at the top.</p>
                </div>
              )}
              <FeedCard item={item} onUpdate={updateItem} />
            </Fragment>
          );
        })}
      </div>

      {/* Load more */}
      {items.length < total && (
        <div className="feed-load-more">
          <button
            className="btn btn-secondary"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
