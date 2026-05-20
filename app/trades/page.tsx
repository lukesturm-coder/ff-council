import { Suspense } from "react";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
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
} from "./_components/TradeCalculator";

export const metadata: Metadata = {
  title: "Trade Court · FF Council",
  description:
    "A quick trade analyzer. Build a trade, see whether it's fair across Vegas, ESPN, FantasyPros, Sleeper, NFL, Yahoo, and the Council Consensus.",
};

// =====================================================================
// /trades — Trade Court. A PURE trade analyzer: the Trade Calculator
// (build a trade, see the source-by-source verdict table) and nothing
// else. The list of submitted trade scenarios moved OUT of here into
// the /judge community hub. The calculator's "Submit for community vote"
// action creates the trade and routes the user to the trade's detail
// page, which now lives in Judge's world.
// =====================================================================

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

async function loadCalculatorPlayers(): Promise<TradePlayer[]> {
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

  const rawMap: PlatformRankingsMap = {};
  for (const r of (platformResult.data ?? []) as PlatformRow[]) {
    const player = rawMap[r.player_id] ?? (rawMap[r.player_id] = {});
    const source = player[r.source] ?? (player[r.source] = {});
    const byType = source[r.ranking_type] ?? (source[r.ranking_type] = {});
    byType[r.scoring_system] = { rank: Number(r.rank_value), points: null };
  }
  const platformMap = withMockPlatformRankings(rawMap, projections);

  for (const row of councilResult.data ?? []) {
    const existing = council.get(row.player_id as number) ?? {};
    existing[row.scoring_system as ScoringSystem] = Number(row.avg_rank);
    council.set(row.player_id as number, existing);
  }

  // PlatformRankingsMap leaf is now { rank, points }; the Trade Calculator
  // still wants a flat Record<ScoringSystem, number> of ranks, so unwrap.
  const pickRanks = (
    playerId: number,
    source: string,
    type: "editorial" | "adp",
  ): PerScoring => {
    const byScoring = platformMap[playerId]?.[source]?.[type] ?? {};
    const out: PerScoring = {};
    for (const [scoring, entry] of Object.entries(byScoring)) {
      if (entry?.rank != null) out[scoring as ScoringSystem] = entry.rank;
    }
    return out;
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

export default async function TradesIndexPage() {
  const calcPlayers = await loadCalculatorPlayers();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {/* Trade Court — a quick, focused trade analyzer. No list of
            submitted trades here anymore; the council docket lives in
            /judge. Build a trade, read the source verdicts, optionally
            ship it to the community. */}
        <section className="mb-6">
          <div className="mb-4 flex flex-col gap-1">
            <h1 className="text-xl font-semibold sm:text-2xl">Trade Court</h1>
            <p className="text-xs text-zinc-400 sm:text-sm">
              A quick trade analyzer. Add players to each side and see whether
              the trade is fair across every source we track — Vegas season
              points, ESPN, FantasyPros, Sleeper, NFL, Yahoo, and the Council
              Consensus.
            </p>
          </div>
          <Suspense fallback={null}>
            <TradeCalculator players={calcPlayers} />
          </Suspense>
        </section>

        {/* Want crowd judgment instead of just the math? Point at Judge,
            where every submitted case now lives. */}
        <section className="border-t border-zinc-800 pt-5 text-sm text-zinc-400">
          Want the council&apos;s take on a trade?{" "}
          <Link
            href="/judge"
            className="font-medium text-emerald-300 underline-offset-4 hover:text-emerald-200 hover:underline"
          >
            See what the council is judging →
          </Link>
        </section>
      </div>
    </main>
  );
}
