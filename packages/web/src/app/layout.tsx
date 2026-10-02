import type { Metadata } from "next";
import Nav from "@/components/Nav";
import { SITE_URL } from "@/lib/site";
import { jsonLdString } from "@/lib/json-ld";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Billionaire Army — civic accountability for U.S. billionaires",
  description:
    "The public sets the goals; U.S. billionaires get scored on what they actually give — every claim source-linked, every score open. A free, donation-funded Skylark Creations project.",
  openGraph: {
    title: "Billionaire Army",
    description:
      "U.S. billionaires scored on what they actually give — every claim source-linked, every score open.",
    siteName: "Billionaire Army",
    type: "website",
  },
  // summary_large_image is correct ONLY because app/opengraph-image.tsx exists
  // and Next injects it site-wide (R-044). Removing that file means dropping
  // this back to "summary" in the same commit — a large-image card with no image
  // renders worse than a plain tile.
  twitter: {
    card: "summary_large_image",
  },
};

// Site-level entity markup (AEO 2026-06-29): a stable Organization + WebSite so AI
// crawlers recognize Billionaire Army as a consistent entity across every page.
const SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}#org`,
      name: "Billionaire Army",
      url: SITE_URL,
      description:
        "A free, donation-funded civic-accountability platform that gives every U.S. billionaire a giving score — how much of their wealth they actually give — with every claim source-linked.",
      // No `sameAs` while the repo is private. It pointed at a 404, which asserted
      // a profile we do not have to every crawler that reads this graph. Restore it
      // in the same commit that makes the repository public.
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}#website`,
      name: "Billionaire Army",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}#org` },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(SITE_LD) }}
        />
        <Nav />
        <main className="main">{children}</main>
        <footer className="footer">
          <p className="footer-tagline">Service is the price of the palace.</p>
          <nav className="footer-links" aria-label="Footer">
            <a href="/about">About</a>
            {/* A real address, not a page that tells you to open a GitHub
                issue. The only route into this product used to require a
                GitHub account, which for this audience is no route at all. */}
            <a href="mailto:hello@skylarkcreations.com?subject=Billionaire%20Army">
              Contact
            </a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            {/* No "Source on GitHub" link while the repository is private — it
                404'd on every page of the site. The commitment is kept in the
                footer text below instead of as a link that cannot be followed;
                restore the link in the same commit that makes the repo public. */}
          </nav>
          <p className="footer-meta">
            A Skylark Creations project — free and donation-funded. No ads, no
            premium tier. Every claim is source-linked; every score is open. The
            source isn&apos;t public yet; it goes up under an open licence before
            launch.
          </p>
        </footer>
      </body>
    </html>
  );
}
