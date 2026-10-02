import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// AEO baseline (2026-06-29): make Billionaire Army correctly machine-readable to
// AI crawlers. Every page here is public, sourced, civic-accountability data — we
// WANT it retrieved and cited by ChatGPT / Perplexity / Claude / AI search, so the
// default is an explicit welcome for the major AI crawlers plus a generic Allow: /.
// Reversible: delete this file to revert to no robots.txt.
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Welcome the AI crawlers explicitly (some honor only a named block).
      { userAgent: AI_CRAWLERS, allow: "/" },
      // Everyone else: all public content is fair game; keep auth/api private.
      { userAgent: "*", allow: "/", disallow: ["/login", "/auth/"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
