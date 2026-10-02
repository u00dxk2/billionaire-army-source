import { apiFetch } from "@/lib/api";
import ComparePicker from "@/components/ComparePicker";
import { pbsGrade, foundationTotals, philanthropyZeroKind, isFecRecordImpossible, topPartyLabel, netWorthWithAge, NOT_GRADED_LABEL, NOT_GRADED_REASON } from "@ba/shared";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

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
  // Already on the wire — /api/persons/:id serves it and the profile page reads it. Declared here
  // 2026-09-02 because this column renders the FEC total and needs the same B-037 guard.
  birthYear: number | null;
  state: string | null;
  industry: string[];
  badges: Record<string, boolean>;
  images: string[];
  facts: Fact[];
  score: {
    pbs: string;
    features: Record<string, number>;
    date: string;
  } | null;
  gradeStatus?: "graded" | "not_graded";
}

interface ListResponse {
  data: { id: string; name: string }[];
}

// PBS v2's two real components. goalImpact / controversyInv / approval were v1
// hardcoded placeholders that v2 dropped, and they rendered as nothing only because
// the values are absent — with the scale fix below, a stale snapshot still carrying
// controversyInv: 0.7 would have printed "Controversy (inverted) 70%" as if measured.
const FEATURE_LABELS: Record<string, string> = {
  philanthropy: "Philanthropy",
  transparency: "Transparency",
};

function CompareColumn({ person }: { person: PersonDetail }) {
  const netWorthFact = person.facts.find((f) => f.factKey === "net_worth");
  const politicalFact = person.facts.find((f) => f.factKey === "fec_contributions");
  const philanthropyFact = person.facts.find((f) => f.factKey === "foundation_990s");

  const politicalRaw = politicalFact?.factValue as
    | {
        totalAmount: number;
        count: number;
        partyBreakdown: Record<string, number>;
        dateRange?: string;
      }
    | undefined;

  // B-037, THIRD surface. The guard had one call site (the profile's PoliticalSection); the profile
  // summary's prose was the second, found 2026-09-02, and this column is the third — a withheld
  // person's total was rendering here in full, beside anyone they were compared against. Same
  // shape as the og:image miss, which was commented at "the TWO call sites anyone had counted —
  // there were three". Withholding here means the row reads "—", identical to a person with no FEC
  // record at all: we decline to state a number we cannot stand behind, and this compact stat row
  // has no room to explain itself. The profile page is where the reader is told WHY, and it links
  // them to the FEC's own records.
  const political = isFecRecordImpossible(politicalRaw?.dateRange, person.birthYear)
    ? undefined
    : politicalRaw;

  const philanthropy = philanthropyFact?.factValue as
    | {
        foundations: { name: string; totalAssets: number; totalGrants: number }[];
      }
    | undefined;

  // B-030: same shared collapse the profile and the scorer use — an endowment trust counted
  // alongside the grantmaker it funds is excluded from the TOTAL. This also fixes a second,
  // older defect in passing: the grants reduce read `f.totalGrants`, which does not exist on the
  // stored shape (the field is `grantsPaid`), so Foundation Grants rendered $0 here for everyone
  // — the identical bug that routes/persons.ts carries a comment about having already fixed.
  const { totalAssets: foundationAssets, totalGrants: foundationGrants } =
    foundationTotals(philanthropy);

  // B-038, FOURTH surface. This sorted the RAW buckets and rendered `mostly ${code}` below, so a
  // reader saw "mostly NNE" / "mostly DFL" — and, because DEM and Dem are stored as two keys, the
  // sort compared FRAGMENTS of one party and could name the wrong lean entirely. `topPartyLabel`
  // folds first, excludes the buckets that name no party, and returns a human label or null.
  const topParty = political ? topPartyLabel(political.partyBreakdown) : null;

  const pbs = person.score ? Number(person.score.pbs) : null;
  const grade = pbs !== null ? pbsGrade(pbs) : null;

  return (
    <div className="card compare-col">
      <div className="compare-col-header">
        {person.images?.[0] ? (
          <img src={person.images[0]} alt={person.name} className="profile-card-photo" />
        ) : (
          <div className="profile-card-avatar">
            {person.name.split(" ").map((n) => n[0]).join("")}
          </div>
        )}
        <div>
          <a href={`/billionaires/${person.id}`} className="compare-col-name">
            {person.name}
          </a>
          <div className="profile-card-meta">
            {person.state && <span>{person.state}</span>}
            {person.state && person.industry.length > 0 && <span> · </span>}
            {person.industry.length > 0 && <span>{person.industry[0]}</span>}
          </div>
        </div>
        {grade && pbs !== null && (
          <div className="profile-card-grade" style={{ background: grade.color }}>
            {grade.letter}
          </div>
        )}
      </div>

      <dl className="compare-stats">
        <div className="compare-stat">
          <dt>Giving Score</dt>
          {/* A not-graded person is served `score: null` (no giving record on file). */}
          <dd>{pbs !== null ? pbs.toFixed(1) : person.gradeStatus === "not_graded" ? `${NOT_GRADED_LABEL} (${NOT_GRADED_REASON})` : "—"}</dd>
        </div>
        <div className="compare-stat">
          <dt>Est. Net Worth</dt>
          {/* B-065: the same age label as the profile — a comparison of two differently-dated fortunes is not a comparison. */}
          <dd>{netWorthFact ? netWorthWithAge(netWorthFact.factValue, netWorthFact) : "—"}</dd>
        </div>
        <div className="compare-stat">
          <dt>Political Giving (FEC)</dt>
          <dd>
            {political ? formatCurrency(political.totalAmount) : "—"}
            {topParty && (
              <span className="compare-stat-note">
                {" "}
                mostly {topParty}
              </span>
            )}
          </dd>
        </div>
        <div className="compare-stat">
          <dt>Foundation Assets (990s)</dt>
          <dd>{philanthropy?.foundations?.length ? formatCurrency(foundationAssets) : "—"}</dd>
        </div>
        <div className="compare-stat">
          <dt>Foundation Grants</dt>
          <dd>{philanthropy?.foundations?.length ? formatCurrency(foundationGrants) : "—"}</dd>
        </div>
        <div className="compare-stat">
          <dt>Giving Pledge</dt>
          <dd>{person.badges?.givingPledge ? "Signed" : "—"}</dd>
        </div>
      </dl>

      {person.score && (
        <div className="compare-features">
          <h4 className="profile-subsection-title">Score Components</h4>
          {Object.entries(FEATURE_LABELS).map(([key, label]) => {
            const value = person.score!.features[key];
            if (value === undefined) return null;
            // Features are stored 0..1 (Bill Gates philanthropy = 0.916). This rendered
            // them as raw numbers with toFixed(0), so the live page printed his 91.6% as
            // "1" and every value under 0.5 as "0" — with a bar under 1% wide. Verified on
            // prod 2026-08-22 before the fix. The profile's own breakdown has always used
            // value * 100; this page never got the memo.
            const pct = value * 100;
            const unevidenced =
              key === "philanthropy" &&
              philanthropyZeroKind(value, person.facts.map((f) => f.factKey)) === "unevidenced";
            return (
              <div key={key} className="profile-bar-row">
                <span className="profile-bar-label compare-bar-label">{label}</span>
                <div className="profile-bar-track">
                  <div
                    className="profile-bar-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, pct))}%`,
                      background: unevidenced
                        ? "var(--color-text-secondary)"
                        : "var(--color-primary)",
                      opacity: unevidenced ? 0.4 : 1,
                    }}
                  />
                </div>
                <span className="compare-bar-value">
                  {unevidenced ? "No data" : `${pct.toFixed(0)}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a = "", b = "" } = await searchParams;

  let pickerPersons: { id: string; name: string }[] = [];
  let personA: PersonDetail | null = null;
  let personB: PersonDetail | null = null;
  let error: string | null = null;

  try {
    const [list, detailA, detailB] = await Promise.all([
      apiFetch<ListResponse>("/api/persons?limit=2000", { next: { revalidate: 300 } }),
      a ? apiFetch<PersonDetail>(`/api/persons/${a}`, { cache: "no-store" }) : null,
      b ? apiFetch<PersonDetail>(`/api/persons/${b}`, { cache: "no-store" }) : null,
    ]);
    pickerPersons = list.data
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((x, y) => x.name.localeCompare(y.name));
    personA = detailA;
    personB = detailB;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load";
  }

  return (
    <div>
      <h1 className="page-title">Compare</h1>
      <p className="page-subtitle">
        Two billionaires, side by side — net worth, political giving, foundations,
        and giving score. Same sourced facts as the profiles.
      </p>

      {error && (
        <p style={{ color: "var(--color-accent)", textAlign: "center" }}>
          {error} — try refreshing in a moment.
        </p>
      )}

      <ComparePicker persons={pickerPersons} a={a} b={b} />

      {personA || personB ? (
        <div className="compare-grid">
          {personA ? <CompareColumn person={personA} /> : <div className="compare-placeholder">Pick the first billionaire above</div>}
          {personB ? <CompareColumn person={personB} /> : <div className="compare-placeholder">Pick the second billionaire above</div>}
        </div>
      ) : (
        !error && (
          <div className="empty-state">
            <p>Pick two billionaires to compare.</p>
          </div>
        )
      )}
    </div>
  );
}
