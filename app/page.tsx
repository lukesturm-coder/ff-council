import { promises as fs } from "node:fs";
import path from "node:path";
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
import Header from "./_components/Header";
import TradePrompt from "./_components/TradePrompt";
import RankingsTable, {
  type CouncilConsensusMap,
  type PlatformRankingsMap,
} from "./_components/RankingsTable";

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

/**
 * Group platform_rankings rows into a nested map for cheap lookup in the UI:
 *   playerId → source → rankingType → scoringSystem → rank
 */
async function loadPlatformRankings(): Promise<PlatformRankingsMap> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_rankings")
    .select("player_id, source, ranking_type, scoring_system, rank_value");

  const map: PlatformRankingsMap = {};
  for (const r of (data ?? []) as PlatformRow[]) {
    const player = map[r.player_id] ?? (map[r.player_id] = {});
    const source = player[r.source] ?? (player[r.source] = {});
    const byType = source[r.ranking_type] ?? (source[r.ranking_type] = {});
    byType[r.scoring_system] = Number(r.rank_value);
  }
  return map;
}

async function loadCouncilConsensus(): Promise<CouncilConsensusMap> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("council_consensus")
    .select("scoring_system, player_id, avg_rank, ranker_count");

  const map: CouncilConsensusMap = {};
  for (const row of data ?? []) {
    const pid = row.player_id as number;
    const scoring = row.scoring_system as ScoringSystem;
    if (!map[pid]) map[pid] = {} as Record<ScoringSystem, { avgRank: number; rankerCount: number }>;
    map[pid][scoring] = {
      avgRank: Number(row.avg_rank),
      rankerCount: Number(row.ranker_count),
    };
  }
  return map;
}

export default async function Page() {
  const [projections, realPlatformRankings, councilConsensus] = await Promise.all([
    loadProjections(),
    loadPlatformRankings(),
    loadCouncilConsensus(),
  ]);

  // Real platforms only have ESPN + FantasyPros so far. Layer mock Sleeper /
  // NFL / CBS / Yahoo ranks on top so we can design the multi-source table
  // UX while we wait for those platforms to publish 2026 preseason data.
  const platformRankings = withMockPlatformRankings(realPlatformRankings, projections);

  const hasEspn = Object.values(platformRankings).some((p) => p.espn);
  const hasCouncil = Object.keys(councilConsensus).length > 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <Header />

        <TradePrompt />

        <RankingsTable
          projections={projections}
          platformRankings={platformRankings}
          councilConsensus={councilConsensus}
        />

        <footer className="mt-12 space-y-2 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          <p>
            ESPN {hasEspn ? "rankings + ADP wired" : "(run `npm run fetch:espn`)"}
            {" · "}Council{" "}
            {hasCouncil
              ? "consensus active"
              : "(submit at /council/rankings)"}
            {" · "}
            <span className="text-amber-400/70">
              Vegas column is placeholder
            </span>{" "}
            (illustrative pending live data feed) · {projections.length} players
          </p>
          <p>
            <a
              href="/terms"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Terms
            </a>
            {" · "}
            <a
              href="/privacy"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Privacy
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
