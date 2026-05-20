import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
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
import TierBoardEditor, {
  type ExistingRankings,
} from "./TierBoardEditor";
import type { TierLetter } from "../rank/actions";

// Always fresh — the member's saved board lives in supabase and we want
// cross-device edits to show up.
export const dynamic = "force-dynamic";

/**
 * Full 300-player pool: real Vegas projections plus stubs for roster players
 * without betting markets, so every player is draggable. Mirrors the loader in
 * /council/rank so both builders share an identical pool.
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

type EntryRow = { player_id: number; rank: number; tier: TierLetter | null };

/**
 * Load each scoring system's current submission as {playerId: {rank, tier}}.
 *
 * We try selecting the `tier` column first. If migration 018 hasn't been
 * applied yet PostgREST errors on the unknown column — we fall back to a
 * rank-only select and treat every tier as null (mirrors the projected_points
 * fallback in app/rankings/page.tsx). Null-tier players land in the pool, so
 * the board degrades gracefully.
 */
async function loadExistingRankings(
  userId: string,
): Promise<ExistingRankings> {
  const supabase = await createClient();

  const withTier = await supabase
    .from("ranking_submissions")
    .select("scoring_system, ranking_entries(player_id, rank, tier)")
    .eq("member_id", userId)
    .eq("is_current", true);

  let subs: Array<{
    scoring_system: string;
    ranking_entries: EntryRow[];
  }>;

  if (!withTier.error) {
    subs = (withTier.data ?? []) as typeof subs;
  } else {
    const fallback = await supabase
      .from("ranking_submissions")
      .select("scoring_system, ranking_entries(player_id, rank)")
      .eq("member_id", userId)
      .eq("is_current", true);
    subs = ((fallback.data ?? []) as Array<{
      scoring_system: string;
      ranking_entries: Array<{ player_id: number; rank: number }>;
    }>).map((row) => ({
      scoring_system: row.scoring_system,
      ranking_entries: row.ranking_entries.map((e) => ({ ...e, tier: null })),
    }));
  }

  const result: ExistingRankings = {};
  for (const row of subs) {
    const scoring = row.scoring_system as ScoringSystem;
    const dict: Record<number, { rank: number; tier: TierLetter | null }> = {};
    for (const e of row.ranking_entries) {
      dict[e.player_id] = { rank: e.rank, tier: e.tier ?? null };
    }
    result[scoring] = dict;
  }
  return result;
}

export default async function MyRankingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/council/rankings");

  const [projections, existing] = await Promise.all([
    loadProjections(),
    loadExistingRankings(user.id),
  ]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold sm:text-xl">
            My Rankings — Tier Board
          </h2>
          <p className="text-xs text-zinc-400 sm:text-sm">
            Drag players from the pool into tier rows to build your personal
            ranking. S holds your best players across every position; H is
            droppable. Order within a row matters. Auto-saves after each drop
            and feeds the Council column.
          </p>
        </div>

        <TierBoardEditor
          projections={projections}
          existingRankings={existing}
        />
      </div>
    </main>
  );
}
