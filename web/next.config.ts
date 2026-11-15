import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // /api/* routes read answer keys and field files with fs; make sure Vercel ships them (SERVER, issue #12).
  outputFileTracingIncludes: {
    "/api/**": [
      "./data/**",
      "./public/fields/index.json",
      "./public/fields/*/field.json",
      "./public/leaderboard-snapshot.json",
    ],
    "/credits": ["./content/**"],
    "/licence": ["./content/**"],
  },
};

export default nextConfig;
