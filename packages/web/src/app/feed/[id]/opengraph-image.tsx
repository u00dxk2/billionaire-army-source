import { ImageResponse } from "next/og";
import { pbsGradeHex, OG_FEED_TYPE, sourceLabel } from "@ba/shared";
import { apiFetch } from "@/lib/api";
import type { FeedItem } from "@/lib/feed-types";

// R-044. Before this existed the site had NO og:image anywhere, so every shared
// receipt unfurled as a text-only tile — the sender felt the fury→clarity→receipt
// punch and the friend received a grey rectangle. This renders the receipt ITSELF
// into the conversation, before anyone clicks.
//
// Deliberately echoes the share text built in FeedCard.handleShare (person ·
// net worth · giving grade, then the headline, then the source) so the two halves
// of the same hand-off cannot drift apart.

export const alt = "A sourced accountability receipt from Billionaire Army";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Runtime is intentionally left at the default (nodejs). Do NOT set "edge":
// ba-web runs on Render as a Node server, not on an edge platform.

const BG = "#14171c";
const SURFACE = "#1e222a";
const TEXT = "#f5f6f8";
const MUTED = "#8b92a0";
const BRAND = "#e8513d";

const CATEGORY_LABELS: Record<string, string> = {
  politics: "Politics",
  philanthropy: "Philanthropy",
  business: "Business",
  sec_filing: "SEC Filing",
  controversy: "Controversy",
};

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

/**
 * Fetch a remote portrait and inline it as a data URI.
 *
 * Satori fetches remote <img> itself, but a slow or 404 host would throw and
 * take the WHOLE image down — leaving the unfurl worse than the text-only tile
 * this feature exists to replace. So the photo is fetched here, defensively, and
 * a failure degrades to the typographic layout instead of to nothing.
 */
async function inlinePortrait(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": "BillionaireArmy/1.0 (+https://billionaire.army)" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    // Guard against a surprise multi-MB original; Satori holds it all in memory.
    if (buf.byteLength > 3_000_000) return null;
    return `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(id);

  // Card rotated out (or a bad share link). Still return a branded image rather
  // than a 500 — the graceful-miss branch of Flow 4.
  if (!item) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: BG,
            color: TEXT,
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>
            Billionaire Army
          </div>
          <div style={{ fontSize: 30, color: MUTED, marginTop: 16 }}>
            Sourced receipts on U.S. billionaires
          </div>
        </div>
      ),
      size
    );
  }

  const ctx = (item.contextData || {}) as Record<string, unknown>;
  const netWorth = ctx.netWorth ? String(ctx.netWorth) : null;
  const netWorthAsOf =
    typeof (item as { netWorthAsOf?: unknown }).netWorthAsOf === "string"
      ? (item as { netWorthAsOf: string }).netWorthAsOf
      : null;
  const pbsRaw = ctx.pbs;
  const pbsNum =
    pbsRaw !== undefined && pbsRaw !== null && Number.isFinite(Number(pbsRaw))
      ? Number(pbsRaw)
      : null;
  const grade = pbsNum !== null ? pbsGradeHex(pbsNum) : null;

  const person = item.persons?.[0];
  const portrait = await inlinePortrait(person?.images?.[0]);
  const category = CATEGORY_LABELS[item.category] || null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: TEXT,
          padding: "48px 56px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark + category */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 14,
                height: 34,
                background: BRAND,
                borderRadius: 3,
                marginRight: 14,
              }}
            />
            <div
              style={{
                fontSize: OG_FEED_TYPE.wordmark.px,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: "uppercase",
              }}
            >
              Billionaire Army
            </div>
          </div>
          {category ? (
            <div style={{ fontSize: OG_FEED_TYPE.category.px, color: MUTED, letterSpacing: 1 }}>
              {category}
            </div>
          ) : null}
        </div>

        {/* The receipt: who, and the wealth↔giving contrast that IS the punch */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 40,
            padding: "28px 32px",
            background: SURFACE,
            borderRadius: 18,
          }}
        >
          {portrait ? (
            <img
              src={portrait}
              width={112}
              height={112}
              style={{
                width: 112,
                height: 112,
                borderRadius: 56,
                objectFit: "cover",
                marginRight: 28,
              }}
            />
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontSize: OG_FEED_TYPE.personName.px, fontWeight: 700, lineHeight: 1.1 }}>
              {truncate(person?.name ?? "Billionaire Army", 34)}
            </div>
            {netWorth ? (
              <div style={{ display: "flex", alignItems: "baseline", marginTop: 10 }}>
                {/* B-065: the unfurled image travels furthest, so an undated or old figure is labelled
                    here too. ONE interpolated string — Satori rejects text plus an expression as two
                    children without an explicit display. */}
                <div style={{ fontSize: OG_FEED_TYPE.netWorthLabel.px, color: MUTED, marginRight: 10 }}>
                  {`Net worth${netWorthAsOf ? ` (${netWorthAsOf})` : ""}`}
                </div>
                <div style={{ fontSize: OG_FEED_TYPE.netWorth.px, fontWeight: 700 }}>{netWorth}</div>
              </div>
            ) : null}
          </div>

          {/* Labelled GIVING, never a bare letter or "PBS" — beside a political
              or controversy card a lone grade reads as the platform's overall
              verdict and exonerates the very card meant to indict (R-041). */}
          {grade ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginLeft: 28,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 104,
                  height: 104,
                  borderRadius: 52,
                  border: `6px solid ${grade.hex}`,
                  color: grade.hex,
                  fontSize: OG_FEED_TYPE.gradeLetter.px,
                  fontWeight: 700,
                }}
              >
                {grade.letter}
              </div>
              {/* Sized for the UNFURL, not for this 1200px canvas. Messaging
                  apps render an OG card at roughly 250–500px, a 2.4–4.8x
                  reduction — at the 17px this label started life as, it fell to
                  ~4–7px and vanished, leaving a bare coloured letter. That is
                  exactly the R-041 defect the label exists to prevent, so it is
                  deliberately larger and higher-contrast than its visual weight
                  on the full-size image would suggest. Do not "balance" it down. */}
              <div
                style={{
                  fontSize: OG_FEED_TYPE.gradeLabel.px,
                  fontWeight: 700,
                  color: TEXT,
                  letterSpacing: 1.5,
                  marginTop: 12,
                  textTransform: "uppercase",
                }}
              >
                {/* One interpolated string, NOT text + expression: Satori treats
                    those as two children and rejects any multi-child div without
                    an explicit display. */}
                {`Giving${pbsNum !== null ? ` ${Math.round(pbsNum)}` : ""}`}
              </div>
            </div>
          ) : null}
        </div>

        {/* The claim */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: OG_FEED_TYPE.headline.px,
            fontWeight: 600,
            lineHeight: 1.25,
            marginTop: 32,
          }}
        >
          {truncate(item.headline, 150)}
        </div>

        {/* Provenance — the whole promise is that this is checkable */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${SURFACE}`,
            paddingTop: 22,
          }}
        >
          <div style={{ fontSize: OG_FEED_TYPE.provenance.px, color: MUTED }}>
            {/* sourceLabel, not `|| "see card"`: the falsy guard misses the curator's "Unknown"
                placeholder, so the share IMAGE — the artifact that actually travels — printed
                "Source — Unknown" on a defamation-adjacent card. One helper, all surfaces. */}
            {`Source — ${truncate(sourceLabel(item.sourceName, item.sourceUrl), 40)}`}
          </div>
          <div style={{ fontSize: OG_FEED_TYPE.provenance.px, color: MUTED }}>billionaire.army</div>
        </div>
      </div>
    ),
    size
  );
}
