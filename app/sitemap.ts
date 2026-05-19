import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

// =====================================================================
// /sitemap.xml — generated at request time. Combines a hand-curated list
// of static surfaces with the most-recent ~500 trade and verdict detail
// rows pulled from Supabase. Capped well under Google's 50k limit and
// falls back to static-only if either query fails so a Supabase blip
// never breaks discoverability.
// =====================================================================

const BASE_URL = "https://www.ffcouncil.com";
const DYNAMIC_ROW_CAP = 500;

const STATIC_PATHS = [
  "/",
  "/judge",
  "/trades",
  "/trades/new",
  "/trades/new/trade",
  "/verdict/new",
  "/draft",
  "/league",
  "/council",
  "/council/rankings",
  "/privacy",
  "/terms",
] as const;
// /trade and /verdict intentionally omitted — they now redirect to
// /trades. Including a redirect URL in the sitemap confuses crawlers.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
  }));

  let tradeEntries: MetadataRoute.Sitemap = [];
  let verdictEntries: MetadataRoute.Sitemap = [];

  try {
    const supabase = await createClient();
    const [tradesRes, verdictsRes] = await Promise.all([
      supabase
        .from("trade_submissions")
        .select("id, created_at")
        .order("created_at", { ascending: false })
        .limit(DYNAMIC_ROW_CAP),
      supabase
        .from("verdict_scenarios")
        .select("id, created_at")
        .order("created_at", { ascending: false })
        .limit(DYNAMIC_ROW_CAP),
    ]);

    if (!tradesRes.error && tradesRes.data) {
      tradeEntries = tradesRes.data.map((row) => ({
        url: `${BASE_URL}/trades/${row.id as string}`,
        lastModified: row.created_at ? new Date(row.created_at as string) : now,
      }));
    }

    if (!verdictsRes.error && verdictsRes.data) {
      verdictEntries = verdictsRes.data.map((row) => ({
        url: `${BASE_URL}/verdict/${row.id as string}`,
        lastModified: row.created_at ? new Date(row.created_at as string) : now,
      }));
    }
  } catch {
    // Supabase unreachable — return the static surface so the sitemap
    // still publishes. Next will retry on the following request.
  }

  // Dedup by URL. Defensive — guards against a dynamic id colliding with a
  // static path (e.g. a trade with id="new" producing /trades/new twice).
  // First write wins, which keeps the static entry's `lastModified=now`.
  const seen = new Set<string>();
  const all: MetadataRoute.Sitemap = [];
  for (const entry of [...staticEntries, ...tradeEntries, ...verdictEntries]) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    all.push(entry);
  }
  return all;
}
