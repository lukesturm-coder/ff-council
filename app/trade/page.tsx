import { Suspense } from "react";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FuturesResponse,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { withMockPlatformRankings } from "@/lib/mock-platform-rankings";
import type { PlatformRankingsMap } from "@/app/_components/RankingsTable";
import TradeCalculator, {
  type TradePlayer,
} from "./TradeCalculator";

export const metadata: Metadata = {
  title: "Trade Calc · FF Council",
  description:
    "Side-by-side trade valuation using council consensus, Vegas-derived projections, and platform ADP.",
};

async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  return projectionsFromFutures(futures, roster);
}

type PlatformRow = {
  player_id: number;
  source: string;
  ranking_type: "editorial" | "adp";
  scoring_system: ScoringSystem;
  rank_value: number;
};

async function loadAllPlayers(): Promise<TradePlayer[]> {
  const supabase = await createClient();
  const projections = await loadProjections();

  const [platformResult, councilResult] = await Promise.all([
    supabase
      .from("platform_rankings")
      .select("player_id, source, ranking_type, scoring_system, rank_value"),
    supabase
      .from("council_consensus")
      .select("scoring_system, player_id, avg_rank"),
  ]);

  type PerScoring = Partial<Record<ScoringSystem, number>>;
  const council = new Map<number, PerScoring>();

  // Build a nested PlatformRankingsMap, then layer mock fill-in so deep
  // players have plausible numbers in every source column.
  const rawMap: PlatformRankingsMap = {};
  for (const r of (platformResult.data ?? []) as PlatformRow[]) {
    const player = rawMap[r.player_id] ?? (rawMap[r.player_id] = {});
    const source = player[r.source] ?? (player[r.source] = {});
    const byType = source[r.ranking_type] ?? (source[r.ranking_type] = {});
    byType[r.scoring_system] = Number(r.rank_value);
  }
  const platformMap = withMockPlatformRankings(rawMap, projections);

  for (const row of councilResult.data ?? []) {
    const existing = council.get(row.player_id as number) ?? {};
    existing[row.scoring_system as ScoringSystem] = Number(row.avg_rank);
    council.set(row.player_id as number, existing);
  }

  const pickRanks = (
    playerId: number,
    source: string,
    type: "editorial" | "adp",
  ): PerScoring => {
    return (platformMap[playerId]?.[source]?.[type] ?? {}) as PerScoring;
  };

  return projections.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    team: p.team,
    fantasyPoints: p.fantasyPoints,
    vbd: p.vbd,
    espnAdp: pickRanks(p.playerId, "espn", "adp"),
    fpAdp: pickRanks(p.playerId, "fantasypros", "adp"),
    sleeperAdp: pickRanks(p.playerId, "sleeper", "adp"),
    nflRank: pickRanks(p.playerId, "nfl", "editorial"),
    yahooRank: pickRanks(p.playerId, "yahoo", "editorial"),
    councilRank: council.get(p.playerId) ?? {},
  }));
}

export default async function TradePage() {
  const players = await loadAllPlayers();
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-xl font-semibold sm:text-2xl">Trade Calculator</h2>
          <p className="text-xs text-zinc-400 sm:text-sm">
            Add players to each side. See whether the trade is fair across
            every source we track — Vegas season points, ESPN, FantasyPros,
            Sleeper, NFL, Yahoo, and the Council Consensus.
          </p>
        </div>
        <Suspense fallback={null}>
          <TradeCalculator players={players} />
        </Suspense>
      </div>
    </main>
  );
}
