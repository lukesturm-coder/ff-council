import type { MetadataRoute } from "next";

// =====================================================================
// /manifest.webmanifest — PWA manifest so iOS / Android users can add
// FF Council to their home screen and have it open in standalone mode
// with the brand zinc-950 background. No icon files exist yet, so the
// icons array is intentionally omitted; the browser will fall back to
// the favicon for the home-screen tile.
// =====================================================================

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FF Council",
    short_name: "FF Council",
    description:
      "Crowdsourced fantasy football rankings from the FF Council, with Vegas and ESPN as supporting sources.",
    start_url: "/",
    display: "standalone",
    theme_color: "#09090b",
    background_color: "#09090b",
  };
}
