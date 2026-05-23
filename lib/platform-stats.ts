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
  const { data, error } = await supabase
    .from("platform_player_stats")
    .select("source, player_id, stat, value")
    .eq("season", season)
    .is("week", null);
  if (error) return {};

  const map: PlatformStatsMap = {};
  for (const row of (data ?? []) as Array<{
    source: string;
    player_id: number;
    stat: string;
    value: number;
  }>) {
    const bySource = map[row.player_id] ?? (map[row.player_id] = {});
    const stats = bySource[row.source] ?? (bySource[row.source] = {});
    (stats as Record<string, number>)[row.stat] = Number(row.value);
  }
  return map;
}
