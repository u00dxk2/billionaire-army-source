"use client";

import { useState, useMemo } from "react";
import { pbsGrade, NOT_GRADED_LABEL } from "@ba/shared";
import { orderLeaderboard, isGradedEntry } from "@/lib/leaderboard-order";

interface LeaderboardEntry {
  person: { id: string; name: string; state: string | null; industry: string[] };
  /** null = not graded: no giving fact on file, so no score is served (grade-status.ts). */
  pbs: string | null;
  features: Record<string, number> | null;
  gradeStatus?: "graded" | "not_graded";
}

const isGraded = isGradedEntry;

const PAGE_SIZE = 50;

export default function LeaderboardView({ entries }: { entries: LeaderboardEntry[] }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const states = useMemo(
    () =>
      [
        ...new Set(
          entries.map((e) => e.person.state).filter((s): s is string => !!s)
        ),
      ].sort(),
    [entries]
  );

  const industries = useMemo(
    () => [...new Set(entries.flatMap((e) => e.person.industry))].sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = entries.filter((e) => {
      if (q && !e.person.name.toLowerCase().includes(q)) return false;
      if (stateFilter && e.person.state !== stateFilter) return false;
      if (industryFilter && !e.person.industry.includes(industryFilter)) return false;
      return true;
    });
    // Graded by score in the chosen direction, then the not graded by name — in BOTH directions.
    // The rule and its test live in lib/leaderboard-order.ts.
    return orderLeaderboard(matches, sortDir);
  }, [entries, query, stateFilter, industryFilter, sortDir]);

  const filtersActive = query.trim() !== "" || stateFilter !== "" || industryFilter !== "";

  function clearFilters() {
    setQuery("");
    setStateFilter("");
    setIndustryFilter("");
    setVisible(PAGE_SIZE);
  }

  function onFilterChange(setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      setVisible(PAGE_SIZE);
    };
  }

  const shown = filtered.slice(0, visible);

  return (
    <div>
      <div className="filter-bar">
        <input
          type="search"
          className="form-input filter-search"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => onFilterChange(setQuery)(e.target.value)}
          aria-label="Search leaderboard by name"
        />
        <select
          className="form-input filter-select"
          value={stateFilter}
          onChange={(e) => onFilterChange(setStateFilter)(e.target.value)}
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="form-input filter-select"
          value={industryFilter}
          onChange={(e) => onFilterChange(setIndustryFilter)(e.target.value)}
          aria-label="Filter by industry"
        >
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          className="form-input filter-select"
          value={sortDir}
          onChange={(e) => onFilterChange(setSortDir as (v: string) => void)(e.target.value)}
          aria-label="Sort by giving score"
        >
          <option value="desc">Best first (highest score)</option>
          <option value="asc">Worst first (lowest score)</option>
        </select>
        {filtersActive && (
          <button className="filter-clear" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {filtersActive && (
        <p className="filter-count">
          Showing {filtered.length.toLocaleString()} of {entries.length.toLocaleString()} —
          ranks shown are within this filter
        </p>
      )}

      {shown.length === 0 ? (
        <div className="empty-state">
          <p>No billionaires match those filters.</p>
          <p className="empty-hint">
            Try a broader search, or a different state or industry.
          </p>
          {filtersActive && (
            <button
              className="btn btn-secondary"
              onClick={clearFilters}
              style={{ marginTop: "0.75rem" }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>State</th>
              <th>Industry</th>
              <th style={{ textAlign: "right" }}>Giving score</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry, i) => {
              if (!isGraded(entry)) {
                // Listed, never ranked: no rank number, no letter, no score.
                return (
                  <tr key={entry.person.id} className="leaderboard-row--not-graded">
                    <td className="leaderboard-rank" aria-label="Not ranked">—</td>
                    <td className="leaderboard-name">
                      <a href={`/billionaires/${entry.person.id}`}>{entry.person.name}</a>
                    </td>
                    <td className="leaderboard-meta">{entry.person.state ?? "—"}</td>
                    <td className="leaderboard-meta">
                      {entry.person.industry.join(", ") || "—"}
                    </td>
                    <td
                      style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--color-text-secondary)" }}
                      title="No charitable giving record on file, so we do not score this person. That says nothing about how much they give."
                    >
                      {NOT_GRADED_LABEL}
                    </td>
                  </tr>
                );
              }
              const pbs = Number(entry.pbs);
              const grade = pbsGrade(pbs);
              return (
                <tr key={entry.person.id}>
                  <td
                    className={`leaderboard-rank ${
                      sortDir === "desc" && i < 3 ? "leaderboard-rank-top" : ""
                    }`}
                  >
                    {i + 1}
                  </td>
                  <td className="leaderboard-name">
                    <a href={`/billionaires/${entry.person.id}`}>
                      {entry.person.name}
                    </a>
                  </td>
                  <td className="leaderboard-meta">{entry.person.state ?? "—"}</td>
                  <td className="leaderboard-meta">
                    {entry.person.industry.join(", ") || "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>
                        {pbs.toFixed(1)}
                      </span>
                      <div
                        className="profile-grade-sm"
                        style={{
                          background: grade.color,
                          width: "28px",
                          height: "28px",
                          fontSize: "0.75rem",
                        }}
                      >
                        {grade.letter}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {filtered.length > visible && (
        <div className="feed-load-more">
          <button
            className="btn btn-secondary"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
          >
            Show More ({(filtered.length - visible).toLocaleString()} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
