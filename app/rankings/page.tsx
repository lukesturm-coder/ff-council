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
import TradePrompt from "../_components/TradePrompt";
import ActivityTicker from "../_components/ActivityTicker";
import CouncilActivity from "../_components/CouncilActivity";
import RankingsTable, {
  type CouncilConsensusMap,
  type PlatformRankingsMap,
} from "../_components/RankingsTable";

export const metadata: Metadata = {
  title: "Rankings · FF Council",
  description:
    "Council-derived fantasy football rankings with Vegas, ESPN, and FantasyPros side by side.",
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
};

/**
 * Group platform_rankings rows into a nested map for cheap lookup in the UI:
 *   playerId → source → rankingType → scoringSystem → rank
 */
async function loadPlatformRankings(): Promise<PlatformRankingsMap> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_rankings")
    .select("player_id, source, ranking_type, scoring_system, rank_value");

  const map: PlatformRankingsMap = {};
  for (const r of (data ?? []) as PlatformRow[]) {
    const player = map[r.player_id] ?? (map[r.player_id] = {});
    const source = player[r.source] ?? (player[r.source] = {});
    const byType = source[r.ranking_type] ?? (source[r.ranking_type] = {});
    byType[r.scoring_system] = Number(r.rank_value);
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

export default async function RankingsPage() {
  const [projections, realPlatformRankings, councilConsensus] =
    await Promise.all([
      loadProjections(),
      loadPlatformRankings(),
      loadCouncilConsensus(),
    ]);

  // Real platforms only have ESPN + FantasyPros so far. Layer mock Sleeper /
  // NFL / CBS / Yahoo ranks on top so we can design the multi-source table
  // UX while we wait for those platforms to publish 2026 preseason data.
  const platformRankings = withMockPlatformRankings(realPlatformRankings, projections);

  const hasEspn = Object.values(platformRankings).some((p) => p.espn);
  const hasCouncil = Object.keys(councilConsensus).length > 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">

        <TradePrompt />

        <ActivityTicker />

        <RankingsTable
          projections={projections}
          platformRankings={platformRankings}
          councilConsensus={councilConsensus}
        />

        <CouncilActivity />

        <footer className="mt-12 space-y-2 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          <p>
            Council{" "}
            {hasCouncil
              ? "consensus active"
              : "(submit at /council/rankings)"}
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
