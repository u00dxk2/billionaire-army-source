import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";
import VoteButtons from "@/components/VoteButtons";
import ProfileShareButton from "@/components/ProfileShareButton";
import {
  pbsGrade,
  foundationTotals,
  philanthropyZeroKind,
  unevidencedGradeCaveat,
  stripPipelineCommentary,
  isFecRecordCapped,
  isFecRecordImpossible,
  isPoliticalProseOutdated,
  fecReportedTotal,
  FEC_PAGE_SIZE,
  normalizePartyBreakdown,
  proseAmount,
  coverageWindow,
  netWorthAge,
  netWorthAgeLabel,
  netWorthWithAge,
  cardNetWorthDisplay,
  netWorthSummaryNote,
  NOT_GRADED_LABEL,
  NOT_GRADED_REASON,
} from "@ba/shared";
import { SITE_URL } from "@/lib/site";
import { formatCurrency } from "@/lib/format";
import { jsonLdString } from "@/lib/json-ld";
import { nteeLabel } from "@/lib/ntee";

interface Fact {
  id: string;
  factType: string;
  factKey: string;
  factValue: unknown;
  sourceUrl: string;
  sourceType: string | null;
  retrievedAt: string;
  estimationMethod: string | null;
}

interface PersonDetail {
  id: string;
  name: string;
  aliases: string[];
  birthYear: number | null;
  country: string | null;
  state: string | null;
  industry: string[];
  gender: string | null;
  badges: Record<string, boolean>;
  usPresence: { type: string; details: string }[];
  images: string[];
  facts: Fact[];
  /** null for a not-graded person — the API serves no score for them (grade-status.ts). */
  score: {
    pbs: string;
    features: Record<string, number>;
    date: string;
  } | null;
  /** Absent on an older API build; treat absent as "graded" only if a score is present. */
  gradeStatus?: "graded" | "not_graded";
}

// Human-readable labels for the machine sourceType tokens stored on each fact.
// Keeps the credibility surface readable ("Source: ProPublica (990)") instead of
// leaking jargon ("Source: propublica_990"). Unknown tokens fall through verbatim.
const SOURCE_LABELS: Record<string, string> = {
  wikidata: "Wikidata",
  realtime_index: "Real-time index",
  llm_summary: "AI summary",
  fec: "FEC",
  sec_edgar: "SEC EDGAR",
  propublica_990: "ProPublica (990)",
  giving_pledge: "Giving Pledge",
  direct_giving: "Direct giving (curated)",
  curated_business: "Business profile (curated)",
  gdelt: "GDELT",
  newsapi: "NewsAPI",
  rtb: "Real-Time Billionaires",
};

function sourceLabel(sourceType: string | null): string {
  if (!sourceType) return "link";
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

// Sources that publish on a fixed/periodic cadence (annual or event-driven public
// filings). For these, an older "retrieved" date means "this is the latest filing on
// record," not "stale scrape" — most non-GDELT facts date to the frozen March-2026
// backfill (KP-1), so a wall of identical retrieved-dates otherwise reads as platform
// staleness. Framing the cadence keeps full retrieval transparency (the date still
// shows) while stopping a true fact (backfill date) from implying a false one
// (abandoned platform). Unknown / live sources fall through to a bare retrieved-date.
const FILING_CADENCE: Record<string, string> = {
  propublica_990: "annual filing",
  fec: "contribution filings",
  sec_edgar: "regulatory filings",
};

function SourceCitation({ fact }: { fact: Fact }) {
  const cadence = fact.sourceType ? FILING_CADENCE[fact.sourceType] : undefined;
  const retrieved = new Date(fact.retrievedAt).toLocaleDateString();
  return (
    <a
      href={fact.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="source-link"
    >
      Source: {sourceLabel(fact.sourceType)} —{" "}
      {cadence
        ? `${cadence} · latest on record (retrieved ${retrieved})`
        : `retrieved ${retrieved}`}
      {fact.estimationMethod && ` (${fact.estimationMethod})`}
    </a>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <h2 className="profile-section-header">
      <span className="profile-section-icon">{icon}</span>
      {title}
    </h2>
  );
}

function PoliticalSection({
  fact,
  birthYear,
  personName,
}: {
  fact: Fact;
  birthYear: number | null;
  personName: string;
}) {
  const data = fact.factValue as {
    totalAmount: number;
    partyBreakdown: Record<string, number>;
    topRecipients: { name: string; amount: number }[];
    count: number;
    dateRange: string;
    reportedTotalContributions?: number | null;
  };

  // The fetcher does not paginate, so a prolific donor's stored record is their 100 MOST RECENT
  // contributions and EVERY figure below — total, count, date range, party split, top recipients —
  // is computed over that truncated set. 2026-08-29 fixed the generated PROSE; these tiles were
  // untouched and kept publishing the page size as a complete record, which is the louder half of
  // the page. Capped records say so on every figure they qualify.
  // B-037: contributions are matched by NAME STRING ALONE, so a record whose earliest contribution
  // predates this person's 18th year belongs to a different human. That is a false public claim
  // about a named living person, so the figures come DOWN rather than getting a caveat — a hidden
  // section is honest, a wrong one is not. Everything else carries the matching-basis disclosure
  // below, because name-only matching is a property of all 877 records, not just the provable ones.
  if (isFecRecordImpossible(data.dateRange, birthYear)) {
    return (
      <div className="card profile-section">
        <SectionHeader title="Political Contributions" icon="FEC" />
        <p className="profile-section-note">
          <strong>We&rsquo;re not showing contributions here, because we can&rsquo;t prove they&rsquo;re
          this person&rsquo;s.</strong> We match federal contributions by name only, and this record
          includes donations dated before {personName} was old enough to give — so some or all of it
          belongs to someone with the same name. The FEC&rsquo;s own records are public and unchanged;
          it&rsquo;s our matching we don&rsquo;t trust, so we&rsquo;re withholding it rather than
          publishing a number we can&rsquo;t stand behind.
        </p>
        {/* Withholding our attribution should not dead-end the reader: the public record we are
            declining to interpret is one click away, and pointing at it is the honest move on a
            product whose whole thesis is that no claim outruns its citation. */}
        <a
          className="profile-section-note"
          href={`https://www.fec.gov/data/receipts/individual-contributions/?contributor_name=${encodeURIComponent(personName)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Search the FEC&rsquo;s own records for this name &rarr;
        </a>
      </div>
    );
  }

  const capped = isFecRecordCapped(data);
  const reportedTotal = fecReportedTotal(data);

  // B-038. Was `Object.entries(data.partyBreakdown)`, which printed the RAW FEC CODE as a party
  // name (readers saw `NNE`, `DCG`, `UNK`) and rendered DEM and Dem as two separate bars for one
  // party. `normalizePartyBreakdown` folds the case-variants, labels what it can name, and
  // preserves the total exactly — see @ba/shared/party-breakdown.ts for why nothing else merges.
  const parties = normalizePartyBreakdown(data.partyBreakdown);
  const maxPartyAmount = parties.length > 0 ? parties[0].amount : 1;

  /* B-038. A skeptical reader adds the party figures up and checks them against the total — that is
     the arithmetic this product invites, and on 41 of 791 judged profiles the generated PARAGRAPH
     above comes up short because it states some buckets and omits others (`npm run check:party-sum`).
     The bars cannot: `normalizePartyBreakdown` preserves the sum exactly and drops no bucket, pinned
     by its own test. So the page says which figures are COMPLETE rather than leaving the reader to
     wonder which set to trust. Computed, never asserted: if these ever fail to reconcile — a refund
     bucket, a fact written by an older fetcher — the line does not render at all.

     THE CLAIM IS COMPLETENESS, NEVER VISUAL ADDITION, and that wording is a correction from the
     adversarial review: the bars print through `formatCurrency`, which abbreviates ($214K, $213K),
     so a sentence saying "these add up to $584K" would be FALSE on screen while true in the data —
     re-creating, in the fix, exactly the add-it-up contradiction it exists to resolve. The exact
     total is spelled out instead, through the shared formatter (an inline one here would be the
     fork `no NEW inline currency ladder` pins). */
  const partySum = parties.reduce((sum, p) => sum + p.amount, 0);
  const partiesReconcile =
    parties.length > 1 &&
    typeof data.totalAmount === "number" &&
    Math.abs(partySum - data.totalAmount) < 0.005;

  const partyColors: Record<string, string> = {
    DEM: "#2166ac",
    REP: "#b2182b",
    IND: "#7a7a7a",
    LIB: "#f4a742",
    GRE: "#2d8f4e",
    DFL: "#4d94c7",
    NAT: "#8a6fae",
  };

  return (
    <div className="card profile-section">
      <SectionHeader title="Political Contributions" icon="FEC" />
      <div className="profile-stat-row">
        <div className="profile-stat">
          <span className="profile-stat-value">
            {capped ? `${formatCurrency(data.totalAmount)}+` : formatCurrency(data.totalAmount)}
          </span>
          <span className="profile-stat-label">
            {capped ? "In Records We Hold" : "Total Contributed"}
          </span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">
            {capped ? (reportedTotal ?? `${data.count}+`) : data.count}
          </span>
          <span className="profile-stat-label">
            {capped && reportedTotal ? "Contributions On File" : "Contributions"}
          </span>
        </div>
        {data.dateRange && (
          <div className="profile-stat">
            <span className="profile-stat-value" style={{ fontSize: "0.95rem" }}>
              {data.dateRange.split(" to ").map(d => new Date(d).getFullYear()).join("–")}
            </span>
            {/* A capped record is sorted newest-first, so its EARLIEST date is an artifact of where
                the page cut off, not the start of the person's giving. Labelling it "Date Range"
                asserts a span that is not in evidence. */}
            <span className="profile-stat-label">{capped ? "Range Shown" : "Date Range"}</span>
          </div>
        )}
      </div>

      {capped && (
        <p className="profile-section-note">
          These figures cover the{" "}
          {reportedTotal
            ? `${FEC_PAGE_SIZE} most recent of ${reportedTotal.toLocaleString()} federal contributions on file`
            : `${FEC_PAGE_SIZE} most recent federal contributions on file`}
          , not the full record. The total, party split, top recipients and dates below are all
          computed over that sample, so each is a floor rather than a complete figure.
        </p>
      )}

      {parties.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <h4 className="profile-subsection-title">{capped ? "By Party (in the sample)" : "By Party"}</h4>
          {parties.map(({ code, label, amount }) => (
            <div key={code} className="profile-bar-row">
              <span className="profile-bar-label">{label}</span>
              <div className="profile-bar-track">
                <div
                  className="profile-bar-fill"
                  style={{
                    width: `${(amount / maxPartyAmount) * 100}%`,
                    background: partyColors[code] || "var(--color-primary)",
                  }}
                />
              </div>
              <span className="profile-bar-value">{formatCurrency(amount)}</span>
            </div>
          ))}
          {partiesReconcile && (
            <p className="profile-section-note">
              Every party {capped ? "in this sample" : "on file"} is listed here. The bars are
              rounded for display; unrounded they total exactly ${proseAmount(data.totalAmount)}.
            </p>
          )}
        </div>
      )}

      {data.topRecipients.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <h4 className="profile-subsection-title">{capped ? "Top Recipients (in the sample)" : "Top Recipients"}</h4>
          <div className="profile-list">
            {data.topRecipients.map((r, i) => (
              <div key={i} className="profile-list-item">
                <span className="profile-list-name">{r.name}</span>
                <span className="profile-list-value">{formatCurrency(r.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B-037. The matching basis belongs on EVERY record, not only the provably-wrong ones:
          name-only matching is a property of how the data is gathered. Stating it is the same
          honest-and-imprecise order the page-size cap notice follows. */}
      <p className="profile-section-note">
        <strong>Matched by name only.</strong> These are the donations the FEC lists under this
        person&rsquo;s name — so a different person with the same name can show up here too.
      </p>

      <div style={{ marginTop: "0.75rem" }}>
        <SourceCitation fact={fact} />
      </div>
    </div>
  );
}

function PhilanthropySection({ fact }: { fact: Fact }) {
  const data = fact.factValue as {
    foundations: {
      name: string;
      ein: number;
      city: string;
      state: string;
      nteeCode?: string | null;
      totalAssets: number;
      totalRevenue: number;
      totalExpenses: number;
      grantsPaid: number;
      taxYear: number | null;
    }[];
    totalFoundationAssets: number;
    totalGrantsPaid: number;
  };

  // B-030: THIS is the tile that published `$152.5B / Foundation Assets` for Bill and Melinda
  // Gates — the Gates Foundation summed with the Gates Foundation Trust that funds it. It read
  // `data.totalFoundationAssets` / `data.totalGrantsPaid` straight off the stored fact, and those
  // two fields are the fetcher's UN-COLLAPSED sums. Totals now come from the one shared helper;
  // the per-foundation cards below still list every entity, which is the owner's ruling exactly
  // (2026-08-12: "exclude endowment trusts from the total, keep the trust in the breakdown").
  const { totalAssets, totalGrants } = foundationTotals(data);

  return (
    <div className="card profile-section">
      <SectionHeader title="Philanthropy" icon="990" />
      {/* B-021: these foundations are attached by NAME SHAPE, not by evidence. `isPlausiblyOwnFoundation()`
          requires the person's name to lead the org name with the charitable word adjacent — which is
          token-for-token identical for a real match and for an unrelated same-surname family foundation.
          Live as of 2026-08-20: Tom Ford carries "Ford Family Foundation" (the Kenneth Ford family of
          Oregon), LeBron James carries two unrelated "James Foundation" entities, and George Kaiser still
          carries "Kaiser Family Foundation (WI)" beside his real one. B-021 explicitly forbids closing
          that by tightening the string rule — four successive rules were each wrong in production — so the
          honest move is DISPLAY-side: label the method instead of asserting the match. This is the
          project's own published rule ("estimates are labeled as estimates") applied to the ~715-873
          profiles that render this section. Delete this note only when attribution moves to trustee-level
          evidence, i.e. when B-021 closes. */}
      <p className="profile-section-note">
        Foundations are matched to a person by <strong>name</strong>, not by trustee records — so a
        same-surname family foundation can land here in error. Every entity below links to its full IRS
        filing; if one doesn&rsquo;t belong, tell us at{" "}
        <a href="mailto:hello@skylarkcreations.com" className="source-link">hello@skylarkcreations.com</a>{" "}
        and we&rsquo;ll pull it.
      </p>
      <div className="profile-stat-row">
        <div className="profile-stat">
          <span className="profile-stat-value">{formatCurrency(totalAssets)}</span>
          <span className="profile-stat-label">Foundation Assets</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{formatCurrency(totalGrants)}</span>
          <span className="profile-stat-label">Grants Paid</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{data.foundations.length}</span>
          <span className="profile-stat-label">Foundation{data.foundations.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {data.foundations.map((f, i) => (
        <div key={i} className="profile-foundation-card">
          <div className="profile-foundation-header">
            <strong>{f.name}</strong>
            {f.city && f.state && (
              <span className="profile-foundation-location">{f.city}, {f.state}</span>
            )}
          </div>
          {nteeLabel(f.nteeCode) && (
            <div className="profile-foundation-category">
              {nteeLabel(f.nteeCode)} <span className="ntee-code">(IRS NTEE {f.nteeCode?.trim().toUpperCase()})</span>
            </div>
          )}
          <div className="profile-foundation-stats">
            <span>Assets: <strong>{formatCurrency(f.totalAssets)}</strong></span>
            <span>Revenue: <strong>{formatCurrency(f.totalRevenue)}</strong></span>
            <span>Grants: <strong>{formatCurrency(f.grantsPaid)}</strong></span>
            {f.taxYear && <span>Tax Year: <strong>{f.taxYear}</strong></span>}
          </div>
          {f.ein && (
            <a
              href={`https://projects.propublica.org/nonprofits/organizations/${f.ein}`}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
              style={{ marginTop: "0.5rem", display: "inline-block" }}
            >
              Mission, purpose &amp; full 990 filings → ProPublica Nonprofit Explorer
            </a>
          )}
        </div>
      ))}

      <div style={{ marginTop: "0.75rem" }}>
        <SourceCitation fact={fact} />
      </div>
    </div>
  );
}

function DirectGivingSection({ fact }: { fact: Fact }) {
  const data = fact.factValue as {
    cumulativeGiving: number;
    annualGiving: number;
    sinceYear?: number;
    periodLabel?: string;
    source?: string;
    note?: string | null;
  };

  return (
    <div className="card profile-section">
      <SectionHeader title="Direct Giving" icon="GIVE" />
      <div className="profile-stat-row">
        <div className="profile-stat">
          <span className="profile-stat-value">{formatCurrency(data.cumulativeGiving)}</span>
          <span className="profile-stat-label">Given {data.periodLabel ?? "to date"}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{formatCurrency(data.annualGiving)}</span>
          <span className="profile-stat-label">Per year (avg)</span>
        </div>
      </div>
      {data.note && (
        <p style={{ fontSize: "0.9rem", color: "var(--color-text-secondary)", marginTop: "0.5rem" }}>
          {data.note}
        </p>
      )}
      <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginTop: "0.5rem" }}>
        Direct gifts made outside a private foundation (no 990 filing) — counted in the giving score.
      </p>
      <div style={{ marginTop: "0.75rem" }}>
        <SourceCitation fact={fact} />
      </div>
    </div>
  );
}

// Curated "what their company actually does" block (R-015). Distinct from the
// SEC-filings section below: this answers the plain-language question with a
// sourced description per business; the SEC section shows filings activity.
function BusinessProfileSection({ fact }: { fact: Fact }) {
  const data = fact.factValue as {
    businesses: {
      company: string;
      role: string;
      description: string;
      sourceUrl: string;
      sourceName: string;
    }[];
  };

  if (!data.businesses?.length) return null;

  return (
    <div className="card profile-section">
      <SectionHeader title="Business" icon="BIZ" />
      {data.businesses.map((b, i) => (
        <div key={i} className="profile-foundation-card">
          <div className="profile-foundation-header">
            <strong>{b.company}</strong>
            <span className="profile-foundation-location">{b.role}</span>
          </div>
          <p className="profile-business-description">{b.description}</p>
          <a
            href={b.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
          >
            Source: {b.sourceName}
          </a>
        </div>
      ))}
      <div style={{ marginTop: "0.75rem" }}>
        <SourceCitation fact={fact} />
      </div>
    </div>
  );
}

function BusinessSection({ fact }: { fact: Fact }) {
  const data = fact.factValue as {
    // New format (EFTS + Submissions)
    personalCik?: string | null;
    companies?: { name: string; cik: string; ticker: string | null }[];
    eftsHits?: number;
    entityName?: string;
    entityType?: string;
    tickers?: string[];
    sicDescription?: string;
    totalFilings?: number;
    insiderFilingCount?: number;
    recentInsiderFilings?: { form: string; date: string; description: string }[];
    // Legacy format
    filingCount?: number;
    cik?: string | null;
    recentFilings?: { date: string; type: string; description: string }[];
  };

  const filingCount = data.totalFilings ?? data.filingCount ?? 0;
  const insiderCount = data.insiderFilingCount ?? 0;
  const cik = data.personalCik ?? data.cik ?? null;
  const recentFilings = data.recentInsiderFilings ?? data.recentFilings?.map(f => ({ form: f.type, date: f.date, description: f.description })) ?? [];
  const companies = data.companies ?? [];

  return (
    <div className="card profile-section">
      <SectionHeader title="SEC Filings" icon="SEC" />
      <div className="profile-stat-row">
        {filingCount > 0 && (
          <div className="profile-stat">
            <span className="profile-stat-value">{filingCount.toLocaleString()}</span>
            <span className="profile-stat-label">Total Filings</span>
          </div>
        )}
        {insiderCount > 0 && (
          <div className="profile-stat">
            <span className="profile-stat-value">{insiderCount}</span>
            <span className="profile-stat-label">Insider Filings</span>
          </div>
        )}
        {data.eftsHits != null && data.eftsHits > 0 && (
          <div className="profile-stat">
            <span className="profile-stat-value">{data.eftsHits.toLocaleString()}</span>
            <span className="profile-stat-label">EDGAR Mentions</span>
          </div>
        )}
        {cik && (
          <div className="profile-stat">
            <span className="profile-stat-value" style={{ fontSize: "0.95rem" }}>{cik}</span>
            <span className="profile-stat-label">{data.personalCik ? "Personal CIK" : "CIK"}</span>
          </div>
        )}
      </div>

      {companies.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <h4 className="profile-subsection-title">Associated Companies</h4>
          <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginTop: "-0.25rem", marginBottom: "0.6rem" }}>
            Entities appearing alongside this person in SEC full-text search — an association, not necessarily ownership or control. Follow each link to the primary SEC record to judge for yourself.
          </p>
          <div className="profile-list">
            {companies.map((c, i) => (
              <div key={i} className="profile-list-item">
                {c.cik ? (
                  <a
                    href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}&type=&dateb=&owner=include&count=40`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="profile-list-name"
                  >
                    {c.name}
                  </a>
                ) : (
                  <span className="profile-list-name">{c.name}</span>
                )}
                {c.ticker && <span className="badge badge-primary">{c.ticker}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {recentFilings.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <h4 className="profile-subsection-title">Recent Insider Filings</h4>
          <div className="profile-list">
            {recentFilings.map((f, i) => (
              <div key={i} className="profile-list-item">
                <div>
                  <span className="badge badge-primary" style={{ marginRight: "0.5rem" }}>
                    {f.form}
                  </span>
                  {f.description && <span className="profile-list-name">{f.description}</span>}
                </div>
                <span className="profile-list-date">{new Date(f.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: "0.75rem" }}>
        <SourceCitation fact={fact} />
      </div>
    </div>
  );
}

function NewsSection({ fact }: { fact: Fact }) {
  const data = fact.factValue as {
    articles: {
      title: string;
      url: string;
      source: string;
      date: string;
      image: string | null;
      sentiment: number | null;
    }[];
    totalResults: number;
    averageSentiment: number | null;
    topSources: { name: string; count: number }[];
    dateRange: string;
  };

  if (!data.articles || data.articles.length === 0) return null;

  function sentimentColor(s: number | null): string {
    if (s === null) return "var(--color-text-muted)";
    if (s > 0.2) return "var(--color-accent-green)";
    if (s < -0.2) return "var(--color-accent)";
    // Brand amber — #b8860b as text on white was 3.3:1 (2026-08-05 sweep)
    return "var(--color-amber)";
  }

  return (
    <div className="card profile-section">
      {/*
        NOT "Recent News". That header was a CLAIM, and on 2026-08-08 it was false on the
        marquee demo profile: Bill Gates' section was headed "Recent News" over articles
        dated 3/9/2026 — five months old — because these facts come from the frozen March
        backfill (KP-1) while the feed pipeline runs daily. A cold reader doing exactly the
        credibility check this page exists to survive reads that as either "the pipeline
        isn't live" or "the profile isn't wired to it," and both are worse than the truth.
        Same principle as the FILING_CADENCE labels above, applied in the other direction:
        there, an old date implied a false staleness; here, a recency word implied a false
        freshness. The window is now stated instead of asserted.
      */}
      <SectionHeader title="News Coverage" icon="NEWS" />
      {/*
        DERIVED from the articles this page is about to render, NOT read from the stored
        `data.dateRange` string. Both news fetchers built that string from POSITIONAL endpoints
        (`articles[last] to articles[0]`) while GDELT orders by RELEVANCE, so it was arbitrary:
        measured 2026-09-09, 20 of 34 judged profiles published a window that misstated their own
        articles — 14 read BACKWARD (MacKenzie Scott: "2026-08-20 to 2026-08-11") and Bill Gates'
        profile claimed a two-day window over articles spanning back to 2020. The writers are
        fixed too, but a stored window stays wrong until GDELT's stalest-first rotation reaches
        that person, and this section is a credibility surface on the page whose whole thesis is
        that no claim outruns its citation. Same reasoning as the feed card's giving ratio being
        rendered rather than written: a display string frozen at write time cannot be trusted to
        still describe the rows underneath it. `coverageWindow` is the ONE shared function both
        fetchers now call — do not fork a second copy here.
      */}
      <p className="profile-section-note">
        Coverage window: {coverageWindow(data.articles.map((a) => a.date)) || "not recorded"} · retrieved{" "}
        {new Date(fact.retrievedAt).toLocaleDateString()}
      </p>
      {/*
        NO STAT ROW (B-028, 2026-08-09). "Total Articles", "Top Source" and "Avg. Sentiment"
        were each computed over the RAW NewsAPI keyword-match set, which has no relevance
        gate — so all three were claims about a set the page cannot stand behind. Measured
        against 200 prod profiles: of 322 stored articles only 38 name their person at all.
        That is what produced Bill Gates' "Total Articles 4,588" and a top source of "Current
        Publishing", an Indiana local paper that matched on a name collision — on the very
        page whose job is to survive a credibility check.
        The ARTICLE LIST is deliberately left unfiltered: the same measurement showed a
        name-match filter drops 284 of 322 and empties 15 of 37 profiles, killing correct
        coverage ("Fidelity sees record revenue" for Fidelity's CEO) to remove the wrong
        kind. nameInText() is calibrated on curated card HEADLINES, where Pass A was told to
        name the subject; raw news titles use the company or the role instead. Filtering the
        list needs a signal that survives that input distribution — tracked on B-028, not
        guessed at here.
      */}
      <div style={{ marginTop: "1rem" }}>
        {data.articles.map((article, i) => (
          <div key={i} className="news-article">
            {article.image && (
              <img
                src={article.image}
                alt=""
                className="news-article-image"
                loading="lazy"
              />
            )}
            <div className="news-article-content">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="news-article-title"
              >
                {article.title}
              </a>
              <div className="news-article-meta">
                <span>{article.source}</span>
                <span>·</span>
                <span>{new Date(article.date).toLocaleDateString()}</span>
                {article.sentiment !== null && (
                  <>
                    <span>·</span>
                    <span
                      className="news-sentiment"
                      style={{ background: sentimentColor(article.sentiment) }}
                      title={`Sentiment: ${article.sentiment.toFixed(2)}`}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "0.75rem" }}>
        <SourceCitation fact={fact} />
      </div>
    </div>
  );
}

function ProfileSummary({
  fact,
  withholdPolitical,
  politicalRecordRefreshedAt,
  netWorthFact,
}: {
  fact: Fact;
  // R-077: when the FEC record was refreshed AFTER this summary was written, its political
  // paragraph describes a window we no longer store, so the page dates the paragraph rather than
  // contradicting the card below it. Nothing is withheld on this signal — see
  // political-prose-staleness.ts for the three false withholds that ruled the figure-matching
  // version out. `null` when the person carries no FEC fact.
  politicalRecordRefreshedAt: string | null;
  // B-037: the FEC FACT and this summary's PROSE are two renderings of one record, and only the
  // fact was guarded. A withheld profile printed "we can't prove they're this person's" above and
  // "48 contributions totaling $128,108 from July 23, 1979" below — verified live on prod
  // 2026-09-02, on 12 of 12 withheld people. The page contradicting itself is worse than the
  // original defect: it publishes the exact claim the notice says it is withholding. Whoever adds
  // the NEXT surface that reads a stored summary owes it this same predicate.
  withholdPolitical: boolean;
  // B-065: the stored net-worth fact, so the summary can say a stated net worth may be out of date
  // (netWorthSummaryNote) — when our figure is not current, or this summary predates it.
  netWorthFact: Fact | undefined;
}) {
  const data = fact.factValue as {
    overview?: string;
    business?: string;
    philanthropy?: string;
    political?: string;
    newsDigest?: string;
    dataSources?: string[];
    generatedAt?: string;
    // B-045 C2: a section the figure block KEPT is the previously published paragraph, not today's
    // prose, so it carries the date it was actually written. Absent for a normal regeneration.
    sectionGeneratedAt?: Record<string, string>;
    model?: string;
  };

  // Drop sentences that narrate our own pipeline to the reader ("the provided data does
  // not include a specific company role", "No validated news articles were available in
  // the provided dataset"). Measured 2026-08-25: 22 of 89 summarised profiles rendered
  // one, on real named people. A section left with nothing but plumbing returns undefined
  // and is dropped by the existing `.filter(s => s.content)` below — deliberately reusing
  // that filter rather than adding a second one, so "empty section" has ONE meaning here.
  // Same principle as `givingRatio()` and `philanthropyZeroKind()`: when we have nothing
  // to say, say nothing — never render our own emptiness.
  const sections = [
    { key: "overview", title: "Overview", icon: "PROFILE", content: data.overview },
    { key: "business", title: "Business & SEC Activity", icon: "SEC", content: data.business },
    { key: "philanthropy", title: "Philanthropy", icon: "990", content: data.philanthropy },
    {
      key: "political",
      title: "Political Activity",
      icon: "FEC",
      // undefined, not "" — the existing `.filter(s => s.content)` below is the ONE place a
      // section is dropped, same reuse the pipeline-commentary strip above relies on.
      content: withholdPolitical ? undefined : data.political,
    },
    { key: "newsDigest", title: "In the News", icon: "NEWS", content: data.newsDigest },
  ]
    .map(s => ({ ...s, content: stripPipelineCommentary(s.content) }))
    .filter(s => s.content);

  if (sections.length === 0) return null;

  // R-077. Both dates are shown, because "this is out of date" without them is unfalsifiable by a
  // reader. A withheld record (B-037) renders no political section at all, so it never reaches this.
  // The date THIS PARAGRAPH was written, which is not the summary's date when C2 kept an older
  // political section: stamping it today would silence the very caveat it needs (B-045 C2).
  const summaryWrittenAt = data.sectionGeneratedAt?.political ?? data.generatedAt ?? fact.retrievedAt;
  const politicalOutdated = isPoliticalProseOutdated(summaryWrittenAt, politicalRecordRefreshedAt);

  // Highlight source citations like [SEC EDGAR] with styled spans
  function renderText(text: string) {
    const parts = text.split(/(\[[^\]]+\])/g);
    return parts.map((part, i) => {
      if (part.startsWith("[") && part.endsWith("]")) {
        return (
          <span key={i} className="summary-source-tag">
            {part.slice(1, -1)}
          </span>
        );
      }
      return part;
    });
  }

  return (
    <div className="card profile-section profile-summary">
      <SectionHeader title="Profile Summary" icon="AI" />
      {/* B-065: one stated sentence, no figure matching (three review rounds found a matcher labelling
          the wrong money). It dates nothing; it says a stated net worth may be out of date. */}
      {netWorthSummaryNote(netWorthFact, data.generatedAt) && (
        <p className="profile-section-note">{netWorthSummaryNote(netWorthFact, data.generatedAt)}</p>
      )}
      {sections.map(({ key, title, content }) => (
        <div key={key} className="summary-section">
          {key !== "overview" && (
            <h4 className="profile-subsection-title">{title}</h4>
          )}
          {key === "political" && politicalOutdated && (
            <p className="profile-section-note">
              {`We refreshed these FEC records on ${new Date(politicalRecordRefreshedAt!).toLocaleDateString()}, after this paragraph was written on ${new Date(summaryWrittenAt).toLocaleDateString()}. Where the two disagree, the records below are the current ones.`}
            </p>
          )}
          <p className="summary-text">{renderText(content!)}</p>
        </div>
      ))}
      {data.generatedAt && (
        <p className="summary-meta">
          AI-generated summary from {data.dataSources?.join(", ") || "public data"} —{" "}
          {new Date(data.generatedAt).toLocaleDateString()}
          {data.model && ` (${data.model})`}.
          All claims are derived from the source data shown below.
        </p>
      )}
    </div>
  );
}

const SCORE_COMPONENTS: {
  key: string;
  label: string;
  weight: number;
  description: string;
  sources: string;
  placeholder?: string;
}[] = [
  {
    key: "philanthropy",
    label: "Philanthropy",
    weight: 65,
    description:
      "Evidenced charitable giving — built on what they actually give each year, not parked assets. Dominated by generosity (annual giving relative to net worth — the share of your fortune you give), plus the absolute scale of that giving, plus a small nudge for signing the Giving Pledge (a commitment, not a realized action).",
    sources: "ProPublica 990 charitable disbursements, net worth, The Giving Pledge registry",
  },
  {
    key: "transparency",
    label: "Transparency",
    weight: 35,
    description:
      "How much sourced, public accountability data exists — net worth, political contributions, SEC filings, foundation 990s, news coverage, and a verified profile. More public disclosure scores higher.",
    sources: "FEC, SEC EDGAR, ProPublica 990s, GDELT / NewsAPI, Wikidata",
  },
];

function ScoreBreakdown({
  score,
  factKeys,
}: {
  score: PersonDetail["score"];
  /** Every fact key this person carries — decides whether a 0% is measured or unevidenced. */
  factKeys: string[];
}) {
  if (!score) return null;

  const pbs = Number(score.pbs);
  const grade = pbsGrade(pbs);
  const features = score.features as Record<string, number>;

  return (
    <div className="card profile-section" id="score-breakdown">
      <SectionHeader title="Score Breakdown" icon="SCORE" />

      {/* Grade + score header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
        <div className="profile-grade" style={{ background: grade.color }}>
          {grade.letter}
        </div>
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{pbs.toFixed(1)}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
            Giving score
          </div>
        </div>
      </div>
      <p className="score-formula-intro">
        The giving score is a weighted average of {SCORE_COMPONENTS.length} components. The formula is open
        and versioned — the weight percentages below show how much each component contributes to the
        final score.
      </p>

      {/* Component bars with explanations */}
      <div className="score-components">
        {SCORE_COMPONENTS.map((comp) => {
          const value = features[comp.key] ?? 0;
          const isPlaceholder = !!comp.placeholder;
          // A 0% here is one of two completely different statements, and the page used to
          // make them identical: 'we have no giving data' and 'this person gives nothing'.
          // Measured 2026-08-22, 298 of 1,092 profiles (27.3%) rendered that 0% and 271 of
          // them had no giving fact at all — Steve Ballmer, Ralph Lauren and Steven Spielberg
          // among them. Same rule givingRatio() already enforces on the feed card, same shape
          // as R-041: the score is right, the presentation was what misled. Nothing below
          // changes a score, a grade or a rank.
          const zeroKind =
            comp.key === "philanthropy" ? philanthropyZeroKind(value, factKeys) : null;
          const unevidenced = zeroKind === "unevidenced";
          // An EVIDENCED zero is a finding, not a gap: the 990 we hold reports no grants.
          // Read all 27 of them on prod 2026-08-22 — every one a real filing of a dormant or
          // near-empty foundation. It keeps its numeric 0%, but it says WHY, because a bare 0%
          // is indistinguishable from the unevidenced one this block exists to stop.
          const evidencedZero = zeroKind === "evidenced-zero";
          const muted = isPlaceholder || unevidenced;
          return (
            <div key={comp.key} className={`score-component ${muted ? "score-component--placeholder" : ""}`}>
              <div className="score-component-header">
                <span className="score-component-label">{comp.label}</span>
                <span className="score-component-weight">{comp.weight}% weight</span>
              </div>
              <div className="profile-bar-row" style={{ marginBottom: 0 }}>
                <div className="profile-bar-track">
                  <div
                    className="profile-bar-fill"
                    style={{
                      width: `${Math.min(value * 100, 100)}%`,
                      background: muted
                        ? "var(--color-text-secondary)"
                        : "var(--color-primary)",
                      opacity: muted ? 0.4 : 1,
                    }}
                  />
                </div>
                <span className="profile-bar-value">
                  {unevidenced ? "No data" : `${(value * 100).toFixed(0)}%`}
                </span>
              </div>
              <p className="score-component-desc">{comp.description}</p>
              <p className="score-component-sources">
                <strong>Data:</strong> {comp.sources}
              </p>
              {isPlaceholder && (
                <p className="score-component-placeholder">{comp.placeholder}</p>
              )}
              {evidencedZero && (
                <p className="score-component-placeholder">
                  The filing we hold reports no grants paid. That is what the disclosure says,
                  not a gap in our data — the source is linked below.
                </p>
              )}
              {unevidenced && (
                <p className="score-component-placeholder">
                  No charitable-giving data on file. That is a gap in our sources, not a finding
                  that this person gives nothing — and because the component still counts as zero,
                  it holds this score down. Political contributions are not charitable giving and
                  never count here, so this line can sit beside a large FEC figure without either
                  being wrong. Know of a gift we are missing?{" "}
                  <a href="mailto:hello@skylarkcreations.com">Tell us</a> and we will source it.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Methodology footer */}
      <div className="score-methodology">
        <p className="score-methodology-formula">
          <strong>Formula (v2):</strong> Giving score ={" "}
          {SCORE_COMPONENTS.map((c, i) => (
            <span key={c.key}>
              {i > 0 && " + "}
              <span className="score-formula-term">{c.weight}% x {c.label}</span>
            </span>
          ))}
        </p>
        <p>
          Scored on {new Date(score.date).toLocaleDateString()} on a 0–100 scale. The score uses only
          the signals we have populated data for. Goal Impact, Controversy, and Community Approval are
          deferred until that data exists — Phase&nbsp;1 goal adoption, controversy detection, and
          community votes respectively.
        </p>
      </div>
    </div>
  );
}

/**
 * Not graded (2026-10-02): a person with no charitable giving record on file carries no letter
 * and no number anywhere (`gradeStatus` in @ba/shared; served as `score: null` by the API). With
 * no giving data the old score was built entirely from how many fact types WE hold, so it graded
 * our coverage, not the person.
 */
function NotGradedSection({ givingPledge }: { givingPledge: boolean }) {
  return (
    <div className="card profile-section" id="score-breakdown">
      <SectionHeader title="Giving score" icon="SCORE" />
      <p className="profile-not-graded">{NOT_GRADED_LABEL} — {NOT_GRADED_REASON}</p>
      <p className="score-formula-intro">
        We hold no charitable giving record for this person: no foundation filing we can tie to them
        and no documented direct gifts. Without one, a score would only measure how much data we
        happen to have, so we do not give one. That says nothing about how much they give.
      </p>
      {givingPledge && (
        <p className="score-formula-intro">
          They have signed the Giving Pledge. A pledge is a promise, not a record of giving, so on its
          own it does not produce a grade.
        </p>
      )}
      <p className="score-formula-intro">
        Know of a gift we are missing?{" "}
        <a href="mailto:hello@skylarkcreations.com">Tell us</a> and we will source it.
      </p>
    </div>
  );
}

// Per-page metadata (AEO 2026-06-29): each scorecard gets a sourced, descriptive
// title + canonical + OG so it's a distinct, citeable entity to AI crawlers and
// link unfurls — not a generic "Billionaire Army" tab. Fetches the same person the
// page renders; identical fetch args dedupe within the request.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let person: PersonDetail | null = null;
  try {
    person = await apiFetch<PersonDetail>(`/api/persons/${id}`, {
      next: { revalidate: 60 },
    });
  } catch {
    // fall through to a safe default below
  }
  if (!person) {
    return { title: "Billionaire profile — Billionaire Army" };
  }

  const canonical = `/billionaires/${id}`;
  // B-065: the description is what a search result or an unfurl shows — label an undated figure there too.
  const netWorthFactMeta = person.facts.find((f) => f.factKey === "net_worth");
  const netWorth = netWorthWithAge(netWorthFactMeta?.factValue, netWorthFactMeta);
  const pbs = person.score ? Number(person.score.pbs) : null;
  const grade = pbs != null ? pbsGrade(pbs) : null;

  // A not-graded person is served `score: null`, so `grade` is null here and neither line states one.
  const notGraded = person.gradeStatus === "not_graded";
  const title = grade
    ? `${person.name} — Giving Score ${grade.letter} (${pbs!.toFixed(0)}) | Billionaire Army`
    : notGraded
      ? `${person.name} — ${NOT_GRADED_LABEL} | Billionaire Army`
      : `${person.name} | Billionaire Army`;

  const descParts = [
    person.name,
    netWorth ? `net worth ${netWorth}` : null,
    grade ? `giving score ${grade.letter} (${pbs!.toFixed(0)}/100)` : null,
    notGraded ? `giving score: ${NOT_GRADED_LABEL.toLowerCase()} (${NOT_GRADED_REASON})` : null,
  ].filter(Boolean);
  const description = `${descParts.join(" · ")}. Sourced philanthropy, political-giving, and SEC data — every claim source-linked.`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${canonical}`,
      type: "profile",
      siteName: "Billionaire Army",
      // ⚠ THE IMAGE COUPLING IS STILL LOAD-BEARING — only its SOURCE changed (2026-09-07).
      //
      // History, because the mechanism is the part that bites: declaring an `openGraph`
      // object in generateMetadata REPLACES the parent's wholesale — it does not
      // deep-merge — so the site-wide app/opengraph-image.tsx that /today and /compare
      // inherit was DROPPED on this route, while `twitter.card` (a separate key) kept
      // inheriting `summary_large_image` from the root layout. Measured live 2026-08-27:
      // og:image=NONE + summary_large_image on ~1,092 profiles, which is the exact state
      // CLAUDE.md forbids and renders WORSE than a plain tile. Cycle 10 fixed it by
      // hardcoding the site-wide tile here.
      //
      // NOW: `opengraph-image.tsx` sits in THIS segment and renders the person's own
      // receipt, so Next injects it as og:image/twitter:image and the hardcoded
      // site-wide URL is gone — it would have overridden the per-person image and
      // handed every one of ~1,092 profiles the identical house tile. That is the same
      // same-segment rule /feed/[id] relies on, and og-image-coupling.test.ts encodes
      // it: an `openGraph` block with no `images` is only safe while a file sits beside
      // this one. **If that file is ever removed, restore `images` (or drop
      // twitter.card to "summary") in the SAME commit.**
      //
      // The invariant is unchanged: never summary_large_image without an image.
    },
  };
}

export default async function BillionaireDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let person: PersonDetail | null = null;
  let error: string | null = null;

  try {
    person = await apiFetch<PersonDetail>(`/api/persons/${id}`, {
      next: { revalidate: 60 },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load profile";
  }

  if (error || !person) {
    // Canon Wave 2 S1: a missed profile link teaches the next action instead of
    // dead-ending (mirrors the /feed/[id] miss state).
    return (
      <div className="detail-miss">
        <p>That profile couldn&apos;t be loaded — it may have been removed, or the link is wrong.</p>
        <p>
          Browse <a href="/billionaires">all profiles</a> or head <a href="/">home</a>.
        </p>
      </div>
    );
  }

  const netWorthFact = person.facts.find((f) => f.factKey === "net_worth");
  // B-065: one decision for the quick stat, the grade caveat and the summary prose on this page.
  const netWorthDisplay = cardNetWorthDisplay(null, netWorthFact, person.score?.features);
  const descriptionFact = person.facts.find((f) => f.factKey === "description");
  const summaryFact = person.facts.find((f) => f.factKey === "profile_summary");
  const politicalFact = person.facts.find((f) => f.factKey === "fec_contributions");
  const philanthropyFact = person.facts.find((f) => f.factKey === "foundation_990s");
  const directGivingFact = person.facts.find((f) => f.factKey === "total_giving");
  const secFact = person.facts.find((f) => f.factKey === "sec_filings");
  const newsFact = person.facts.find((f) => f.factKey === "news_headlines");
  const businessProfileFact = person.facts.find((f) => f.factKey === "business_profile");
  const profileImage = person.images?.[0];

  const hasDataSections = politicalFact || philanthropyFact || directGivingFact || secFact || newsFact || businessProfileFact;

  // Person + score/receipts as schema.org structured data (AEO 2026-06-29). The
  // PBS and the sourced money figures are emitted as PropertyValues so each
  // scorecard is a machine-readable entity, not just prose — exactly the
  // structured, sourced answer-content AI engines cite. Truthful + matches the
  // visible page; additive (delete the <script> to revert).
  const canonicalUrl = `${SITE_URL}/billionaires/${person.id}`;
  const wikidataQid = person.facts
    .find((f) => f.sourceType === "wikidata")
    ?.sourceUrl?.split("/")
    .pop();
  const pbsNum = person.score ? Number(person.score.pbs) : null;

  const additionalProperty: Record<string, unknown>[] = [];
  if (pbsNum != null) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "Giving score",
      value: Number(pbsNum.toFixed(1)),
      minValue: 0,
      maxValue: 100,
      alternateName: pbsGrade(pbsNum).letter,
      description:
        "Open, versioned 0–100 measure of how much of their wealth they actually give to the public good.",
    });
  } else if (person.gradeStatus === "not_graded") {
    // The machine-readable twin of the page's "Not graded": a crawler that finds no score property
    // cannot tell "not graded" from "not published", so it is said in words, never as a number.
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "Giving score",
      value: `${NOT_GRADED_LABEL} — ${NOT_GRADED_REASON}`,
      description:
        "We hold no charitable giving record for this person, so we do not score them. This is not a low score and says nothing about how much they give.",
    });
  }
  if (netWorthFact) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "Estimated net worth",
      // B-065: machine-readable copies get the same age label the page shows.
      value: netWorthWithAge(netWorthFact.factValue, netWorthFact) ?? String(netWorthFact.factValue),
    });
  }
  const dgValue = directGivingFact?.factValue as { annualGiving?: number } | undefined;
  if (dgValue?.annualGiving) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "Annual charitable giving (direct)",
      value: dgValue.annualGiving,
      unitText: "USD/year",
    });
  }
  // B-030: the MACHINE-READABLE TWIN of the Foundation stat tile. Fixing the visible tile and
  // leaving this would have kept asserting the doubled figure to every crawler — the same shape
  // as the false "open source" claim, which was corrected in the footer and on /about while
  // JSON-LD `sameAs` and llms.txt went on publishing it. Reads the shared collapse.
  const phGrants = philanthropyFact ? foundationTotals(philanthropyFact.factValue).totalGrants : 0;
  if (phGrants) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "Foundation grants paid (990)",
      value: phGrants,
      unitText: "USD",
    });
  }
  const polValue = politicalFact?.factValue as { totalAmount?: number } | undefined;
  if (polValue?.totalAmount) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "Political contributions (FEC, total)",
      value: polValue.totalAmount,
      unitText: "USD",
    });
  }

  const personLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    ...(person.aliases?.length ? { alternateName: person.aliases } : {}),
    ...(profileImage ? { image: profileImage } : {}),
    ...(descriptionFact ? { description: String(descriptionFact.factValue) } : {}),
    ...(person.country ? { nationality: person.country } : {}),
    ...(person.industry?.length ? { knowsAbout: person.industry } : {}),
    ...(wikidataQid
      ? { sameAs: `https://www.wikidata.org/wiki/${wikidataQid}` }
      : {}),
    ...(person.badges?.givingPledge ? { award: "The Giving Pledge signatory" } : {}),
    ...(additionalProperty.length ? { additionalProperty } : {}),
    subjectOf: {
      "@type": "WebPage",
      "@id": canonicalUrl,
      name: `${person.name} — Giving score`,
      isPartOf: { "@type": "WebSite", name: "Billionaire Army", url: SITE_URL },
    },
  };

  return (
    <div className="profile-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(personLd) }}
      />
      <a href="/billionaires" className="profile-back-link">
        &larr; All Profiles
      </a>

      {/* Hero */}
      <div className="profile-hero">
        <div className="profile-hero-left">
          {profileImage ? (
            <img
              src={profileImage}
              alt={person.name}
              className="profile-photo-lg"
            />
          ) : (
            <div className="profile-avatar-lg">
              {person.name.split(" ").map((n) => n[0]).join("")}
            </div>
          )}
          <div>
            <h1 className="profile-name">{person.name}</h1>
            {descriptionFact && (
              <p className="profile-description">{String(descriptionFact.factValue)}</p>
            )}
            <div className="profile-badges">
              {person.state && <span className="badge badge-primary">{person.state}</span>}
              {person.industry.map((ind) => (
                <span key={ind} className="badge badge-primary">{ind}</span>
              ))}
              {person.badges?.givingPledge && (
                <span className="badge badge-green">Giving Pledge</span>
              )}
            </div>
            {/* Flow 4, Cycle 15. This page had NO share affordance — `navigator.share`
                lived in exactly two files in the web package and neither was this one —
                so the only way to send someone a profile was to copy the address bar,
                which carries no receipt and no framing. That gap got sharper the moment
                the per-person OG image shipped the same day: the artifact that makes a
                shared profile land existed, on a page with no button to send it from. */}
            <ProfileShareButton
              name={person.name}
              personId={person.id}
              netWorth={netWorthFact ? netWorthWithAge(netWorthFact.factValue, netWorthFact) : null}
              pbs={person.score ? Number(person.score.pbs) : null}
              notGraded={person.gradeStatus === "not_graded"}
            />
          </div>
        </div>

        {/* Quick stats sidebar */}
        <div className="profile-quick-stats">
          {person.score && (() => {
            const pbs = Number(person.score.pbs);
            const grade = pbsGrade(pbs);
            // The letter is the first thing a reader hits, and ~65% of it is giving data we
            // often do not hold: measured 2026-08-22, 271 of 1,092 approved profiles carry an
            // unevidenced philanthropy zero — 19 of them grade C, not F. So the header said
            // "C 30.6 PBS" while a screen below said "No giving data on file", and the page
            // contradicted itself. Same predicate the breakdown already uses (do NOT fork it),
            // same shape as R-041: no score, grade or rank changes — only what the grade SAYS.
            const unevidenced = unevidencedGradeCaveat(person.score, person.facts);
            return (
              <div className="profile-quick-stat">
                <div className="profile-grade-sm" style={{ background: grade.color }}>
                  {grade.letter}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{pbs.toFixed(1)}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Giving Score</div>
                  {unevidenced && (
                    <a
                      className="profile-grade-caveat"
                      href="#score-breakdown"
                      aria-label="This score was computed without any charitable-giving data — we hold no record of this person's charitable giving. Political contributions and other money shown elsewhere on this page do not count toward it. See the score breakdown."
                    >
                      {/* Cycle 12 (Flow 3): the word "charitable" used to live ONLY in the
                          aria-label, so a SIGHTED reader arriving from a feed card about someone's
                          political money read a bare "no giving data" a few inches above this same
                          page's own "$3,213,200 in federal contributions". Measured 2026-09-02:
                          277 of 1,094 profiles carry this caveat and 194 of them state other money
                          below it — the page appeared to contradict itself on 17.7% of the index.
                          The caveat was never wrong; it is scoped to PHILANTHROPY, and the visible
                          text simply did not say so while the accessible name already did. */}
                      no charitable giving data
                    </a>
                  )}
                  {/* B-065: the grade divides giving by net worth; when that figure is undated or old,
                      the letter rests on it (Codex r3-1 #7 — the feed said so, the profile did not). */}
                  {netWorthDisplay.gradeUsesStaleNetWorth && (
                    <div className="profile-grade-caveat">
                      {netWorthDisplay.netWorthAsOf === "undated estimate"
                        ? "uses an undated net worth"
                        : `uses a net worth ${netWorthDisplay.netWorthAsOf}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {person.gradeStatus === "not_graded" && (
            // The grade slot, stated in words: no letter, no number (grade-status.ts serves none).
            <div className="profile-quick-stat">
              <div>
                <a href="#score-breakdown" className="profile-not-graded">{NOT_GRADED_LABEL}</a>
                <div className="profile-not-graded-reason">{NOT_GRADED_REASON}</div>
              </div>
            </div>
          )}
          {netWorthFact && (
            <div className="profile-quick-stat">
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                {String(netWorthFact.factValue)}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                Est. Net Worth
                {/* B-065: a Wikidata figure has no stored as-of date and its "retrieved" date is our
                    fetch, not when it was true (Bloomberg's "~$55.5B" is Wikidata's 2019 value). */}
                {netWorthAgeLabel(netWorthAge(netWorthFact)) ? ` (${netWorthAgeLabel(netWorthAge(netWorthFact))})` : ""}
                <br />
                <SourceCitation fact={netWorthFact} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Vote */}
      <div style={{ margin: "1.5rem 0" }}>
        <VoteButtons personId={person.id} />
      </div>

      {/* Compare — /compare has existed since launch and NOTHING on this page pointed at
          it. Measured 2026-09-06: `grep -rn "/compare" packages/web/src` returned the
          picker, sitemap, llms.txt and the OG-image files, and on this route a single
          COMMENT — so a visitor standing on a giving score had no route to the surface
          built for reacting to one, and the profile dead-ended at exactly that moment.
          Prefilled with `a` only: compare/page.tsx renders the person in a column and
          shows "Pick the second billionaire above" for the empty slot, so the picker
          opens one step from done rather than blank. Reuses .btn/.btn-secondary — no new
          CSS, so it inherits the theme tokens both modes already ship. */}
      <div style={{ margin: "1.5rem 0" }}>
        <a href={`/compare?a=${person.id}`} className="btn btn-secondary">
          Compare {person.name} with another billionaire &rarr;
        </a>
      </div>

      {/* AI Profile Summary */}
      {summaryFact && (
        <ProfileSummary
          fact={summaryFact}
          /* B-037 only. A B-038 withhold — hiding a paragraph whose party amounts do not account
             for the total it states — was built here on 2026-09-11 and DELIBERATELY NOT SHIPPED:
             three adversarial rounds reproduced thirteen ways it hid paragraphs that were correct,
             the last of them fundamental (the figures in prose carry no context, so a top
             recipient's amount is indistinguishable from a party subtotal). Withholding on a
             predicate that cannot tell those apart deletes true prose from a live profile. The
             defect is real — 41 of 791 judged profiles, `npm run check:party-sum` — and its fix is
             clean generator input plus a regeneration, not a render-time guess. */
          withholdPolitical={isFecRecordImpossible(
            (politicalFact?.factValue as { dateRange?: string } | undefined)?.dateRange,
            person.birthYear,
          )}
          politicalRecordRefreshedAt={politicalFact?.retrievedAt ?? null}
          netWorthFact={netWorthFact}
        />
      )}

      {/* U.S. Presence */}
      {person.usPresence.length > 0 && (
        <div className="card profile-section">
          <SectionHeader title="U.S. Presence" icon="US" />
          <div className="profile-presence-grid">
            {(person.usPresence as { type: string; details: string }[]).map((p, i) => (
              <div key={i} className="profile-presence-item">
                <span className="badge badge-primary">{p.type}</span>
                <span style={{ fontSize: "0.9rem" }}>{p.details}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data sections */}
      {hasDataSections && (
        <div className="profile-data-grid">
          {businessProfileFact && <BusinessProfileSection fact={businessProfileFact} />}
          {directGivingFact && <DirectGivingSection fact={directGivingFact} />}
          {philanthropyFact && <PhilanthropySection fact={philanthropyFact} />}
          {politicalFact && (
            <PoliticalSection
              fact={politicalFact}
              birthYear={person.birthYear}
              personName={person.name}
            />
          )}
          {secFact && <BusinessSection fact={secFact} />}
          {newsFact && <NewsSection fact={newsFact} />}
        </div>
      )}

      {/* Score breakdown — or, for a person we hold no giving record on, why there is none. */}
      {person.gradeStatus === "not_graded" ? (
        <NotGradedSection givingPledge={!!person.badges?.givingPledge} />
      ) : (
        <ScoreBreakdown
          score={person.score}
          factKeys={person.facts.map((f) => f.factKey)}
        />
      )}

      {/* Wikidata link */}
      {person.facts.length > 0 && (
        <p style={{ marginTop: "1.5rem", fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
          All data is sourced from public records. Each section links to its original source.
          {" "}
          <a
            href={`https://www.wikidata.org/wiki/${person.facts.find(f => f.sourceType === "wikidata")?.sourceUrl?.split("/").pop() || ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
            style={{ display: person.facts.some(f => f.sourceType === "wikidata") ? "inline" : "none" }}
          >
            View on Wikidata
          </a>
        </p>
      )}
    </div>
  );
}
