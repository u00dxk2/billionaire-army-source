import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";
import BillionairesView from "@/components/BillionairesView";
import { SITE_URL } from "@/lib/site";
import { jsonLdString } from "@/lib/json-ld";

export const metadata: Metadata = {
  title: "All Billionaire Profiles — Giving Scores | Billionaire Army",
  description:
    "Browse every U.S.-connected billionaire we track, each carrying a giving score, with sourced philanthropy, political-giving, and SEC data. Search by name, state, or industry.",
  alternates: { canonical: "/billionaires" },
  openGraph: {
    title: "All Billionaire Profiles | Billionaire Army",
    description:
      "Every U.S.-connected billionaire we track, each carrying a giving score — every claim source-linked.",
    url: `${SITE_URL}/billionaires`,
    type: "website",
    siteName: "Billionaire Army",
  },
};

interface Person {
  id: string;
  name: string;
  state: string | null;
  industry: string[];
  badges: { givingPledge?: boolean; claimedPage?: boolean };
  images: string[];
  pbs: string | null;
}

interface PersonsResponse {
  data: Person[];
  pagination: { page: number; limit: number; total: number };
}

export default async function BillionairesPage() {
  let persons: PersonsResponse | null = null;
  let error: string | null = null;

  try {
    persons = await apiFetch<PersonsResponse>("/api/persons?limit=2000", {
      next: { revalidate: 60 },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load profiles";
  }

  // ItemList JSON-LD (AEO 2026-06-29): the visible index renders the swipe view
  // (one card at a time), so the corpus isn't link-discoverable in the markup.
  // Emit the full list as schema.org structured data — machine-readable corpus
  // discovery on the index itself, with zero change to the human-visible UX.
  const items = persons?.data ?? [];
  const itemListLd =
    items.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "U.S. billionaires with a giving score",
          numberOfItems: items.length,
          itemListElement: items.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE_URL}/billionaires/${p.id}`,
            name: p.name,
          })),
        }
      : null;

  return (
    <div>
      {itemListLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(itemListLd) }}
        />
      )}
      <div className="page-header">
        <h1 className="page-title">Billionaire Profiles</h1>
        <a href="/billionaires/propose" className="btn btn-approve btn-sm">
          + Propose
        </a>
      </div>
      <p className="page-subtitle">
        Approve or disapprove. Every fact is source-linked.
      </p>

      {error && (
        <p style={{ color: "var(--color-accent)" }}>
          {error} — try refreshing in a moment.
        </p>
      )}

      {persons?.data && persons.data.length > 0 && (
        <BillionairesView persons={persons.data} />
      )}

      {persons?.data.length === 0 && (
        <div className="empty-state">
          <p>No profiles to show yet.</p>
          <p className="empty-hint">
            Check back soon — profiles are added as the data pipeline runs.
          </p>
        </div>
      )}
    </div>
  );
}
