import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to the monorepo. Without this, Next infers the root
  // by walking up for lockfiles and can latch onto a stray lockfile outside the
  // repo (which once broke `next build` with a /404 prerender error).
  outputFileTracingRoot: path.join(__dirname, "../.."),
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  transpilePackages: ["@ba/shared"],
  // Baseline hardening headers on every response. Deliberately no CSP — the
  // Next inline runtime scripts would need nonces/hashes, a bigger change than
  // this pass; add CSP as its own considered ship if wanted.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "commons.wikimedia.org",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
      },
    ],
  },
};

export default nextConfig;
