import { promises as fs } from "node:fs";
import path from "node:path";
import { Suspense } from "react";
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
import TiersView, { type CouncilAvgMap } from "./TiersView";

export const metadata: Metadata = {
  title: "Tiers · FF Council",
  description:
    "Per-position fantasy football tiers from Jenks natural-breaks clustering of Vegas-derived projections. Tier-based drafting beats rank-based drafting because it tells you when to reach and when to wait — players in the same tier are roughly interchangeable; tier breaks are where real value cliffs appear.",
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

type ConsensusRowDb = {
  scoring_system: string;
  player_id: number;
  avg_rank: number;
  ranker_count: number;
};

export default async function TiersPage() {
  const supabase = await createClient();

  const [projections, { data: consensusRows }] = await Promise.all([
    loadProjections(),
    supabase
      .from("council_consensus")
      .select("scoring_system, player_id, avg_rank, ranker_count"),
  ]);

  // Shape council avg-rank as { scoring: { playerId: avgRank } } for the client.
  const councilByScoring: CouncilAvgMap = {
    PPR: {},
    Half: {},
    Standard: {},
  };
  for (const row of (consensusRows ?? []) as ConsensusRowDb[]) {
    const s = row.scoring_system as ScoringSystem;
    if (!councilByScoring[s]) continue;
    councilByScoring[s][row.player_id] = Number(row.avg_rank);
  }

  const hasCouncilData = Object.values(councilByScoring).some(
    (m) => Object.keys(m).length > 0,
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold sm:text-xl">Position Tiers</h2>
          <p className="text-xs text-zinc-400 sm:text-sm">
            Players are clustered by Vegas-implied fantasy points (or council
            average rank) into 3–8 numbered tiers per position using Jenks
            natural breaks. Within a tier, players are roughly interchangeable;
            between tiers, there&apos;s a real value cliff. Tier 1 is always
            the elite group.
          </p>
        </div>

        <Suspense fallback={null}>
          <TiersView
            projections={projections}
            councilByScoring={councilByScoring}
            hasCouncilData={hasCouncilData}
          />
        </Suspense>
      </div>
    </main>
  );
}
