"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type { FuturesResponse, ScoringSystem } from "@/lib/types";
import { buildPairs, type PlayerInfo, type EloRecord } from "./pair-select";

export type CastComparisonInput = {
  winnerId: number;
  loserId: number;
  scoringSystem: ScoringSystem;
};

export type CastComparisonResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Insert one comparison. The Elo update is performed by a database trigger
 * (see migration 015). We intentionally don't fetch the updated Elo back —
 * the client renders optimistic deltas locally, and the next pair batch
 * picks up fresh Elos when it loads.
 */
export async function castComparison(
  input: CastComparisonInput,
): Promise<CastComparisonResult> {
  if (input.winnerId === input.loserId) {
    return { ok: false, error: "Winner and loser must differ." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("player_comparisons").insert({
    voter_id: user?.id ?? null,
    winner_id: input.winnerId,
    loser_id: input.loserId,
    scoring_system: input.scoringSystem,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type FetchPairBatchInput = {
  scoringSystem: ScoringSystem;
  batchSize: number;
};

export type Pair = { a: PlayerInfo; b: PlayerInfo };

/**
 * Build a fresh batch of pairs by joining the projection roster with the
 * current player_elo table and running the Elo-aware sampling in pair-select.
 */
export async function fetchPairBatch(
  input: FetchPairBatchInput,
): Promise<Pair[]> {
  const players = await loadPlayers();
  const elos = await loadElos(input.scoringSystem);
  return buildPairs(players, elos, Math.max(1, Math.min(input.batchSize, 100)));
}

async function loadPlayers(): Promise<PlayerInfo[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  const projections = projectionsFromFutures(futures, roster);
  return projections.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position,
    fantasyPoints: p.fantasyPoints,
  }));
}

async function loadElos(
  scoringSystem: ScoringSystem,
): Promise<Map<number, EloRecord>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("player_elo")
    .select("player_id, elo, games_played")
    .eq("scoring_system", scoringSystem);
  const map = new Map<number, EloRecord>();
  for (const row of data ?? []) {
    map.set(row.player_id as number, {
      elo: Number(row.elo),
      gamesPlayed: Number(row.games_played),
    });
  }
  return map;
}
