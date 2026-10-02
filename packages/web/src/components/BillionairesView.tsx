"use client";

import { useState, useEffect, useMemo } from "react";
import SwipeCards from "./SwipeCards";
import CardGrid from "./CardGrid";

interface Person {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  badges: { givingPledge?: boolean };
  images: string[];
  pbs: string | null;
}

type ViewMode = "swipe" | "grid";

export default function BillionairesView({ persons: personsRaw }: { persons: Person[] }) {
  // Canon Wave 3 (Rules 5/2): grid is the default — "Profiles" promises a
  // directory, and the swipe view asked for a verdict on a card with no facts.
  // Scored, data-rich profiles lead (PBS desc, unscored last, then A→Z).
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");

  const persons = useMemo(
    () =>
      [...personsRaw].sort((a, b) => {
        const pa = a.pbs !== null ? Number(a.pbs) : -1;
        const pb = b.pbs !== null ? Number(b.pbs) : -1;
        if (pb !== pa) return pb - pa;
        return a.name.localeCompare(b.name);
      }),
    [personsRaw]
  );

  useEffect(() => {
    const saved = localStorage.getItem("ba-view-mode") as ViewMode | null;
    if (saved === "swipe" || saved === "grid") setView(saved);
  }, []);

  function switchView(mode: ViewMode) {
    setView(mode);
    localStorage.setItem("ba-view-mode", mode);
  }

  const states = useMemo(
    () =>
      [...new Set(persons.map((p) => p.state).filter((s): s is string => !!s))].sort(),
    [persons]
  );

  const industries = useMemo(
    () => [...new Set(persons.flatMap((p) => p.industry))].sort(),
    [persons]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return persons.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (stateFilter && p.state !== stateFilter) return false;
      if (industryFilter && !p.industry.includes(industryFilter)) return false;
      return true;
    });
  }, [persons, query, stateFilter, industryFilter]);

  const filtersActive = query.trim() !== "" || stateFilter !== "" || industryFilter !== "";

  function clearFilters() {
    setQuery("");
    setStateFilter("");
    setIndustryFilter("");
  }

  return (
    <div>
      <div className="view-toggle">
        <button
          className={`view-toggle-btn ${view === "swipe" ? "active" : ""}`}
          aria-pressed={view === "swipe"}
          onClick={() => switchView("swipe")}
        >
          Swipe
        </button>
        <button
          className={`view-toggle-btn ${view === "grid" ? "active" : ""}`}
          aria-pressed={view === "grid"}
          onClick={() => switchView("grid")}
        >
          Grid
        </button>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          className="form-input filter-search"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search billionaires by name"
        />
        <select
          className="form-input filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
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
          onChange={(e) => setIndustryFilter(e.target.value)}
          aria-label="Filter by industry"
        >
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        {filtersActive && (
          <button className="filter-clear" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {filtersActive && (
        <p className="filter-count">
          Showing {filtered.length.toLocaleString()} of {persons.length.toLocaleString()}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="feed-empty">
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
      ) : view === "swipe" ? (
        <SwipeCards key={`${query}|${stateFilter}|${industryFilter}`} persons={filtered} />
      ) : (
        <CardGrid persons={filtered} />
      )}
    </div>
  );
}
