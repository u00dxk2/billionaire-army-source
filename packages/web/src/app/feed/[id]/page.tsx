import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";
import { SITE_URL } from "@/lib/site";
import FeedCardSolo from "@/components/FeedCardSolo";
import type { FeedItem } from "@/lib/feed-types";
import { feedCardNetWorthNote } from "@/lib/feed-net-worth-note";

export const dynamic = "force-dynamic";

async function getItem(id: string): Promise<FeedItem | null> {
  try {
    const res = await apiFetch<{ data: FeedItem }>(`/api/feed/${id}`, {
      cache: "no-store",
    });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

// Rich preview for the shared link (the WOM moment travels with a real
// headline + receipt summary, not a bare URL).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await getItem(id);
  if (!item) return { title: "The Feed — Billionaire Army" };
  // B-037 sibling, found by the P5 sweep for today's card-notice fix (991b4d0): on a withheld
  // person `withholdPoliticalProse` empties the summary, and this route feeds that same string
  // into three metadata slots — so a shared withheld card unfurled with a headline and an EMPTY
  // description, which is the blank body defect at the share boundary, the one surface where the
  // receipt is supposed to travel on its own. The card says why; the unfurl said nothing.
  // Same gate as the card: the FLAG, never the empty string — see FeedCard.tsx.
  const body = item.summary
    ? item.summary
    : item.politicalWithheld
      ? "We're not showing a political figure for this person: we match FEC records by name only, and we can't prove this one is theirs."
      : item.scoreWithheld
        ? "Not graded: we hold no charitable giving record for this person, so we do not give them a giving score."
        : item.summary;
  // B-065: the unfurl carries the card's net-worth age sentence too — the description repeats the
  // prose, and the card body's note does not travel with it (Codex r3-4 #1).
  const note = feedCardNetWorthNote(item);
  const description = note ? [body, note].filter(Boolean).join(" ") : body;
  return {
    title: `${item.headline} — Billionaire Army`,
    description,
    openGraph: {
      title: item.headline,
      description,
      url: `${SITE_URL}/feed/${item.id}`,
      siteName: "Billionaire Army",
      type: "article",
    },
    // summary_large_image is correct ONLY because opengraph-image.tsx sits in
    // this segment and Next injects it as og:image/twitter:image (R-044). If
    // that file is ever removed, drop this back to "summary" in the same commit
    // — a large-image card with no image reserves a slot it cannot fill, which
    // renders worse than the plain tile.
    twitter: {
      card: "summary_large_image",
      title: item.headline,
      description,
    },
  };
}

export default async function FeedItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(id);

  return (
    <div className="feed-container">
      <div style={{ margin: "0 0 1rem" }}>
        <a href="/feed" className="source-link">
          ← The Feed
        </a>
      </div>

      {item ? (
        <div className="feed-list">
          <FeedCardSolo item={item} />
        </div>
      ) : (
        <div className="feed-empty">
          <p>That card isn&apos;t here anymore.</p>
          <p className="empty-hint">
            It may have rotated out of the feed. See what&apos;s current on{" "}
            <a href="/feed" className="source-link">
              The Feed
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
