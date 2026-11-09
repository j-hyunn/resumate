import type { NextConfig } from "next";
import { checkSiteUrlForBuild } from "./src/server/auth/site-url-build-check";
import { LEGACY_REDIRECTS } from "./src/lib/legacy-redirects";

// Fail Vercel production builds without a usable NEXT_PUBLIC_SITE_URL (auth redirect origin).
checkSiteUrlForBuild(process.env);

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // S-30 used to be one tabbed page at /policies?doc=…; each policy document now has its own page.
  // Done here (not in a page) so old links get an HTTP redirect without a dynamic searchParams read.
  async redirects() {
    return [
      {
        source: "/policies",
        has: [{ type: "query", key: "doc", value: "(?<doc>terms|privacy|cross_border_transfer)" }],
        destination: "/policies/:doc",
        permanent: true,
      },
      { source: "/policies", destination: "/policies/privacy", permanent: true },
      // retired S-09 · S-34 edit pages → S-08 (UQ-428); 자기소개서 관리 옛 주소 → S-46 / S-13 (v5.20, CF-1·CF-7)
      ...LEGACY_REDIRECTS,
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
