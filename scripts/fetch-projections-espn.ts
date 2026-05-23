/**
 * Fetch ESPN season PROJECTED STAT LINES and write them into
 * platform_player_stats so the rankings expand matrix can show ESPN's
 * projection per player.
 *
 *   npm run fetch:projections:espn [season]
 *
 * Endpoint (unauthenticated, unofficial but long-stable):
 *   GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}
 *       /segments/0/leaguedefaults/3?view=kona_player_info
 *   with header x-fantasy-filter to page in many players.
 *
 * Each player.stats[] entry is tagged: statSourceId 1 = projection (0 =
 * actual), statSplitTypeId 0 = full-season total. We read the projection /
 * season entry's `stats` map (keyed by numeric stat id) and map the ids to our
 * ImpliedStats keys. NOTE: ESPN stat ids are unofficial — validate against a
 * live pull for a known player if numbers look off.
 *
 * Requires Supabase env in .env.local + migration 021 applied.
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

// ESPN numeric stat id → our ImpliedStats key.
const STAT_IDS: Record<number, string> = {
  3: "passingYards",
  4: "passingTouchdowns",
  20: "interceptions",
  24: "rushingYards",
  25: "rushingTouchdowns",
  53: "receptions",
  42: "receivingYards",
  43: "receivingTouchdowns",
};

// ESPN proTeamId → abbreviation (matches our roster's team codes).
const PRO_TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS",
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

type EspnStatEntry = {
  seasonId?: number;
  statSourceId?: number;
  statSplitTypeId?: number;
  stats?: Record<string, number>;
};
type EspnPlayer = {
  player?: {
    id?: number;
    fullName?: string;
    proTeamId?: number;
    stats?: EspnStatEntry[];
  };
};

async function fetchPlayers(season: number): Promise<EspnPlayer[]> {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-fantasy-filter": JSON.stringify({ players: { limit: 1500 } }),
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`ESPN ${season} → ${res.status}`);
  const json = (await res.json()) as { players?: EspnPlayer[] };
  return json.players ?? [];
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "players-mock.json"),
    "utf8",
  );
  return JSON.parse(raw) as RosterPlayer[];
}

type StatRow = {
  source: "espn";
  player_id: number;
  stat: string;
  value: number;
  season: number;
  week: null;
};

function seasonProjection(
  entries: EspnStatEntry[] | undefined,
  season: number,
): Record<string, number> | null {
  if (!entries) return null;
  const e = entries.find(
    (s) =>
      s.statSourceId === 1 &&
      s.statSplitTypeId === 0 &&
      (s.seasonId == null || s.seasonId === season) &&
      s.stats != null,
  );
  return e?.stats ?? null;
}

async function main() {
  const argSeason = process.argv[2] ? Number(process.argv[2]) : null;
  const seasons = argSeason
    ? [argSeason]
    : [new Date().getFullYear(), new Date().getFullYear() - 1];

  let players: EspnPlayer[] = [];
  let season = 0;
  for (const s of seasons) {
    try {
      const list = await fetchPlayers(s);
      const withProj = list.filter(
        (p) => seasonProjection(p.player?.stats, s) != null,
      ).length;
      console.log(`→ ${s}: ${list.length} players, ${withProj} with season projections`);
      if (withProj > 0) {
        players = list;
        season = s;
        break;
      }
    } catch (err) {
      console.log(`  ${s} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (season === 0) {
    console.error("❌ No usable ESPN projections.");
    process.exit(1);
  }

  const roster = await loadRoster();
  const matcher = new PlayerMatcher(roster);
  console.log(`  roster: ${roster.length} players`);

  const rows: StatRow[] = [];
  const seen = new Set<string>();
  let matched = 0;
  let unmatched = 0;
  for (const p of players) {
    const proj = seasonProjection(p.player?.stats, season);
    if (!proj) continue;
    const name = p.player?.fullName;
    if (!name) continue;
    const team = p.player?.proTeamId != null ? PRO_TEAM[p.player.proTeamId] : null;
    const m = matcher.match({ name, team: team ?? null });
    if (!m.matched) {
      unmatched++;
      continue;
    }
    matched++;
    for (const [idStr, ourKey] of Object.entries(STAT_IDS)) {
      const v = proj[idStr];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      const dedupe = `${m.playerId}:${ourKey}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({
        source: "espn",
        player_id: m.playerId,
        stat: ourKey,
        value: Math.round(v * 10) / 10,
        season,
        week: null,
      });
    }
  }
  console.log(`  matched ${matched} players (${unmatched} unmatched) → ${rows.length} stat rows`);

  console.log("→ Clearing prior ESPN season stat rows…");
  await supabase
    .from("platform_player_stats")
    .delete()
    .eq("source", "espn")
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
  console.log(`\n✅ ESPN projection stats synced (${rows.length} rows, season ${season}).`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
