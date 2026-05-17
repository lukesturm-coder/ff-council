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
import Header from "@/app/_components/Header";
import TradeCalculator, {
  type TradePlayer,
} from "./TradeCalculator";

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
  const espnAdp = new Map<number, PerScoring>();
  const fpAdp = new Map<number, PerScoring>();
  const council = new Map<number, PerScoring>();

  for (const r of (platformResult.data ?? []) as PlatformRow[]) {
    const target =
      r.source === "espn" && r.ranking_type === "adp"
        ? espnAdp
        : r.source === "fantasypros" && r.ranking_type === "adp"
          ? fpAdp
          : null;
    if (!target) continue;
    const existing = target.get(r.player_id) ?? {};
    existing[r.scoring_system] = Number(r.rank_value);
    target.set(r.player_id, existing);
  }
  for (const row of councilResult.data ?? []) {
    const existing = council.get(row.player_id as number) ?? {};
    existing[row.scoring_system as ScoringSystem] = Number(row.avg_rank);
    council.set(row.player_id as number, existing);
  }

  return projections.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    team: p.team,
    fantasyPoints: p.fantasyPoints,
    vbd: p.vbd,
    espnAdp: espnAdp.get(p.playerId) ?? {},
    fpAdp: fpAdp.get(p.playerId) ?? {},
    councilRank: council.get(p.playerId) ?? {},
  }));
}

export default async function TradePage() {
  const players = await loadAllPlayers();
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Header />
        <div className="mb-4 space-y-1">
          <h2 className="text-2xl font-semibold">Trade Calculator</h2>
          <p className="text-sm text-zinc-400">
            Add players to each side. See whether the trade is fair through
            four lenses: Vegas season points, ESPN ADP, FantasyPros ADP, and
            the Council Consensus.
          </p>
        </div>
        <TradeCalculator players={players} />
      </div>
    </main>
  );
}
