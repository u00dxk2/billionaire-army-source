import type { MetadataRoute } from "next";
import { apiFetch } from "@/lib/api";
import { SITE_URL } from "@/lib/site";

// AEO baseline (2026-06-29): the sitemap is the corpus-discovery mechanism. The
// citeable answer-content is the ~1,084 per-billionaire scorecards (each a fully
// SSR'd page with a sourced Public Benefit Score) — without enumerating them here,
// an AI crawler can't find them (the /billionaires index renders the swipe view,
// one card at a time). Static section pages are listed too.
//
// ISR: regenerate hourly so newly-scored / newly-seeded people appear. Fetch is
// wrapped so an API hiccup degrades to the static pages rather than failing the
// sitemap entirely.
export const revalidate = 3600;

interface PersonRow {
  id: string;
  updatedAt?: string | null;
  lastScoredAt?: string | null;
}

interface PersonsResponse {
  data: PersonRow[];
}

const STATIC_PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1.0, changeFrequency: "daily" },
  { path: "/billionaires", priority: 0.9, changeFrequency: "daily" },
  { path: "/leaderboard", priority: 0.9, changeFrequency: "daily" },
  { path: "/feed", priority: 0.8, changeFrequency: "daily" },
  { path: "/goals", priority: 0.7, changeFrequency: "weekly" },
  { path: "/today", priority: 0.7, changeFrequency: "daily" },
  { path: "/compare", priority: 0.6, changeFrequency: "weekly" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  // R-053 — the page addressed to the index itself. It is NOT in the nav by design (the nav
  // was just cut from 7 to 5), so the sitemap is how it gets found at all.
  { path: "/enlisted", priority: 0.6, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = STATIC_PAGES.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  let profileEntries: MetadataRoute.Sitemap = [];
  try {
    const persons = await apiFetch<PersonsResponse>("/api/persons?limit=2000", {
      next: { revalidate },
    });
    profileEntries = (persons?.data ?? []).map((person) => {
      const stamp = person.lastScoredAt || person.updatedAt;
      return {
        url: `${SITE_URL}/billionaires/${person.id}`,
        lastModified: stamp ? new Date(stamp) : now,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      };
    });
  } catch {
    // API unreachable at (re)generation time — serve the static pages so the
    // sitemap still validates; the per-person corpus refills on the next revalidate.
  }

  return [...staticEntries, ...profileEntries];
}
