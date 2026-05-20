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
import type { ConsensusRow } from "./ConsensusView";
import type { TierLetter } from "./rank/actions";
import type { ExistingRankings } from "./rankings/TierBoardEditor";
import RankingsHub, { type HubView } from "./RankingsHub";

export const metadata: Metadata = {
  title: "Council Rankings · FF Council",
  description:
    "The council rankings hub — build your own (tap-flow or tier board) and see the aggregated council consensus.",
};

// Always fresh — consensus + the signed-in member's saved ranks live in
// supabase and we want cross-device edits to show up.
export const dynamic = "force-dynamic";

/**
 * Full 300-player pool: real Vegas projections plus stubs for roster players
 * without betting markets, so every player is rankable in the builders. The
 * consensus view only looks up players that appear in council_consensus rows,
 * so the wider pool is a harmless superset there.
 */
async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  const projected = projectionsFromFutures(futures, roster);
  const projectedIds = new Set(projected.map((p) => p.playerId));

  const stubs: PlayerProjection[] = roster
    .filter((r) => !projectedIds.has(r.PlayerID))
    .map((r) => ({
      playerId: r.PlayerID,
      name: r.Name,
      team: r.Team,
      position: r.FantasyPosition,
      adp: r.AverageDraftPosition,
      adpPPR: r.AverageDraftPositionPPR,
      impliedStats: {},
      fantasyPoints: { PPR: 0, Half: 0, Standard: 0 },
      vbd: { PPR: 0, Half: 0, Standard: 0 },
      markets: [],
    }));

  return [...projected, ...stubs];
}

const TIER_SET = new Set<TierLetter>([
  "S",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
]);

function asTier(t: string | null | undefined): TierLetter | null {
  return t && TIER_SET.has(t as TierLetter) ? (t as TierLetter) : null;
}

/**
 * Load the signed-in member's current submission per scoring system as
 * {playerId: {rank, tier}}. Tries the tier column first and falls back to
 * rank-only if migration 018 hasn't run (mirrors the builders' own loaders).
 */
async function loadExistingRanks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ExistingRankings> {
  const withTier = await supabase
    .from("ranking_submissions")
    .select("scoring_system, ranking_entries(player_id, rank, tier)")
    .eq("member_id", userId)
    .eq("is_current", true);

  let subs: Array<{
    scoring_system: string;
    ranking_entries: Array<{
      player_id: number;
      rank: number;
      tier?: string | null;
    }>;
  }>;

  if (!withTier.error) {
    subs = (withTier.data ?? []) as unknown as typeof subs;
  } else {
    const fallback = await supabase
      .from("ranking_submissions")
      .select("scoring_system, ranking_entries(player_id, rank)")
      .eq("member_id", userId)
      .eq("is_current", true);
    subs = (fallback.data ?? []) as unknown as typeof subs;
  }

  const out: ExistingRankings = {};
  for (const row of subs) {
    const scoring = row.scoring_system as ScoringSystem;
    const dict: Record<number, { rank: number; tier: TierLetter | null }> = {};
    for (const e of row.ranking_entries) {
      dict[e.player_id] = { rank: e.rank, tier: asTier(e.tier) };
    }
    out[scoring] = dict;
  }
  return out;
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

function normalizeView(v: string | undefined): HubView {
  return v === "rank" || v === "board" ? v : "council";
}

export default async function CouncilPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projections, { data: consensusRows }, { data: memberRows }, existing] =
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
      user
        ? loadExistingRanks(supabase, user.id)
        : Promise.resolve({} as ExistingRankings),
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

  for (const s of Object.keys(consensusByScoring) as ScoringSystem[]) {
    consensusByScoring[s].sort((a, b) => a.avgRank - b.avgRank);
  }

  const totalApprovedMembers = memberRows?.length ?? 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <RankingsHub
          initialView={normalizeView(searchParams.view)}
          isLoggedIn={Boolean(user)}
          projections={projections}
          existing={existing}
          consensusByScoring={consensusByScoring}
          totalApprovedMembers={totalApprovedMembers}
        />
      </div>
    </main>
  );
}
