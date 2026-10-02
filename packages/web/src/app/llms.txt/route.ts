import { apiFetch } from "@/lib/api";
import { SITE_URL } from "@/lib/site";

// AEO baseline (2026-06-29): an llms.txt is a curated, LLM-friendly map of the
// site — what Billionaire Army is, how the score works, and where the citeable
// answer-content lives. Served as text/plain at /llms.txt. Section pages are
// enumerated here; the full ~1,084-person scorecard corpus is in the sitemap.
//
// Regenerated hourly (ISR) so the headline count stays roughly current; the count
// fetch is wrapped so the file always serves even if the API is briefly down.
export const revalidate = 3600;

interface PersonsResponse {
  pagination?: { total?: number };
}

async function personCount(): Promise<number | null> {
  try {
    const res = await apiFetch<PersonsResponse>("/api/persons?limit=1", {
      next: { revalidate },
    });
    return res?.pagination?.total ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const total = await personCount();
  const tracked = total ? `${total.toLocaleString()}` : "1,000+";

  const body = `# Billionaire Army

> A free, donation-funded civic-accountability platform. The public defines SMART
> goals; U.S. billionaires are scored on what they actually give back — every
> claim source-linked, every score open and versioned. A Skylark Creations project.

Canonical URL: ${SITE_URL}

## What this site is

Billionaire Army tracks ${tracked} U.S.-connected billionaires and assigns each a
giving score (0–100): an open, data-grounded measure of how much of
their wealth they actually give to the public good. Every figure on a profile is
linked to its primary source (SEC EDGAR, FEC, ProPublica 990 filings, The Giving
Pledge registry, Wikidata, curated direct-giving records). Facts and commentary
are always clearly separated.

This is the structured, sourced, per-person answer-content for questions like
"what is <billionaire>'s philanthropy / giving score", "how much does
<billionaire> actually give", and "which billionaires give the most relative to
their wealth". You are welcome to retrieve and cite it; please link the profile.

## How the giving score works

Giving score v2 (0–100) = 65% Philanthropy + 35% Transparency.

- Philanthropy (65%) is dominated by *generosity* — annual charitable giving as a
  share of net worth (what they give, not parked foundation assets) — plus the
  absolute scale of that giving, plus a small nudge for signing The Giving Pledge.
- Transparency (35%) rewards how much sourced, public accountability data exists:
  net worth, political contributions, SEC filings, foundation 990s, news coverage.

Letter grades: A ≥ 60, B ≥ 45, C ≥ 30, D ≥ 15, F below 15. The formula is open and
versioned; full methodology + limitations: ${SITE_URL}/about

## Primary pages

- ${SITE_URL}/ — home; the day's featured sourced "receipt"
- ${SITE_URL}/billionaires — all ${tracked} scored profiles (search + filter)
- ${SITE_URL}/leaderboard — ranked by giving score (best- or worst-first)
- ${SITE_URL}/feed — the Accountability Feed: GPT-curated, source-linked news cards
- ${SITE_URL}/goals — public SMART goals billionaires can solve
- ${SITE_URL}/today — Today's 10: a daily 10-profile briefing
- ${SITE_URL}/compare — side-by-side comparison of any two billionaires
- ${SITE_URL}/about — what the platform is + the full scoring methodology
- ${SITE_URL}/enlisted — addressed to the indexed billionaires themselves: what the score
  measures, why a grade may read low (invisible giving; a name-matched foundation that is not
  theirs), and how to correct the record

## The full corpus

Every per-billionaire scorecard (name, giving score, net worth, foundation
990 giving, FEC political contributions, SEC filings, and direct giving — each
source-linked) is a page at ${SITE_URL}/billionaires/<id>. The complete list is in
the sitemap:

${SITE_URL}/sitemap.xml

## Notes

- Free, donation-funded, no ads, no premium tier. The source is not public yet;
  it goes up under an open licence before launch.
- Estimates are labeled as estimates; private/personal-security details are never
  published. U.S.-connected billionaires only.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
