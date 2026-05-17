/**
 * Fetch ESPN editorial rankings + ADP via their unofficial public fantasy API,
 * map players to our SportsDataIO IDs, and upsert into platform_rankings.
 *
 *   npx tsx scripts/fetch-espn.ts [season]
 *
 * If a season is given, uses it. Otherwise tries current then falls back.
 *
 * ESPN exposes per-player ranking data on:
 *   https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/players
 * Requires the `x-fantasy-filter` header naming which views you want.
 *
 * Returned fields used:
 *   - player.id, player.fullName, player.proTeamId (mapped to abbrev), draftRanksByRankType
 *
 * draftRanksByRankType is keyed by ranking type (e.g. "STANDARD", "PPR") and
 * contains both an editorial rank (auctionValue / draftRank) and an ADP value.
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

// ESPN's internal proTeamId → team abbreviation map.
// Stable for years; if a franchise relocates this needs updating.
const PRO_TEAM_BY_ID: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
  21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA",
  27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

type ScoringKey = "STANDARD" | "PPR";
const SCORING_MAP: Record<ScoringKey, "Standard" | "PPR"> = {
  STANDARD: "Standard",
  PPR: "PPR",
};

type EspnPlayer = {
  id: number;
  fullName: string;
  proTeamId: number;
  defaultPositionId?: number;
  draftRanksByRankType?: Record<
    string,
    { rank: number; auctionValue?: number; published?: boolean }
  >;
  ownership?: {
    averageDraftPosition?: number;
    percentOwned?: number;
  };
};

async function fetchSeason(season: number): Promise<EspnPlayer[]> {
  // kona_player_info view is what the ESPN Draft Kit uses — gives draft ranks
  // + ownership/ADP. Filter limits to ranks 1-500 to skip the long tail.
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?view=kona_player_info`;
  const filter = {
    players: {
      filterActive: { value: true },
      filterRanksForRankTypes: { value: ["PPR", "STANDARD"] },
      filterRanksForSlotIds: { value: [0, 2, 4, 6, 17, 16] }, // QB, RB, WR, TE, K, D/ST
      limit: 500,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
    },
  };
  const res = await fetch(url, {
    headers: {
      "x-fantasy-filter": JSON.stringify(filter),
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`ESPN ${season} returned ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as EspnPlayer[];
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

type ParsedRow = {
  playerId: number;
  rankingType: "editorial" | "adp";
  scoringSystem: "Standard" | "PPR" | "Half";
  rankValue: number;
  playerName: string;
  playerTeam: string;
};

type UnmappedRow = {
  rankingType: "editorial" | "adp";
  scoringSystem: "Standard" | "PPR" | "Half";
  rankValue: number;
  rawName: string;
  rawTeam: string | null;
};

function parseEspn(
  espnRows: EspnPlayer[],
  matcher: PlayerMatcher,
): {
  matched: ParsedRow[];
  unmapped: UnmappedRow[];
  matchStats: Record<string, number>;
} {
  const matched: ParsedRow[] = [];
  const unmapped: UnmappedRow[] = [];
  const matchStats: Record<string, number> = {
    exact: 0,
    name_only: 0,
    lastname_team: 0,
    unmapped: 0,
    skipped_no_rank: 0,
    dropped_dup: 0,
  };

  type EspnRanked = {
    player: EspnPlayer;
    fullName: string;
    team: string | null;
    pprRank?: number;
    stdRank?: number;
    adp?: number;
  };

  // First pass: filter players with useful data
  const candidates: EspnRanked[] = [];
  for (const player of espnRows) {
    if (!player.fullName) continue;
    const team = PRO_TEAM_BY_ID[player.proTeamId] ?? null;
    const ranks = player.draftRanksByRankType ?? {};
    const pprRank =
      ranks.PPR?.rank != null && ranks.PPR.rank > 0 && ranks.PPR.rank <= 500
        ? ranks.PPR.rank
        : undefined;
    const stdRank =
      ranks.STANDARD?.rank != null &&
      ranks.STANDARD.rank > 0 &&
      ranks.STANDARD.rank <= 500
        ? ranks.STANDARD.rank
        : undefined;
    const adp =
      player.ownership?.averageDraftPosition != null &&
      player.ownership.averageDraftPosition > 0
        ? player.ownership.averageDraftPosition
        : undefined;
    if (pprRank == null && stdRank == null && adp == null) {
      matchStats.skipped_no_rank++;
      continue;
    }
    candidates.push({ player, fullName: player.fullName, team, pprRank, stdRank, adp });
  }

  // Second pass: run matching. Track best-confidence match per mock player
  // so a single ESPN player ↔ one mock player. Process in confidence order so
  // exact matches always beat fuzzy ones for the same mock player.
  const CONFIDENCE_RANK: Record<string, number> = {
    exact: 3,
    name_only: 2,
    lastname_team: 1,
  };
  const winnerByPlayerId = new Map<
    number,
    { candidate: EspnRanked; confidence: string }
  >();

  for (const c of candidates) {
    const m = matcher.match({ name: c.fullName, team: c.team });
    if (!m.matched) {
      // Stash unmapped rows here, no de-dup concern since they don't have
      // a mock playerId yet.
      const rows: { type: "editorial" | "adp"; scoring: "Standard" | "PPR"; value: number }[] = [];
      if (c.pprRank != null) rows.push({ type: "editorial", scoring: "PPR", value: c.pprRank });
      if (c.stdRank != null) rows.push({ type: "editorial", scoring: "Standard", value: c.stdRank });
      if (c.adp != null) rows.push({ type: "adp", scoring: "PPR", value: c.adp });
      for (const r of rows) {
        unmapped.push({
          rankingType: r.type,
          scoringSystem: r.scoring,
          rankValue: r.value,
          rawName: c.fullName,
          rawTeam: c.team,
        });
      }
      matchStats.unmapped++;
      continue;
    }
    matchStats[m.confidence]++;
    const existing = winnerByPlayerId.get(m.playerId);
    if (
      !existing ||
      (CONFIDENCE_RANK[m.confidence] ?? 0) >
        (CONFIDENCE_RANK[existing.confidence] ?? 0)
    ) {
      if (existing) matchStats.dropped_dup++;
      winnerByPlayerId.set(m.playerId, { candidate: c, confidence: m.confidence });
    } else {
      matchStats.dropped_dup++;
    }
  }

  // Third pass: emit matched rows from the winners
  for (const [playerId, { candidate: c }] of Array.from(winnerByPlayerId.entries())) {
    if (c.pprRank != null) {
      matched.push({
        playerId,
        rankingType: "editorial",
        scoringSystem: "PPR",
        rankValue: c.pprRank,
        playerName: c.fullName,
        playerTeam: c.team ?? "",
      });
    }
    if (c.stdRank != null) {
      matched.push({
        playerId,
        rankingType: "editorial",
        scoringSystem: "Standard",
        rankValue: c.stdRank,
        playerName: c.fullName,
        playerTeam: c.team ?? "",
      });
    }
    if (c.adp != null) {
      matched.push({
        playerId,
        rankingType: "adp",
        scoringSystem: "PPR",
        rankValue: c.adp,
        playerName: c.fullName,
        playerTeam: c.team ?? "",
      });
    }
  }

  return { matched, unmapped, matchStats };
}

async function upsertRows(rows: ParsedRow[]) {
  if (rows.length === 0) return;
  // Chunk to avoid Supabase row limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      player_id: r.playerId,
      source: "espn",
      ranking_type: r.rankingType,
      scoring_system: r.scoringSystem,
      rank_value: r.rankValue,
      player_name: r.playerName,
      player_team: r.playerTeam,
    }));
    const { error } = await supabase
      .from("platform_rankings")
      .upsert(chunk, {
        onConflict: "player_id,source,ranking_type,scoring_system",
      });
    if (error) throw new Error(`upsert failed: ${error.message}`);
  }
}

async function logUnmapped(rows: UnmappedRow[]) {
  if (rows.length === 0) return;
  // Wipe ESPN's previous unmapped batch so this table doesn't grow unbounded.
  await supabase
    .from("platform_rankings_unmapped")
    .delete()
    .eq("source", "espn");
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      source: "espn",
      ranking_type: r.rankingType,
      scoring_system: r.scoringSystem,
      rank_value: r.rankValue,
      raw_name: r.rawName,
      raw_team: r.rawTeam,
    }));
    await supabase.from("platform_rankings_unmapped").insert(chunk);
  }
}

async function main() {
  const argSeason = process.argv[2] ? Number(process.argv[2]) : null;
  const seasonsToTry = argSeason
    ? [argSeason]
    : [new Date().getFullYear(), new Date().getFullYear() - 1];

  let espnRows: EspnPlayer[] = [];
  let successfulSeason = 0;
  for (const season of seasonsToTry) {
    try {
      console.log(`→ Fetching ESPN season ${season}…`);
      const rows = await fetchSeason(season);
      console.log(`  ESPN returned ${rows.length} player rows`);
      const withRanks = rows.filter(
        (r) =>
          (r.draftRanksByRankType?.PPR?.rank ?? 0) > 0 ||
          (r.draftRanksByRankType?.STANDARD?.rank ?? 0) > 0 ||
          (r.ownership?.averageDraftPosition ?? 0) > 0,
      );
      console.log(
        `  ${withRanks.length} have draft-rank or ADP data; ${rows.length - withRanks.length} don't`,
      );
      if (withRanks.length > 0) {
        espnRows = rows;
        successfulSeason = season;
        break;
      }
      console.log(`  No rank data for ${season}, trying next…`);
    } catch (err) {
      console.log(
        `  ESPN ${season} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (espnRows.length === 0) {
    console.error("❌ No usable ESPN data from any season tried.");
    process.exit(1);
  }
  console.log(`\n  Using ESPN data from season ${successfulSeason}\n`);

  const roster = await loadRoster();
  console.log(`→ Loaded local roster: ${roster.length} players`);
  const matcher = new PlayerMatcher(roster);

  const { matched, unmapped, matchStats } = parseEspn(espnRows, matcher);
  console.log(`\n  Match stats: ${JSON.stringify(matchStats)}`);
  console.log(
    `  Matched rows ready to upsert: ${matched.length} (across editorial + adp × PPR + Standard)`,
  );
  console.log(`  Unmapped distinct rows: ${unmapped.length}`);

  console.log(`\n→ Upserting matched rows to platform_rankings…`);
  await upsertRows(matched);
  console.log(`  ✓ Upserted`);

  console.log(`→ Logging unmapped rows to platform_rankings_unmapped…`);
  await logUnmapped(unmapped);
  console.log(`  ✓ Logged`);

  console.log("\n✅ ESPN sync complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
