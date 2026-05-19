import { promises as fs } from "node:fs";
import path from "node:path";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import { withMockPlatformRankings } from "@/lib/mock-platform-rankings";
import { createClient } from "@/lib/supabase/server";
import type {
  CouncilConsensusMap,
  PlatformRankingsMap,
} from "@/app/_components/RankingsTable";
import type {
  FuturesResponse,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import {
  computeSourceVerdicts,
  formatVerdict,
  type TradeSide,
} from "@/lib/source-verdicts";

type Props = {
  sideA: TradeSide;
  sideB: TradeSide;
  scoring: ScoringSystem;
  /** True when either side has at least one draft pick. */
  hasPicks: boolean;
};

async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-vegas.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-vegas.json"), "utf8"),
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
    if (!map[pid])
      map[pid] = {} as Record<
        ScoringSystem,
        { avgRank: number; rankerCount: number }
      >;
    map[pid][scoring] = {
      avgRank: Number(row.avg_rank),
      rankerCount: Number(row.ranker_count),
    };
  }
  return map;
}

/**
 * Render the relative-strength bar. We keep the bar visually centered on the
 * row label and let the segment grow toward Team A (left) or Team B (right).
 * Max width corresponds to a diff of `MAX_DIFF` fpts; anything bigger pegs.
 */
const MAX_DIFF = 50;

function VerdictBar({ diff }: { diff: number | null }) {
  if (diff == null) {
    return (
      <div className="relative h-2 w-full rounded-full bg-zinc-800">
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-700" />
      </div>
    );
  }
  const pegged = Math.max(-MAX_DIFF, Math.min(MAX_DIFF, diff));
  const widthPct = Math.min(50, (Math.abs(pegged) / MAX_DIFF) * 50);
  const isA = diff > 0;
  // Position the colored segment from the center toward the favored side.
  const left = isA ? `${50 - widthPct}%` : "50%";
  const color = isA ? "bg-rose-400/70" : "bg-sky-400/70";
  return (
    <div className="relative h-2 w-full rounded-full bg-zinc-800">
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-700" />
      <div
        className={`absolute inset-y-0 rounded-full ${color}`}
        style={{ left, width: `${widthPct}%` }}
      />
    </div>
  );
}

/**
 * Build a name+team → SDIO id index from the Vegas projection roster so we
 * can resolve trade-side players (which carry synthetic mock ids) to their
 * real SportsDataIO id for the Vegas projection lookup. Keys are normalized
 * (lowercased, alphanumeric-only) so capitalization or punctuation
 * differences don't cause misses.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildSdioIndex(projections: PlayerProjection[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of projections) {
    m.set(`${normalize(p.name)}|${normalize(p.team)}`, p.playerId);
    // Looser fallback keyed by name only — useful when teams change.
    if (!m.has(normalize(p.name))) m.set(normalize(p.name), p.playerId);
  }
  return m;
}

function resolveSdio(
  index: Map<string, number>,
  name: string,
  team: string,
): number | null {
  return (
    index.get(`${normalize(name)}|${normalize(team)}`) ??
    index.get(normalize(name)) ??
    null
  );
}

export default async function SourceVerdictsPanel({
  sideA,
  sideB,
  scoring,
  hasPicks,
}: Props) {
  const [projections, realPlatformRankings, councilConsensus] = await Promise.all([
    loadProjections(),
    loadPlatformRankings(),
    loadCouncilConsensus(),
  ]);
  // Same mock-layering trick the rankings page uses so Sleeper/NFL/Yahoo
  // have data while we wait on real 2026 preseason fetches.
  const platformRankings = withMockPlatformRankings(
    realPlatformRankings,
    projections,
  );

  // Resolve each trade-side player's SDIO id by name+team. The Vegas
  // computer prefers this id over the synthetic player_id the trade stores.
  const sdioIndex = buildSdioIndex(projections);
  const enrich = (s: TradeSide): TradeSide => ({
    ...s,
    players: s.players.map((p) => ({
      ...p,
      sdioPlayerId: resolveSdio(sdioIndex, p.name, p.team),
    })),
  });

  const verdicts = computeSourceVerdicts({
    sideA: enrich(sideA),
    sideB: enrich(sideB),
    scoring,
    projections,
    platformRankings,
    councilConsensus,
  });

  return (
    <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-300/90">
          Source Verdicts
        </h3>
        <p className="text-xs text-zinc-500">
          {scoring} scoring{hasPicks ? " · (picks not counted)" : ""}
        </p>
      </div>

      <div className="space-y-3">
        {verdicts.map((v) => {
          const isA = v.diff != null && v.diff > 0;
          const isB = v.diff != null && v.diff < 0;
          const winnerColor = isA
            ? "text-rose-300"
            : isB
              ? "text-sky-300"
              : v.dataUnavailable
                ? "text-zinc-500"
                : "text-zinc-300";
          return (
            <div
              key={v.key}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)_8.5rem] items-center gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_10rem]"
            >
              <span className="text-sm font-medium text-zinc-200">
                {v.label}
              </span>
              <VerdictBar diff={v.diff} />
              <span
                className={`text-right font-mono text-sm tabular-nums ${winnerColor}`}
                title={
                  v.dataUnavailable && v.missingPlayers.length > 0
                    ? `Missing: ${v.missingPlayers.join(", ")}`
                    : v.note
                }
              >
                {formatVerdict(v.diff, v.dataUnavailable)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Ranks converted to fantasy-point values via a linear positional curve;
        Vegas uses projected FPts directly. Sources missing any traded player
        show &ldquo;data unavailable&rdquo;.
      </p>
    </div>
  );
}
