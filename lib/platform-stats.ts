import { createClient } from "@/lib/supabase/server";
import type { ImpliedStats } from "@/lib/types";

// playerId -> source -> { statKey: value } for season-long projected stats.
export type PlatformStatsMap = Record<
  number,
  Record<string, Partial<ImpliedStats>>
>;

/**
 * Load per-source projected stat lines from platform_player_stats (season-long
 * rows, week IS NULL). Tolerant: if the table doesn't exist yet (migration 021
 * not run) it returns an empty map so the rankings page still renders — the
 * matrix simply shows dashes for un-ingested sources.
 */
export async function loadPlatformStats(
  season = 2026,
): Promise<PlatformStatsMap> {
  const supabase = await createClient();
  const map: PlatformStatsMap = {};
  const pageSize = 1000;

  // Paginate past PostgREST's ~1000-row response cap — with multiple sources
  // this table easily exceeds 1000 rows, and an unpaginated read would drop
  // whole sources (showing dashes for ESPN/Sleeper even though data exists).
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("platform_player_stats")
      .select("source, player_id, stat, value")
      .eq("season", season)
      .is("week", null)
      .range(from, from + pageSize - 1);
    if (error) return map; // table missing (migration not run) or read error
    const rows = (data ?? []) as Array<{
      source: string;
      player_id: number;
      stat: string;
      value: number;
    }>;
    for (const row of rows) {
      const bySource = map[row.player_id] ?? (map[row.player_id] = {});
      const stats = bySource[row.source] ?? (bySource[row.source] = {});
      (stats as Record<string, number>)[row.stat] = Number(row.value);
    }
    if (rows.length < pageSize) break;
  }
  return map;
}
