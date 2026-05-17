import type { MetadataRoute } from "next";

// =====================================================================
// /robots.txt — allow all crawlers across the public surface and point
// them at the sitemap. Auth and member-only routes are explicitly
// disallowed so they don't show up in search results.
// =====================================================================

const BASE_URL = "https://www.ffcouncil.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/login",
          "/logout",
          "/me",
          "/council/admin",
          "/council/members",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
