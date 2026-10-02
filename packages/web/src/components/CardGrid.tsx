"use client";

import { pbsGrade, NOT_GRADED_LABEL } from "@ba/shared";

interface Person {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  badges: { givingPledge?: boolean };
  images: string[];
  pbs: string | null;
  gradeStatus?: "graded" | "not_graded";
}

export default function CardGrid({ persons }: { persons: Person[] }) {
  return (
    <div className="card-grid">
      {persons.map((person) => {
        const grade = person.pbs ? pbsGrade(Number(person.pbs)) : null;

        return (
          <a
            key={person.id}
            href={`/billionaires/${person.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="card profile-card">
              <div className="profile-card-header">
                {person.images && person.images.length > 0 ? (
                  <img
                    src={person.images[0]}
                    alt={person.name}
                    className="profile-card-photo"
                  />
                ) : (
                  <div className="profile-card-avatar">
                    {person.name.split(" ").map((n: string) => n[0]).join("")}
                  </div>
                )}
                <div className="profile-card-info">
                  <div className="profile-card-name">{person.name}</div>
                  <div className="profile-card-meta">
                    {person.state && <span>{person.state}</span>}
                    {person.state && person.industry.length > 0 && <span>·</span>}
                    {person.industry.length > 0 && (
                      <span>{person.industry[0]}</span>
                    )}
                  </div>
                </div>
                {grade && (
                  <div
                    className="profile-card-grade"
                    style={{ background: grade.color }}
                  >
                    {grade.letter}
                  </div>
                )}
              </div>

              <div className="profile-card-tags">
                {person.industry.slice(0, 3).map((ind) => (
                  <span key={ind} className="badge badge-primary">{ind}</span>
                ))}
                {person.badges?.givingPledge && (
                  <span className="badge badge-green">Giving Pledge</span>
                )}
              </div>

              <div className="profile-card-footer">
                {/* null = not graded (no giving record on file) — the API serves no score for it. */}
                <span>{person.pbs ? `Giving score: ${Number(person.pbs).toFixed(1)}` : person.gradeStatus === "not_graded" ? NOT_GRADED_LABEL : ""}</span>
                <span>View profile &rarr;</span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
