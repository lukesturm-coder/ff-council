/**
 * Fetch Sleeper season-long PROJECTED STAT LINES (passing/rushing/receiving
 * yards, TDs, receptions, INTs), map players to our mock PlayerIDs, and write
 * them into platform_player_stats so the rankings expand matrix can show what
 * Sleeper projects per player — not just rank/points.
 *
 *   npm run fetch:projections:sleeper [season]
 *
 * Endpoint (unauthenticated, same one fetch-sleeper-adp uses for points):
 *   GET https://api.sleeper.app/v1/projections/nfl/regular/{season}
 *   → Record<sleeperId, { pts_ppr, pass_yd, rush_yd, rec, rec_yd, rec_td, ... }>
 * Player names/teams come from /v1/players/nfl. Stats are scoring-agnostic
 * raw totals, so we store one row per (player, stat) with week = null.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local,
 * and migration 021_platform_player_stats applied.
 */
import { config } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PlayerMatcher, type RosterPlayer } from "@/lib/player-matching";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing Supabase env vars in .env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SLEEPER_BASE = "https://api.sleeper.app";

// Sleeper stat key → our ImpliedStats key (lib/types.ts).
const STAT_MAP: Array<[string, string]> = [
  ["pass_yd", "passingYards"],
  ["pass_td", "passingTouchdowns"],
  ["pass_int", "interceptions"],
  ["rush_yd", "rushingYards"],
  ["rush_td", "rushingTouchdowns"],
  ["rec", "receptions"],
  ["rec_yd", "receivingYards"],
  ["rec_td", "receivingTouchdowns"],
];

type SleeperPlayer = {
  full_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  team?: string | null;
};

async function fetchProjections(
  season: number,
): Promise<Record<string, Record<string, number>>> {
  const res = await fetch(
    `${SLEEPER_BASE}/v1/projections/nfl/regular/${season}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Sleeper projections ${season} → ${res.status}`);
  return (await res.json()) as Record<string, Record<string, number>>;
}

async function fetchPlayerDirectory(): Promise<Record<string, SleeperPlayer>> {
  const res = await fetch(`${SLEEPER_BASE}/v1/players/nfl`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Sleeper /v1/players/nfl → ${res.status}`);
  return (await res.json()) as Record<string, SleeperPlayer>;
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "players-mock.json"),
    "utf8",
  );
  return JSON.parse(raw) as RosterPlayer[];
}

type StatRow = {
  source: "sleeper";
  player_id: number;
  stat: string;
  value: number;
  season: number;
  week: null;
};

async function main() {
  const argSeason = process.argv[2] ? Number(process.argv[2]) : null;
  const seasons = argSeason
    ? [argSeason]
    : [new Date().getFullYear(), new Date().getFullYear() - 1];

  let projections: Record<string, Record<string, number>> = {};
  let season = 0;
  for (const s of seasons) {
    try {
      const data = await fetchProjections(s);
      const nonEmpty = Object.values(data).filter(
        (p) => (p.rec_yd ?? 0) > 0 || (p.rush_yd ?? 0) > 0 || (p.pass_yd ?? 0) > 0,
      ).length;
      console.log(`→ ${s}: ${Object.keys(data).length} entries, ${nonEmpty} with stat lines`);
      if (nonEmpty > 0) {
        projections = data;
        season = s;
        break;
      }
    } catch (err) {
      console.log(`  ${s} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (season === 0) {
    console.error("❌ No usable Sleeper projection stat lines.");
    process.exit(1);
  }

  console.log("→ Fetching Sleeper player directory (~14MB)…");
  const dir = await fetchPlayerDirectory();
  const roster = await loadRoster();
  const matcher = new PlayerMatcher(roster);
  console.log(`  roster: ${roster.length} players`);

  const rows: StatRow[] = [];
  const seenPlayerStat = new Set<string>();
  let matched = 0;
  let unmatched = 0;
  for (const [sleeperId, proj] of Object.entries(projections)) {
    const hasAny = STAT_MAP.some(([k]) => typeof proj[k] === "number");
    if (!hasAny) continue;
    const p = dir[sleeperId];
    const name =
      p?.full_name ||
      (p?.first_name && p?.last_name ? `${p.first_name} ${p.last_name}` : "");
    if (!name) continue;
    const m = matcher.match({ name, team: p?.team ?? null });
    if (!m.matched) {
      unmatched++;
      continue;
    }
    matched++;
    for (const [sleeperKey, ourKey] of STAT_MAP) {
      const v = proj[sleeperKey];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      const dedupe = `${m.playerId}:${ourKey}`;
      if (seenPlayerStat.has(dedupe)) continue;
      seenPlayerStat.add(dedupe);
      rows.push({
        source: "sleeper",
        player_id: m.playerId,
        stat: ourKey,
        value: Math.round(v * 10) / 10,
        season,
        week: null,
      });
    }
  }
  console.log(`  matched ${matched} players (${unmatched} unmatched) → ${rows.length} stat rows`);

  // Delete-then-insert (NULL week breaks upsert onConflict dedup).
  console.log("→ Clearing prior Sleeper season stat rows…");
  await supabase
    .from("platform_player_stats")
    .delete()
    .eq("source", "sleeper")
    .eq("season", season)
    .is("week", null);

  console.log("→ Inserting…");
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await supabase
      .from("platform_player_stats")
      .insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`insert failed: ${error.message}`);
  }
  console.log(`\n✅ Sleeper projection stats synced (${rows.length} rows, season ${season}).`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
