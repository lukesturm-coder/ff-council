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
import Header from "@/app/_components/Header";
import RankingsEditor from "./RankingsEditor";

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

type ExistingRankings = Partial<Record<ScoringSystem, Map<number, number>>>;

async function loadExistingRankings(
  userId: string,
): Promise<ExistingRankings> {
  const supabase = await createClient();
  const { data: subs } = await supabase
    .from("ranking_submissions")
    .select("id, scoring_system, ranking_entries(player_id, rank)")
    .eq("member_id", userId)
    .eq("is_current", true);

  const result: ExistingRankings = {};
  for (const row of subs ?? []) {
    const scoring = row.scoring_system as ScoringSystem;
    const map = new Map<number, number>();
    for (const entry of row.ranking_entries as Array<{
      player_id: number;
      rank: number;
    }>) {
      map.set(entry.player_id, entry.rank);
    }
    result[scoring] = map;
  }
  return result;
}

export default async function MyRankingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projections, existing] = await Promise.all([
    loadProjections(),
    loadExistingRankings(user.id),
  ]);

  // Serialize the existing-rankings Maps so they survive the boundary.
  const existingSerialized: Partial<Record<ScoringSystem, Record<number, number>>> = {};
  for (const [key, map] of Object.entries(existing) as Array<
    [ScoringSystem, Map<number, number>]
  >) {
    existingSerialized[key] = Object.fromEntries(map);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <Header />
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold sm:text-xl">My Rankings</h2>
          <p className="text-xs text-zinc-400 sm:text-sm">
            Submit your personal draft rankings. They start pre-populated from
            the Vegas Edge baseline — use the ↑/↓ buttons to bump players up
            or down. Click <span className="text-zinc-200">Save</span> when
            you&apos;re done with a scoring system. Each scoring system
            (PPR/Half/Standard) is saved independently.
          </p>
        </div>

        <RankingsEditor
          projections={projections}
          existingRankings={existingSerialized}
        />
      </div>
    </main>
  );
}
