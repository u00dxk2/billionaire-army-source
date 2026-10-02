import { ImageResponse } from "next/og";
import { pbsGradeHex, OG_PROFILE_TYPE, netWorthAge, netWorthAgeLabel } from "@ba/shared";
import { apiFetch } from "@/lib/api";

// Flow 4 (Share the receipt), Cycle 10 Finding 3 — scoped there, shipped here at
// Cycle 15 (2026-09-07).
//
// Cycle 10 fixed the profile's og:image by pointing it at the SITE-WIDE tile, which
// restored parity with /today and /compare and stopped ~1,092 pages unfurling as a
// large-image card with no image. That was the floor, and it was explicitly named as
// the floor: "the site-wide tile is parity, not the ceiling."
//
// This is the ceiling half. Sending someone a specific billionaire's profile — "look
// at what this guy actually gives" — is at least as natural a share as a feed card,
// and it is the page where the name, the wealth and the giving grade sit together.
// Until now that share arrived carrying the generic house tile: identical for Warren
// Buffett and for a person nobody has heard of, so the receipt did NOT survive the
// boundary. Now the unfurl carries the person's own wealth-vs-giving contrast.
//
// Deliberately mirrors app/feed/[id]/opengraph-image.tsx — same palette, same
// portrait-inlining defence, same labelled-grade treatment — so the two share
// surfaces of one product cannot drift into looking like two products.

export const alt = "A U.S. billionaire's sourced giving record from Billionaire Army";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Runtime intentionally left at the default (nodejs). Do NOT set "edge":
// ba-web runs on Render as a Node server, not on an edge platform.

const BG = "#14171c";
const SURFACE = "#1e222a";
const TEXT = "#f5f6f8";
const MUTED = "#8b92a0";
const BRAND = "#e8513d";

interface Fact {
  factKey: string;
  factValue: string;
  sourceType?: string | null;
  retrievedAt?: string | null;
}

interface PersonForImage {
  name: string;
  state: string | null;
  industry: string[];
  images: string[];
  facts: Fact[];
  score: { pbs: string } | null;
}

async function getPerson(id: string): Promise<PersonForImage | null> {
  try {
    return await apiFetch<PersonForImage>(`/api/persons/${id}`, { cache: "no-store" });
  } catch {
    return null;
  }
}

/**
 * Fetch the portrait and inline it as a data URI.
 *
 * Same defence as the feed image: Satori would fetch a remote <img> itself, but a
 * slow or 404 host throws and takes the WHOLE image down — leaving the unfurl worse
 * than the generic tile this replaces. A failure here degrades to the typographic
 * layout instead of to nothing.
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

function brandedFallback() {
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
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>Billionaire Army</div>
        <div style={{ fontSize: 30, color: MUTED, marginTop: 16 }}>
          Sourced receipts on U.S. billionaires
        </div>
      </div>
    ),
    size
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await getPerson(id);

  // Unreachable person (bad link, or a row pulled from the index). A branded tile
  // rather than a 500 — the graceful-miss branch of Flow 4.
  if (!person) return brandedFallback();

  const netWorthFact = person.facts?.find((f) => f.factKey === "net_worth");
  const netWorth = netWorthFact?.factValue ?? null;
  // B-065: an undated or old figure is labelled on the unfurl too (same rule as the page).
  const netWorthAsOf = netWorthFact ? netWorthAgeLabel(netWorthAge(netWorthFact)) : null;

  // ABSENT, NEVER ZERO. A rendered "0" here would assert that a named living person
  // gives nothing — and an unscored profile means we have not measured, not that the
  // measurement came back empty. When there is no score the grade block is omitted
  // and the composition falls back to name + wealth.
  const pbsNum =
    person.score && Number.isFinite(Number(person.score.pbs)) ? Number(person.score.pbs) : null;
  const grade = pbsNum !== null ? pbsGradeHex(pbsNum) : null;

  const portrait = await inlinePortrait(person.images?.[0]);

  // One interpolated string per node, never text + expression: Satori counts those
  // as two children and rejects a multi-child div with no explicit display.
  const metaLine = [person.industry?.[0], person.state].filter(Boolean).join(" · ");

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
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                fontSize: OG_PROFILE_TYPE.wordmark.px,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: "uppercase",
              }}
            >
              Billionaire Army
            </div>
          </div>
          {metaLine ? (
            <div style={{ fontSize: OG_PROFILE_TYPE.meta.px, color: MUTED, letterSpacing: 1 }}>
              {truncate(metaLine, 38)}
            </div>
          ) : null}
        </div>

        {/* The person, and the wealth↔giving contrast that IS the receipt */}
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          {portrait ? (
            <img
              src={portrait}
              width={190}
              height={190}
              style={{
                width: 190,
                height: 190,
                borderRadius: 95,
                objectFit: "cover",
                marginRight: 40,
              }}
            />
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                fontSize: OG_PROFILE_TYPE.personName.px,
                fontWeight: 700,
                lineHeight: 1.05,
              }}
            >
              {truncate(person.name, 30)}
            </div>
            {netWorth ? (
              <div style={{ display: "flex", alignItems: "baseline", marginTop: 18 }}>
                <div
                  style={{
                    fontSize: OG_PROFILE_TYPE.netWorthLabel.px,
                    color: MUTED,
                    marginRight: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {`Net worth${netWorthAsOf ? ` (${netWorthAsOf})` : ""}`}
                </div>
                <div style={{ fontSize: OG_PROFILE_TYPE.netWorth.px, fontWeight: 700 }}>
                  {netWorth}
                </div>
              </div>
            ) : null}
          </div>

          {/* Labelled GIVING, never a bare letter and never "PBS" (R-041 + the
              2026-09-04 giving-score naming ruling). A lone coloured letter next to a
              named living person reads as this platform's overall verdict on them;
              the word is the entire mitigation, which is why its size is pinned in
              @ba/shared and swept by og-legibility.test.ts rather than set here. */}
          {grade ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginLeft: 40,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 150,
                  height: 150,
                  borderRadius: 75,
                  border: `8px solid ${grade.hex}`,
                  color: grade.hex,
                  fontSize: OG_PROFILE_TYPE.gradeLetter.px,
                  fontWeight: 700,
                }}
              >
                {grade.letter}
              </div>
              {/* Sized for the UNFURL, not for this 1200px canvas — see the module
                  docblock in @ba/shared/og-legibility.ts. Do not "balance" it down. */}
              <div
                style={{
                  fontSize: OG_PROFILE_TYPE.gradeLabel.px,
                  fontWeight: 700,
                  color: TEXT,
                  letterSpacing: 1.5,
                  marginTop: 14,
                  textTransform: "uppercase",
                }}
              >
                {`Giving ${Math.round(pbsNum as number)}`}
              </div>
            </div>
          ) : null}
        </div>

        {/* The standing promise. Not a per-page claim — this image makes no
            assertion the profile itself does not already source. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${SURFACE}`,
            paddingTop: 22,
          }}
        >
          <div style={{ fontSize: OG_PROFILE_TYPE.provenance.px, color: MUTED }}>
            Every claim source-linked
          </div>
          <div style={{ fontSize: OG_PROFILE_TYPE.provenance.px, color: MUTED }}>
            billionaire.army
          </div>
        </div>
      </div>
    ),
    size
  );
}
