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
import ConsensusView, { type ConsensusRow } from "./ConsensusView";

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

type ConsensusRowDb = {
  scoring_system: string;
  player_id: number;
  ranker_count: number;
  avg_rank: number;
  median_rank: number;
  stddev_rank: number | null;
  min_rank: number;
  max_rank: number;
};

export default async function CouncilConsensusPage() {
  const supabase = await createClient();

  const [projections, { data: consensusRows }, { data: memberRows }] =
    await Promise.all([
      loadProjections(),
      supabase
        .from("council_consensus")
        .select(
          "scoring_system, player_id, ranker_count, avg_rank, median_rank, stddev_rank, min_rank, max_rank",
        ),
      supabase
        .from("council_members")
        .select("user_id", { count: "exact" })
        .eq("status", "approved"),
    ]);

  const playerById = new Map<number, PlayerProjection>(
    projections.map((p) => [p.playerId, p]),
  );

  const consensusByScoring: Record<ScoringSystem, ConsensusRow[]> = {
    PPR: [],
    Half: [],
    Standard: [],
  };

  for (const row of (consensusRows ?? []) as ConsensusRowDb[]) {
    const scoring = row.scoring_system as ScoringSystem;
    const player = playerById.get(row.player_id);
    if (!player) continue;
    consensusByScoring[scoring].push({
      playerId: row.player_id,
      name: player.name,
      team: player.team,
      position: player.position,
      vegasVbd: player.vbd[scoring],
      vegasFpts: player.fantasyPoints[scoring],
      rankerCount: row.ranker_count,
      avgRank: Number(row.avg_rank),
      medianRank: Number(row.median_rank),
      stddevRank: row.stddev_rank == null ? null : Number(row.stddev_rank),
      minRank: row.min_rank,
      maxRank: row.max_rank,
    });
  }

  // Sort each scoring system by avg rank ascending (rank 1 = best)
  for (const s of Object.keys(consensusByScoring) as ScoringSystem[]) {
    consensusByScoring[s].sort((a, b) => a.avgRank - b.avgRank);
  }

  const totalApprovedMembers = memberRows?.length ?? 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold sm:text-xl">Council Consensus</h2>
          <p className="text-xs text-zinc-400 sm:text-sm">
            Average ranking across {totalApprovedMembers} council member
            {totalApprovedMembers === 1 ? "" : "s"}&apos; current submissions.
            The <span className="text-zinc-200">spread</span> column shows
            disagreement — high spread = controversial pick. The Edge vs Vegas
            column compares Council consensus to the Vegas Edge ranking.
          </p>
        </div>

        <ConsensusView
          consensusByScoring={consensusByScoring}
          projections={projections}
        />
      </div>
    </main>
  );
}
