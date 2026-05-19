import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
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
import RankClient from "./RankClient";

export const metadata: Metadata = {
  title: "Rank · FF Council",
  description:
    "Beli-style tier + pairwise flow. Pick a tier, answer a few quick comparisons, and your ranking falls into place.",
};

// Always fresh — the user's existing ranks live in supabase and we want to
// pick up cross-device edits.
export const dynamic = "force-dynamic";

/**
 * Build a unified pool of every roster player. Players with betting markets
 * come through `projectionsFromFutures` with real Vegas FPts; the remaining
 * roster entries (no markets in the mock data) are stubbed with zero FPts so
 * the client can still rank them — they'll fall to the bottom of the
 * Vegas-FPts-desc auto-served order and tie-break alphabetically.
 *
 * We intentionally widen the pool to the full 300-player roster so the flow
 * isn't artificially capped at the ~80 players with futures data.
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

  // Stubs for roster players without markets.
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

/**
 * Load each scoring system's current submission's ranking_entries, returned
 * as a {playerId: rank} dict per scoring system. Missing keys = scoring
 * systems with no prior submission.
 */
async function loadExistingRanks(
  userId: string,
): Promise<Partial<Record<ScoringSystem, Record<number, number>>>> {
  const supabase = await createClient();
  const { data: subs } = await supabase
    .from("ranking_submissions")
    .select("id, scoring_system, ranking_entries(player_id, rank)")
    .eq("member_id", userId)
    .eq("is_current", true);

  const out: Partial<Record<ScoringSystem, Record<number, number>>> = {};
  for (const row of subs ?? []) {
    const scoring = row.scoring_system as ScoringSystem;
    const entries = row.ranking_entries as Array<{
      player_id: number;
      rank: number;
    }>;
    const dict: Record<number, number> = {};
    for (const e of entries) dict[e.player_id] = e.rank;
    out[scoring] = dict;
  }
  return out;
}

export default async function CouncilRankPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/council/rank");

  const [projections, existing] = await Promise.all([
    loadProjections(),
    loadExistingRanks(user.id),
  ]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold sm:text-xl">My Rankings</h2>
          <p className="text-xs text-zinc-400 sm:text-sm">
            Drop each player into a tier, answer a few quick head-to-heads,
            and your full ordered list builds itself. Mid-rank a player from
            the search bar any time.
          </p>
        </div>

        <RankClient projections={projections} existingRanks={existing} />
      </div>
    </main>
  );
}
