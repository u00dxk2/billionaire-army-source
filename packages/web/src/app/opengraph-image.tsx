import { ImageResponse } from "next/og";

// R-044, second half. The per-card image in feed/[id] covers the shared RECEIPT;
// this covers everything else — home, profiles, /today, /compare — which would
// otherwise still unfurl as a bare text tile. Next uses the nearest
// opengraph-image in the segment tree, so this is the site-wide default and the
// feed route overrides it.
//
// Deliberately static: no data fetch, so the one image every non-feed share
// depends on cannot fail on a slow API.

export const alt =
  "Billionaire Army — U.S. billionaires scored on what they actually give";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#14171c";
const TEXT = "#f5f6f8";
const MUTED = "#8b92a0";
const BRAND = "#e8513d";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: BG,
          color: TEXT,
          padding: "0 84px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 18,
              height: 46,
              background: BRAND,
              borderRadius: 4,
              marginRight: 20,
            }}
          />
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Billionaire Army
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.18,
            marginTop: 34,
          }}
        >
          U.S. billionaires, scored on what they actually give.
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: MUTED,
            marginTop: 26,
            lineHeight: 1.35,
          }}
        >
          Every claim source-linked. Every score open.
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: MUTED,
            marginTop: 48,
          }}
        >
          billionaire.army
        </div>
      </div>
    ),
    size
  );
}
