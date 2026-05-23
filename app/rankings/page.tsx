import type { Metadata } from "next";
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
import RankingsTable, {
  type CouncilConsensusMap,
  type MyRanksMap,
  type PlatformRankingsMap,
} from "../_components/RankingsTable";

export const metadata: Metadata = {
  title: "Rankings · FF Council",
  description:
    "Council-derived fantasy football rankings — Council, your own, Vegas, and platforms side by side.",
};

/**
 * Render every roster player on the rankings page — not just the ~89 vets
 * DraftKings/FanDuel currently have markets for. Strategy: build the Vegas
 * projections off the SDIO-keyed Vegas roster (which matches futures-vegas.json),
 * then remap them onto the mock roster's synthetic ids via name+team lookup.
 * Mock players without a Vegas match get a stub projection so they still
 * appear in the table — their Vegas column reads `—` per the
 * "dashes, not hiding" rule.
 */
async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [vegasFuturesRaw, vegasRosterRaw, mockRosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-vegas.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-vegas.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(vegasFuturesRaw);
  const vegasRoster: PlayerRosterEntry[] = JSON.parse(vegasRosterRaw);
  const mockRoster: PlayerRosterEntry[] = JSON.parse(mockRosterRaw);

  const vegasProjections = projectionsFromFutures(futures, vegasRoster);

  // Name+team → SDIO id index so we can match each mock-roster player to
  // their (different-id) Vegas projection.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sdioByKey = new Map<string, number>();
  for (const p of vegasRoster) {
    sdioByKey.set(`${norm(p.Name)}|${norm(p.Team)}`, p.PlayerID);
    if (!sdioByKey.has(norm(p.Name))) sdioByKey.set(norm(p.Name), p.PlayerID);
  }
  const projBySdio = new Map(vegasProjections.map((p) => [p.playerId, p]));

  return mockRoster.map((mock) => {
    const sdio =
      sdioByKey.get(`${norm(mock.Name)}|${norm(mock.Team)}`) ??
      sdioByKey.get(norm(mock.Name)) ??
      null;
    const vegas = sdio != null ? projBySdio.get(sdio) ?? null : null;
    if (vegas) {
      return {
        ...vegas,
        playerId: mock.PlayerID,
        name: mock.Name,
        team: mock.Team,
        adp: mock.AverageDraftPosition,
        adpPPR: mock.AverageDraftPositionPPR,
      };
    }
    return {
      playerId: mock.PlayerID,
      name: mock.Name,
      team: mock.Team,
      position: mock.FantasyPosition,
      adp: mock.AverageDraftPosition,
      adpPPR: mock.AverageDraftPositionPPR,
      impliedStats: {},
      fantasyPoints: { PPR: 0, Half: 0, Standard: 0 },
      markets: [],
      vbd: { PPR: 0, Half: 0, Standard: 0 },
    };
  });
}

type PlatformRow = {
  player_id: number;
  source: string;
  ranking_type: "editorial" | "adp";
  scoring_system: ScoringSystem;
  rank_value: number;
  /**
   * Column added in migration 016. Selecting it conditionally would require
   * inspecting the schema first — instead we ask for it and tolerate a missing
   * column at the source row level (null → no points).
   */
  projected_points: number | null;
};

/**
 * Group platform_rankings rows into a nested map for cheap lookup in the UI:
 *   playerId → source → rankingType → scoringSystem → { rank, points }
 *
 * If migration 016 hasn't been applied yet, `projected_points` won't exist
 * on the underlying table and PostgREST will error — we fall back to a
 * rank-only select and emit `points: null` so the Ranks view still works.
 */
async function loadPlatformRankings(): Promise<PlatformRankingsMap> {
  const supabase = await createClient();
  let rows: PlatformRow[] = [];
  const withPoints = await supabase
    .from("platform_rankings")
    .select(
      "player_id, source, ranking_type, scoring_system, rank_value, projected_points",
    );
  if (!withPoints.error) {
    rows = (withPoints.data ?? []) as PlatformRow[];
  } else {
    const fallback = await supabase
      .from("platform_rankings")
      .select("player_id, source, ranking_type, scoring_system, rank_value");
    rows = ((fallback.data ?? []) as Omit<PlatformRow, "projected_points">[]).map(
      (r) => ({ ...r, projected_points: null }),
    );
  }

  const map: PlatformRankingsMap = {};
  for (const r of rows) {
    const player = map[r.player_id] ?? (map[r.player_id] = {});
    const source = player[r.source] ?? (player[r.source] = {});
    const byType = source[r.ranking_type] ?? (source[r.ranking_type] = {});
    byType[r.scoring_system] = {
      rank: Number(r.rank_value),
      points:
        r.projected_points != null && Number.isFinite(Number(r.projected_points))
          ? Number(r.projected_points)
          : null,
    };
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

/**
 * The signed-in member's own ranking, as scoring_system → player_id → rank,
 * pulled from their current submission. Feeds the "Mine" column so users can
 * compare their own ranking against every source. Empty when logged out.
 */
async function loadMyRanks(userId: string): Promise<MyRanksMap> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ranking_submissions")
    .select("scoring_system, ranking_entries(player_id, rank)")
    .eq("member_id", userId)
    .eq("is_current", true);

  const out: MyRanksMap = {};
  for (const row of (data ?? []) as Array<{
    scoring_system: string;
    ranking_entries: Array<{ player_id: number; rank: number }>;
  }>) {
    const scoring = row.scoring_system as ScoringSystem;
    const dict: Record<number, number> = {};
    for (const e of row.ranking_entries) dict[e.player_id] = e.rank;
    out[scoring] = dict;
  }
  return out;
}

export default async function RankingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projections, realPlatformRankings, councilConsensus, myRanks] =
    await Promise.all([
      loadProjections(),
      loadPlatformRankings(),
      loadCouncilConsensus(),
      user ? loadMyRanks(user.id) : Promise.resolve({} as MyRanksMap),
    ]);

  // Real platform data is sparse pre-season. Layer mock Sleeper / NFL / Yahoo
  // ranks on top so the multi-source table stays populated while we wait for
  // those platforms to publish 2026 preseason data. (FantasyPros is no longer
  // surfaced as a column.)
  const platformRankings = withMockPlatformRankings(realPlatformRankings, projections);

  const hasEspn = Object.values(platformRankings).some((p) => p.espn);
  const hasCouncil = Object.keys(councilConsensus).length > 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">

        <RankingsTable
          projections={projections}
          platformRankings={platformRankings}
          councilConsensus={councilConsensus}
          myRanks={myRanks}
        />

        <footer className="mt-12 space-y-2 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          <p>
            Council{" "}
            {hasCouncil ? "consensus active" : "(build yours at /council)"}
            {" · "}
            ESPN {hasEspn ? "rankings + ADP wired" : "(run `npm run fetch:espn`)"}
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
