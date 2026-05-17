import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FantasyPosition,
  FuturesResponse,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import Header from "@/app/_components/Header";
import SourceComparisonChart from "./SourceComparisonChart";

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
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

type Side = {
  players: { player_id: number | null; name: string; team: string; position: string }[];
  picks: { year: number; round: number; slot: number | null }[];
};
type TradeRow = {
  id: string;
  side_a: Side;
  side_b: Side;
  scoring: string;
  league_type: string;
  created_at: string;
  total_votes: number;
};

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId: playerIdStr } = await params;
  const playerId = Number(playerIdStr);
  if (!Number.isFinite(playerId)) notFound();

  const supabase = await createClient();

  const [projections, platformRows, councilRows, allTradesRes] =
    await Promise.all([
      loadProjections(),
      supabase
        .from("platform_rankings")
        .select("source, ranking_type, scoring_system, rank_value")
        .eq("player_id", playerId),
      supabase
        .from("council_consensus")
        .select("scoring_system, avg_rank, median_rank, stddev_rank, ranker_count")
        .eq("player_id", playerId),
      supabase
        .from("trade_submissions")
        .select(
          "id, side_a, side_b, scoring, league_type, created_at, trade_vote_summary(total_votes)",
        )
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  const player = projections.find((p) => p.playerId === playerId);
  if (!player) notFound();

  // Position rank within our pool
  const sameposSorted = [...projections]
    .filter((p) => p.position === player.position)
    .sort((a, b) => b.vbd.PPR - a.vbd.PPR);
  const positionRank =
    sameposSorted.findIndex((p) => p.playerId === playerId) + 1;
  const overallSorted = [...projections].sort((a, b) => b.vbd.PPR - a.vbd.PPR);
  const overallRank =
    overallSorted.findIndex((p) => p.playerId === playerId) + 1;

  // Group platform rankings by scoring for the chart
  const platformByScoring = {
    PPR: { espnEditorial: null as number | null, espnAdp: null as number | null, fpAdp: null as number | null },
    Half: { espnEditorial: null as number | null, espnAdp: null as number | null, fpAdp: null as number | null },
    Standard: { espnEditorial: null as number | null, espnAdp: null as number | null, fpAdp: null as number | null },
  };
  for (const row of platformRows.data ?? []) {
    const scoring = row.scoring_system as ScoringSystem;
    if (!platformByScoring[scoring]) continue;
    if (row.source === "espn" && row.ranking_type === "editorial") {
      platformByScoring[scoring].espnEditorial = Number(row.rank_value);
    } else if (row.source === "espn" && row.ranking_type === "adp") {
      platformByScoring[scoring].espnAdp = Number(row.rank_value);
    } else if (row.source === "fantasypros" && row.ranking_type === "adp") {
      platformByScoring[scoring].fpAdp = Number(row.rank_value);
    }
  }

  const councilByScoring: Partial<Record<ScoringSystem, { avgRank: number; rankerCount: number }>> = {};
  for (const row of councilRows.data ?? []) {
    councilByScoring[row.scoring_system as ScoringSystem] = {
      avgRank: Number(row.avg_rank),
      rankerCount: Number(row.ranker_count),
    };
  }

  // Recent trades involving this player
  const relevantTrades: TradeRow[] = [];
  for (const t of (allTradesRes.data ?? []) as Array<{
    id: string;
    side_a: Side;
    side_b: Side;
    scoring: string;
    league_type: string;
    created_at: string;
    trade_vote_summary: Array<{ total_votes: number }> | { total_votes: number } | null;
  }>) {
    const inA = t.side_a?.players?.some((p) => p.player_id === playerId);
    const inB = t.side_b?.players?.some((p) => p.player_id === playerId);
    if (!inA && !inB) continue;
    const summary = Array.isArray(t.trade_vote_summary)
      ? t.trade_vote_summary[0]
      : t.trade_vote_summary;
    relevantTrades.push({
      id: t.id,
      side_a: t.side_a,
      side_b: t.side_b,
      scoring: t.scoring,
      league_type: t.league_type,
      created_at: t.created_at,
      total_votes: Number(summary?.total_votes ?? 0),
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <Header />

        {/* Player header */}
        <div className="mb-4 flex flex-col gap-2 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-0">
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h2 className="text-xl font-semibold sm:text-2xl">{player.name}</h2>
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
              >
                {player.position}
              </span>
              <span className="font-mono text-sm text-zinc-400">
                {player.team}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              FF Council overall #{overallRank} · position #{positionRank} (
              {player.position})
            </p>
          </div>
          <Link
            href="/"
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← Rankings
          </Link>
        </div>

        {/* Headline stats grid */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Vegas FPts (PPR)" value={player.fantasyPoints.PPR.toFixed(1)} />
          <StatCard
            label="Vegas Edge (PPR)"
            value={`${player.vbd.PPR > 0 ? "+" : ""}${player.vbd.PPR.toFixed(1)}`}
            tone={player.vbd.PPR > 0 ? "emerald" : "zinc"}
          />
          <StatCard
            label="ESPN Rank"
            value={
              platformByScoring.PPR.espnEditorial != null
                ? `#${platformByScoring.PPR.espnEditorial}`
                : "—"
            }
          />
          <StatCard
            label="FP ADP"
            value={
              platformByScoring.PPR.fpAdp != null
                ? platformByScoring.PPR.fpAdp.toFixed(1)
                : "—"
            }
          />
        </div>

        {/* Source comparison chart */}
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Rank across sources (PPR)
          </h3>
          <SourceComparisonChart
            data={[
              {
                source: "Vegas",
                rank: overallRank,
                color: "#fbbf24",
              },
              ...(councilByScoring.PPR
                ? [
                    {
                      source: "Council",
                      rank: Math.round(councilByScoring.PPR.avgRank),
                      color: "#34d399",
                    },
                  ]
                : []),
              ...(platformByScoring.PPR.espnEditorial != null
                ? [
                    {
                      source: "ESPN",
                      rank: platformByScoring.PPR.espnEditorial,
                      color: "#fb7185",
                    },
                  ]
                : []),
              ...(platformByScoring.PPR.espnAdp != null
                ? [
                    {
                      source: "ESPN ADP",
                      rank: Math.round(platformByScoring.PPR.espnAdp),
                      color: "#f87171",
                    },
                  ]
                : []),
              ...(platformByScoring.PPR.fpAdp != null
                ? [
                    {
                      source: "FP ADP",
                      rank: Math.round(platformByScoring.PPR.fpAdp),
                      color: "#38bdf8",
                    },
                  ]
                : []),
            ]}
          />
          <p className="mt-3 text-xs text-zinc-500">
            Lower bars = ranked higher. Disagreement between sources = trade
            opportunity (a source that ranks this player higher than ADP is a
            sell signal; one that ranks lower is a buy signal).
          </p>
        </div>

        {/* Markets feeding the projection */}
        {player.markets.length > 0 && (
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Vegas markets feeding this projection
            </h3>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-zinc-500">
                <tr className="text-left">
                  <th className="py-1">Market</th>
                  <th className="py-1 text-right">Line</th>
                  <th className="hidden py-1 text-right sm:table-cell">Over</th>
                  <th className="hidden py-1 text-right sm:table-cell">Under</th>
                  <th className="py-1 text-right">Per week</th>
                </tr>
              </thead>
              <tbody>
                {player.markets.map((m) => (
                  <tr key={m.betType} className="border-t border-zinc-800/40">
                    <td className="py-1.5 text-zinc-200">{m.betType}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {m.line}
                    </td>
                    <td className="hidden py-1.5 text-right font-mono text-xs text-zinc-400 sm:table-cell">
                      {m.overPayout > 0 ? "+" : ""}
                      {m.overPayout}
                    </td>
                    <td className="hidden py-1.5 text-right font-mono text-xs text-zinc-400 sm:table-cell">
                      {m.underPayout > 0 ? "+" : ""}
                      {m.underPayout}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-zinc-400">
                      {(m.line / 17).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Trades involving this player */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Trade Court appearances
          </h3>
          {relevantTrades.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No trades involving {player.name} have been submitted yet.{" "}
              <Link
                href={`/trades/new`}
                className="text-emerald-300 underline-offset-4 hover:underline"
              >
                Submit one
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-2">
              {relevantTrades.map((t) => (
                <li
                  key={t.id}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/trades/${t.id}`}
                    className="block hover:bg-zinc-900/30"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                      <span className="text-zinc-200">
                        {t.side_a.players.map((p) => p.name).join(" + ") || "—"}{" "}
                        ↔{" "}
                        {t.side_b.players.map((p) => p.name).join(" + ") || "—"}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-zinc-500">
                        {t.total_votes} vote{t.total_votes === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {t.league_type} · {t.scoring} ·{" "}
                      {new Date(t.created_at).toLocaleDateString()}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: string;
  tone?: "zinc" | "emerald";
}) {
  const valueClass =
    tone === "emerald" ? "text-emerald-300" : "text-zinc-100";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}
