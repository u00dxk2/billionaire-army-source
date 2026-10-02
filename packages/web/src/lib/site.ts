// Single source of truth for the public site base URL — used by every
// share / copy-link / OG tag / canonical / robots / sitemap / llms.txt so the
// would-tell-a-friend moment points somewhere LIVE.
//
// Production domain is billionaire.army (R-014, 2026-07-05): the owner pointed its
// DNS at Render as a custom domain on ba-web; verified live with a valid SSL
// cert. billionairearmy.com / billionairearmy.org are also owned but reserved
// for later. NEXT_PUBLIC_SITE_URL still overrides this at BUILD time if we ever
// need to A/B a host (it is unset on Render, so the fallback below IS production).
// This value is baked into the Next build — redeploy web after changing it.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://billionaire.army"
).replace(/\/+$/, "");
