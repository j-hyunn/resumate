import type { NextConfig } from "next";
import { checkSiteUrlForBuild } from "./src/server/auth/site-url-build-check";

// Fail Vercel production builds without a usable NEXT_PUBLIC_SITE_URL (auth redirect origin).
checkSiteUrlForBuild(process.env);

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
