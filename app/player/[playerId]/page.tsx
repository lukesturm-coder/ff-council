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
import {
  computeTiersByPlayer,
  tierLetter,
  tierStyle,
  tierDescription,
} from "@/lib/tiers";
import { relativeTimeShort } from "@/lib/relative-time";
import { buildSyntheticAdpHistory } from "@/lib/synthetic-adp";
import type { SyntheticAdpSource } from "@/lib/synthetic-adp-sources";
import SourceComparisonChart from "./SourceComparisonChart";
import AdpChart from "./AdpChart";

type VerdictCandidate = {
  player_id: number;
  name: string;
  team: string;
  position: FantasyPosition;
};
type VerdictContextShape = {
  scoring?: string;
  week?: number | null;
  position_needed?: string | null;
  league_size?: number | null;
  slot_type?: string | null;
  round?: number | null;
};

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
  votes_a: number;
  votes_b: number;
  votes_even: number;
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

  const [projections, platformRows, councilRows, allTradesRes, verdictRes] =
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
        .select("id, side_a, side_b, scoring, league_type, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      // Pull a recent slice of verdict scenarios and filter client-side
      // for ones containing this player. The candidates jsonb is small
      // (2–5 items) and we're capped at 200 scenarios, so this stays
      // cheap and avoids depending on a jsonb-containment index.
      supabase
        .from("verdict_scenarios")
        .select(
          "id, scenario_type, candidates, context, notes, created_at",
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
    PPR: { espnEditorial: null as number | null, espnAdp: null as number | null },
    Half: { espnEditorial: null as number | null, espnAdp: null as number | null },
    Standard: { espnEditorial: null as number | null, espnAdp: null as number | null },
  };
  for (const row of platformRows.data ?? []) {
    const scoring = row.scoring_system as ScoringSystem;
    if (!platformByScoring[scoring]) continue;
    if (row.source === "espn" && row.ranking_type === "editorial") {
      platformByScoring[scoring].espnEditorial = Number(row.rank_value);
    } else if (row.source === "espn" && row.ranking_type === "adp") {
      platformByScoring[scoring].espnAdp = Number(row.rank_value);
    }
  }

  const councilByScoring: Partial<Record<ScoringSystem, { avgRank: number; rankerCount: number }>> = {};
  for (const row of councilRows.data ?? []) {
    councilByScoring[row.scoring_system as ScoringSystem] = {
      avgRank: Number(row.avg_rank),
      rankerCount: Number(row.ranker_count),
    };
  }

  // Tier callout: compute this player's tier in each scoring system, plus
  // their rank within their position so we can render
  // "Tier 2 · PPR · top 6 RBs"-style copy. Tiers are derived from Vegas
  // FPts (same as /tiers), so this is fully consistent with that page.
  const SCORINGS: ScoringSystem[] = ["PPR", "Half", "Standard"];
  const tierByScoring: Partial<
    Record<
      ScoringSystem,
      {
        tier: number;
        totalTiers: number;
        positionRank: number; // 1-based rank within position for that scoring
        position: FantasyPosition;
      }
    >
  > = {};
  for (const s of SCORINGS) {
    const tiers = computeTiersByPlayer(projections, s);
    const info = tiers.get(playerId);
    if (!info) continue;
    // Position rank for this scoring: where this player sits when his
    // position is sorted descending by FPts in this scoring system.
    const sortedInPos = [...projections]
      .filter((p) => p.position === player.position)
      .sort((a, b) => b.fantasyPoints[s] - a.fantasyPoints[s]);
    const posRank =
      sortedInPos.findIndex((p) => p.playerId === playerId) + 1;
    tierByScoring[s] = {
      tier: info.tier,
      totalTiers: info.totalTiers,
      positionRank: posRank,
      position: info.position,
    };
  }

  // Recent trades involving this player.
  // Aggregate vote counts directly from trade_votes (the trade_vote_summary
  // view under-counts anon votes — same bug /me already routes around).
  const playerTrades: Array<{
    id: string;
    side_a: Side;
    side_b: Side;
    scoring: string;
    league_type: string;
    created_at: string;
  }> = [];
  for (const t of (allTradesRes.data ?? []) as Array<{
    id: string;
    side_a: Side;
    side_b: Side;
    scoring: string;
    league_type: string;
    created_at: string;
  }>) {
    const inA = t.side_a?.players?.some((p) => p.player_id === playerId);
    const inB = t.side_b?.players?.some((p) => p.player_id === playerId);
    if (!inA && !inB) continue;
    playerTrades.push(t);
  }

  const voteCountsByTrade = new Map<
    string,
    { total: number; votes_a: number; votes_b: number; votes_even: number }
  >();
  if (playerTrades.length > 0) {
    const { data: voteRows } = await supabase
      .from("trade_votes")
      .select("trade_id, winner")
      .in(
        "trade_id",
        playerTrades.map((t) => t.id),
      );
    for (const v of voteRows ?? []) {
      const tid = v.trade_id as string;
      const w = v.winner as "A" | "B" | "EVEN";
      const c =
        voteCountsByTrade.get(tid) ??
        { total: 0, votes_a: 0, votes_b: 0, votes_even: 0 };
      c.total += 1;
      if (w === "A") c.votes_a += 1;
      else if (w === "B") c.votes_b += 1;
      else if (w === "EVEN") c.votes_even += 1;
      voteCountsByTrade.set(tid, c);
    }
  }

  // Cap at 5 most recent (the source query is already ordered desc).
  const relevantTrades: TradeRow[] = playerTrades.slice(0, 5).map((t) => {
    const c = voteCountsByTrade.get(t.id);
    return {
      id: t.id,
      side_a: t.side_a,
      side_b: t.side_b,
      scoring: t.scoring,
      league_type: t.league_type,
      created_at: t.created_at,
      total_votes: c?.total ?? 0,
      votes_a: c?.votes_a ?? 0,
      votes_b: c?.votes_b ?? 0,
      votes_even: c?.votes_even ?? 0,
    };
  });

  // Verdict appearances: scenarios where this player_id appears in
  // the candidates jsonb array. We over-fetch 200 recent scenarios and
  // filter in JS (cheap given the small candidates payload), then take
  // the 5 most recent. For each we resolve current vote tallies in one
  // round-trip against verdict_votes and compute the leading candidate.
  type VerdictRow = {
    id: string;
    scenario_type: "draft" | "start_sit";
    candidates: VerdictCandidate[];
    context: VerdictContextShape;
    notes: string | null;
    created_at: string;
  };
  const playerVerdicts: VerdictRow[] = [];
  for (const v of (verdictRes.data ?? []) as Array<{
    id: string;
    scenario_type: string;
    candidates: unknown;
    context: unknown;
    notes: string | null;
    created_at: string;
  }>) {
    const cands = (v.candidates as VerdictCandidate[] | null) ?? [];
    if (!cands.some((c) => c.player_id === playerId)) continue;
    playerVerdicts.push({
      id: v.id,
      scenario_type: v.scenario_type as "draft" | "start_sit",
      candidates: cands,
      context: (v.context as VerdictContextShape | null) ?? {},
      notes: v.notes,
      created_at: v.created_at,
    });
    if (playerVerdicts.length >= 5) break;
  }

  const verdictTallies = new Map<
    string,
    { byPlayer: Record<number, number>; total: number }
  >();
  if (playerVerdicts.length > 0) {
    const { data: vvotes } = await supabase
      .from("verdict_votes")
      .select("scenario_id, pick_player_id")
      .in(
        "scenario_id",
        playerVerdicts.map((v) => v.id),
      );
    for (const row of vvotes ?? []) {
      const sid = row.scenario_id as string;
      const pid = row.pick_player_id as number;
      const t = verdictTallies.get(sid) ?? { byPlayer: {}, total: 0 };
      t.byPlayer[pid] = (t.byPlayer[pid] ?? 0) + 1;
      t.total += 1;
      verdictTallies.set(sid, t);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">

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

        {/* ───── NEW ANALYTICAL SECTIONS ─────
           Section A (stat block): tier letter + projection + Vegas VBD.
           Section B (rank across sources): horizontal bars built from inline SVG.
           Section C (Council vs Vegas disagreement gauge).
           Section D (In the news — recent trades + verdicts).
           All four use PPR as the canonical scoring system to keep the page
           focused (the existing tier callout below still surfaces all three
           scorings). */}
        {(() => {
          const ppr = "PPR" as const;
          const tierMap = computeTiersByPlayer(projections, ppr);
          const tierInfo = tierMap.get(playerId);
          const sectionATier = tierInfo
            ? {
                tier: tierInfo.tier,
                style: tierStyle(tierInfo.tier),
                letter: tierLetter(tierInfo.tier),
                desc: tierDescription(
                  tierInfo.tier,
                  tierInfo.position,
                  tierInfo.tierSize,
                ),
              }
            : null;

          // Section B: gather all sources where this player has a rank.
          // Color hex map mirrors the Tailwind accents used in RankingsTable.tsx
          // so the same player reads as the same "Council green" / "Vegas amber"
          // everywhere on the site.
          const SOURCE_COLOR: Record<string, string> = {
            Council: "#34d399", // emerald-400
            Vegas: "#fbbf24", // amber-400
            ESPN: "#f87171", // red-400
            Sleeper: "#22d3ee", // cyan-400
            NFL: "#60a5fa", // blue-400
            Yahoo: "#c084fc", // purple-400
          };

          const pickFromPlatformRowsPPR = (source: string): number | null => {
            const rows = (platformRows.data ?? []).filter(
              (r) => r.source === source && r.scoring_system === "PPR",
            );
            if (rows.length === 0) return null;
            const editorial = rows.find((r) => r.ranking_type === "editorial");
            const adp = rows.find((r) => r.ranking_type === "adp");
            const pick = editorial ?? adp ?? rows[0];
            return pick ? Number(pick.rank_value) : null;
          };

          const councilPpr = councilByScoring.PPR
            ? Math.round(councilByScoring.PPR.avgRank)
            : null;
          const vegasPpr = overallRank; // overall VBD-derived Vegas rank
          const espnPpr =
            platformByScoring.PPR.espnEditorial ??
            (platformByScoring.PPR.espnAdp != null
              ? Math.round(platformByScoring.PPR.espnAdp)
              : null);
          const sleeperPpr = pickFromPlatformRowsPPR("sleeper");
          const nflPpr = pickFromPlatformRowsPPR("nfl");
          const yahooPpr = pickFromPlatformRowsPPR("yahoo");

          // Order chosen for cognitive consistency: house brands first
          // (Council = us, Vegas = our model), then external networks.
          const sourceRanks: Array<{ source: string; rank: number }> = [
            { source: "Council", rank: councilPpr ?? Number.NaN },
            { source: "Vegas", rank: vegasPpr },
            { source: "ESPN", rank: espnPpr ?? Number.NaN },
            { source: "Sleeper", rank: sleeperPpr ?? Number.NaN },
            { source: "NFL", rank: nflPpr ?? Number.NaN },
            { source: "Yahoo", rank: yahooPpr ?? Number.NaN },
          ].filter((s) => Number.isFinite(s.rank)) as Array<{
            source: string;
            rank: number;
          }>;

          // Bar widths are normalized to the WORST rank present so the best
          // rank visually fills the row. A single-source player would yield a
          // 100% bar with no spread to compare — acceptable, since
          // "consensus disagreement" needs ≥2 sources anyway.
          const maxRank = sourceRanks.reduce(
            (m, s) => Math.max(m, s.rank),
            1,
          );
          const minRank = sourceRanks.reduce(
            (m, s) => Math.min(m, s.rank),
            Number.POSITIVE_INFINITY,
          );

          // Section C: Council vs Vegas delta. Positive = Council ranks the
          // player HIGHER (lower number) than Vegas → emerald, swings right.
          // Negative = Council is lower than Vegas → rose, swings left.
          const councilVegasDelta =
            councilPpr != null ? vegasPpr - councilPpr : null;
          // Scale: cap the gauge at ±20 spots. Beyond that the bar pegs the
          // edge and the magnitude is conveyed by the numeric label. 20 was
          // chosen because it's roughly two rounds of fantasy draft variance,
          // which is the largest "interesting" disagreement before it becomes
          // a stats-sample issue (one ranker hated the player, etc.).
          const GAUGE_CAP = 20;

          return (
            <>
              {/* Section A — stat block */}
              <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
                {/* Card 1 — Tier */}
                <div
                  className={`flex min-h-[120px] flex-col justify-between rounded-lg border ${
                    sectionATier?.style.border ?? "border-zinc-800"
                  } ${sectionATier?.style.row ?? "bg-zinc-900"} p-3 sm:p-4`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 sm:text-xs">
                    Tier
                  </p>
                  {sectionATier ? (
                    <>
                      <p
                        className={`font-mono text-3xl font-bold leading-none sm:text-5xl ${
                          sectionATier.style.badge
                            .split(" ")
                            .find((c) => c.startsWith("text-")) ??
                          "text-zinc-100"
                        }`}
                      >
                        {sectionATier.letter}
                      </p>
                      <p className="text-[10px] leading-tight text-zinc-400 sm:text-xs">
                        {sectionATier.desc}
                      </p>
                    </>
                  ) : (
                    <p className="font-mono text-2xl text-zinc-600">—</p>
                  )}
                </div>

                {/* Card 2 — Projection */}
                <div className="flex min-h-[120px] flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 sm:text-xs">
                    Projection
                  </p>
                  <p className="font-mono text-3xl font-bold leading-none text-zinc-100 sm:text-5xl">
                    {player.fantasyPoints.PPR.toFixed(1)}
                  </p>
                  <p className="text-[10px] text-zinc-400 sm:text-xs">
                    <span className="font-mono text-zinc-300">
                      {(player.fantasyPoints.PPR / 17).toFixed(1)}
                    </span>{" "}
                    per/wk · PPR
                  </p>
                </div>

                {/* Card 3 — Vegas VBD */}
                <div className="flex min-h-[120px] flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 sm:text-xs">
                    Vegas VBD
                  </p>
                  <p
                    className={`font-mono text-3xl font-bold leading-none sm:text-5xl ${
                      player.vbd.PPR > 0
                        ? "text-emerald-300"
                        : player.vbd.PPR < 0
                          ? "text-rose-300"
                          : "text-zinc-300"
                    }`}
                  >
                    {player.vbd.PPR > 0 ? "+" : ""}
                    {player.vbd.PPR.toFixed(1)}
                  </p>
                  <p className="text-[10px] text-zinc-500 sm:text-xs">
                    vs replacement
                  </p>
                </div>
              </div>

              {/* Section B — Rank across sources */}
              {sourceRanks.length > 0 && (
                <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                    Rank across sources
                  </h3>
                  <div className="space-y-1.5">
                    {sourceRanks.map((s) => {
                      // Width formula per spec: 1 - (rank-1)/maxRank.
                      // Clamp to a small minimum so the bar is always visible
                      // for the worst-ranked source (rank === maxRank yields a
                      // very thin sliver otherwise).
                      const raw = 1 - (s.rank - 1) / maxRank;
                      const pct = Math.max(2, Math.min(100, raw * 100));
                      const isBest = s.rank === minRank;
                      const isWorst =
                        s.rank === maxRank && minRank !== maxRank;
                      const color = SOURCE_COLOR[s.source] ?? "#a1a1aa";
                      return (
                        <div
                          key={s.source}
                          className="flex items-center gap-2 sm:gap-3"
                        >
                          <span className="w-[72px] shrink-0 text-xs text-zinc-400 sm:w-[80px] sm:text-sm">
                            {s.source}
                          </span>
                          <div className="relative h-5 flex-1 overflow-hidden rounded bg-zinc-800/50 sm:h-6">
                            <div
                              className="h-full rounded transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: color,
                                boxShadow: isBest
                                  ? "0 0 12px 1px rgba(52, 211, 153, 0.55)"
                                  : isWorst
                                    ? "0 0 12px 1px rgba(244, 63, 94, 0.45)"
                                    : undefined,
                              }}
                              aria-label={`${s.source} rank ${s.rank}`}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-300 sm:w-12 sm:text-sm">
                            #{s.rank}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[10px] text-zinc-500 sm:text-xs">
                    Longer bar = ranked higher. Emerald glow = highest-ranking
                    source · rose glow = lowest. Disagreement = trade signal.
                  </p>
                </div>
              )}

              {/* Section C — Council vs Vegas disagreement gauge */}
              {councilVegasDelta != null && (
                <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                    Council vs Vegas
                  </h3>
                  {(() => {
                    const delta = councilVegasDelta;
                    const absDelta = Math.abs(delta);
                    const magnitude = Math.min(absDelta, GAUGE_CAP);
                    // Each half of the gauge represents up to GAUGE_CAP spots.
                    const halfPct = (magnitude / GAUGE_CAP) * 50;
                    const isUp = delta > 0;
                    const isDown = delta < 0;
                    const label =
                      delta === 0
                        ? "Even with Vegas"
                        : isUp
                          ? `+${absDelta} spot${absDelta === 1 ? "" : "s"} vs Vegas`
                          : `−${absDelta} spot${absDelta === 1 ? "" : "s"} vs Vegas`;
                    const color = isUp
                      ? "#34d399"
                      : isDown
                        ? "#fb7185"
                        : "#71717a";
                    return (
                      <>
                        <div className="relative h-8 w-full overflow-hidden rounded bg-zinc-800/40">
                          {/* Center line */}
                          <div className="absolute left-1/2 top-0 z-10 h-full w-px -translate-x-1/2 bg-zinc-600" />
                          {/* The bar swings from the center outward */}
                          {delta !== 0 && (
                            <div
                              className="absolute top-0 h-full transition-all"
                              style={{
                                width: `${halfPct}%`,
                                backgroundColor: color,
                                left: isUp ? "50%" : undefined,
                                right: isDown ? "50%" : undefined,
                                boxShadow: isUp
                                  ? "0 0 10px rgba(52, 211, 153, 0.45)"
                                  : "0 0 10px rgba(251, 113, 133, 0.45)",
                              }}
                              aria-label={label}
                            />
                          )}
                        </div>
                        <div className="mt-2 flex items-baseline justify-between text-xs text-zinc-400">
                          <span>
                            <span className="text-rose-300">Vegas higher</span>{" "}
                            ←
                          </span>
                          <span
                            className={`font-mono text-sm font-semibold ${
                              isUp
                                ? "text-emerald-300"
                                : isDown
                                  ? "text-rose-300"
                                  : "text-zinc-400"
                            }`}
                          >
                            {label}
                          </span>
                          <span>
                            → <span className="text-emerald-300">Council higher</span>
                          </span>
                        </div>
                        <p className="mt-2 text-[10px] text-zinc-500 sm:text-xs">
                          Council #{councilPpr} · Vegas #{vegasPpr}.{" "}
                          {isUp
                            ? "The council is higher on this player than Vegas — sell candidate if you believe the market."
                            : isDown
                              ? "Vegas is higher than the council — potential buy-low if you trust the Vegas signal."
                              : "Both rank this player identically."}
                        </p>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Section D — In the news (compact two-column) */}
              <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {/* D-left: Recent trades */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 sm:text-sm">
                      Recent trades
                    </h3>
                    <Link
                      href="/trades"
                      className="text-[10px] text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline sm:text-xs"
                    >
                      All →
                    </Link>
                  </div>
                  {relevantTrades.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No trades involving {player.name} yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {relevantTrades.slice(0, 3).map((t) => {
                        const componentSum =
                          t.votes_a + t.votes_b + t.votes_even;
                        const totalSafe =
                          t.total_votes === componentSum
                            ? t.total_votes
                            : Math.max(t.total_votes, componentSum);
                        let leaderLabel: string | null = null;
                        let leaderPct = 0;
                        if (totalSafe > 0) {
                          if (
                            t.votes_a >= t.votes_b &&
                            t.votes_a >= t.votes_even
                          ) {
                            leaderLabel = "A";
                            leaderPct = Math.round(
                              (t.votes_a / totalSafe) * 100,
                            );
                          } else if (
                            t.votes_b >= t.votes_a &&
                            t.votes_b >= t.votes_even
                          ) {
                            leaderLabel = "B";
                            leaderPct = Math.round(
                              (t.votes_b / totalSafe) * 100,
                            );
                          } else {
                            leaderLabel = "Even";
                            leaderPct = Math.round(
                              (t.votes_even / totalSafe) * 100,
                            );
                          }
                        }
                        const aSummary =
                          t.side_a.players.map((p) => p.name).join(" + ") || "—";
                        const bSummary =
                          t.side_b.players.map((p) => p.name).join(" + ") || "—";
                        return (
                          <li key={t.id}>
                            <Link
                              href={`/trades/${t.id}`}
                              className="block rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs transition hover:border-zinc-700"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="line-clamp-1 text-zinc-200">
                                  {aSummary} ↔ {bSummary}
                                </span>
                                {leaderLabel && (
                                  <span className="shrink-0 font-mono text-[10px] text-emerald-300">
                                    {leaderLabel} {leaderPct}%
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[10px] text-zinc-500">
                                {totalSafe} vote{totalSafe === 1 ? "" : "s"} ·{" "}
                                {relativeTimeShort(t.created_at)}
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* D-right: Recent verdicts */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 sm:text-sm">
                      Recent verdicts
                    </h3>
                    <Link
                      href="/judge"
                      className="text-[10px] text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline sm:text-xs"
                    >
                      All →
                    </Link>
                  </div>
                  {playerVerdicts.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No verdicts featuring {player.name} yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {playerVerdicts.slice(0, 3).map((v) => {
                        const tally =
                          verdictTallies.get(v.id) ?? {
                            byPlayer: {},
                            total: 0,
                          };
                        let leader: VerdictCandidate | null = null;
                        let leaderCount = 0;
                        for (const c of v.candidates) {
                          const n = tally.byPlayer[c.player_id] ?? 0;
                          if (n > leaderCount) {
                            leaderCount = n;
                            leader = c;
                          }
                        }
                        const leaderPct =
                          tally.total > 0 && leader
                            ? Math.round((leaderCount / tally.total) * 100)
                            : 0;
                        const isThisPlayerLeading =
                          leader?.player_id === playerId && leaderCount > 0;
                        const summary =
                          v.scenario_type === "draft"
                            ? `${v.context.round ? `R${v.context.round}` : "Draft"}${
                                v.context.position_needed
                                  ? ` · ${v.context.position_needed}`
                                  : ""
                              }`
                            : `Start/Sit${
                                v.context.week ? ` · W${v.context.week}` : ""
                              }`;
                        return (
                          <li key={v.id}>
                            <Link
                              href={`/verdict/${v.id}`}
                              className="block rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs transition hover:border-zinc-700"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="line-clamp-1 text-zinc-200">
                                  {summary} —{" "}
                                  {v.candidates
                                    .map((c) => c.name)
                                    .join(" vs ")}
                                </span>
                                {leader && tally.total > 0 && (
                                  <span
                                    className={`shrink-0 font-mono text-[10px] ${
                                      isThisPlayerLeading
                                        ? "text-emerald-300"
                                        : "text-zinc-300"
                                    }`}
                                  >
                                    {leader.name.split(" ").slice(-1)[0]}{" "}
                                    {leaderPct}%
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[10px] text-zinc-500">
                                {tally.total} vote
                                {tally.total === 1 ? "" : "s"} ·{" "}
                                {relativeTimeShort(v.created_at)}
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* Tier callout — this player's Jenks tier under each scoring system,
           color-coded by tier color so you can read it at a glance. Renders
           nothing if we somehow don't have tier data (very small position
           pools, etc.). */}
        {SCORINGS.some((s) => tierByScoring[s]) && (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SCORINGS.map((s) => {
              const info = tierByScoring[s];
              if (!info) return null;
              const style = tierStyle(info.tier);
              return (
                <div
                  key={s}
                  className={`rounded-lg border ${style.border} ${style.row} p-3`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold ring-1 ring-inset ${style.badge}`}
                    >
                      Tier {info.tier}
                    </span>
                    <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                      {s}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-200">
                    <span className="font-semibold text-zinc-100">
                      #{info.positionRank}
                    </span>{" "}
                    of {info.position}s · {style.label}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Tier {info.tier} of {info.totalTiers}
                  </p>
                </div>
              );
            })}
          </div>
        )}

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
            label="ESPN ADP"
            value={
              platformByScoring.PPR.espnAdp != null
                ? platformByScoring.PPR.espnAdp.toFixed(1)
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
            ]}
          />
          <p className="mt-3 text-xs text-zinc-500">
            Lower bars = ranked higher. Disagreement between sources = trade
            opportunity (a source that ranks this player higher than ADP is a
            sell signal; one that ranks lower is a buy signal).
          </p>
        </div>

        {/* ADP movement over the last 12 preseason weeks. Synthetic placeholder
           data today (see lib/synthetic-adp.ts) — once a real snapshots table
           lands, only that builder swaps in. Hidden unless we have at least
           2 sources with a current rank for this player. */}
        {(() => {
          // Pick a representative current rank per source from platformRows.
          // Preference: editorial > adp > whatever PPR row we can find.
          // Vegas + Council aren't in platform_rankings; we inject them from
          // the values already computed above.
          const pickFromPlatformRows = (
            source: string,
          ): number | null => {
            const rows = (platformRows.data ?? []).filter(
              (r) => r.source === source && r.scoring_system === "PPR",
            );
            if (rows.length === 0) return null;
            const editorial = rows.find((r) => r.ranking_type === "editorial");
            const adp = rows.find((r) => r.ranking_type === "adp");
            const pick = editorial ?? adp ?? rows[0];
            return pick ? Number(pick.rank_value) : null;
          };

          const currentRanksBySource: Partial<
            Record<SyntheticAdpSource, number | null>
          > = {
            vegas: overallRank,
            council: councilByScoring.PPR
              ? Math.round(councilByScoring.PPR.avgRank)
              : null,
            espn:
              platformByScoring.PPR.espnEditorial ??
              (platformByScoring.PPR.espnAdp != null
                ? Math.round(platformByScoring.PPR.espnAdp)
                : null),
            sleeper: pickFromPlatformRows("sleeper"),
            nfl: pickFromPlatformRows("nfl"),
            yahoo: pickFromPlatformRows("yahoo"),
          };

          const sourcesWithRank = Object.values(currentRanksBySource).filter(
            (r): r is number => r != null,
          ).length;
          if (sourcesWithRank < 2) return null;

          const history = buildSyntheticAdpHistory(playerId, currentRanksBySource);

          return (
            <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                ADP movement (12 weeks)
              </h3>
              <AdpChart history={history} />
            </div>
          );
        })()}

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

        {/* In the news — recent trades involving this player. Shows the
           current council split per trade ("Team A 73% · 322 votes") so the
           card carries actionable weight, not just a body count. */}
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              In the news — Trades
            </h3>
            <Link
              href="/trades"
              className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              All trades →
            </Link>
          </div>
          {relevantTrades.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No trades involving {player.name} yet.{" "}
              <Link
                href="/trades/new"
                className="text-emerald-300 underline-offset-4 hover:underline"
              >
                Submit one
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-2">
              {relevantTrades.map((t) => {
                // Derive the leading side + consensus pct. With a known view
                // bug (012) total_votes can drift on older data, so we always
                // re-derive from raw counts on this page even though we also
                // re-aggregate above. votes_a + votes_b + votes_even should
                // equal total_votes; if they don't (stale/missing rows), we
                // trust the sum of the three component counts.
                const componentSum = t.votes_a + t.votes_b + t.votes_even;
                const totalSafe =
                  t.total_votes === componentSum
                    ? t.total_votes
                    : Math.max(t.total_votes, componentSum);
                let leaderLabel: string | null = null;
                let leaderPct = 0;
                if (totalSafe > 0) {
                  const aPct = Math.round((t.votes_a / totalSafe) * 100);
                  const bPct = Math.round((t.votes_b / totalSafe) * 100);
                  const evenPct = Math.round((t.votes_even / totalSafe) * 100);
                  if (t.votes_a >= t.votes_b && t.votes_a >= t.votes_even) {
                    leaderLabel = "Team A";
                    leaderPct = aPct;
                  } else if (t.votes_b >= t.votes_a && t.votes_b >= t.votes_even) {
                    leaderLabel = "Team B";
                    leaderPct = bPct;
                  } else {
                    leaderLabel = "Even";
                    leaderPct = evenPct;
                  }
                }
                return (
                  <li
                    key={t.id}
                    className="rounded-md border border-zinc-800 bg-zinc-950 text-sm transition hover:border-zinc-700"
                  >
                    <Link href={`/trades/${t.id}`} className="block px-3 py-2">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                        <span className="text-zinc-200">
                          {t.side_a.players.map((p) => p.name).join(" + ") ||
                            "—"}{" "}
                          ↔{" "}
                          {t.side_b.players.map((p) => p.name).join(" + ") ||
                            "—"}
                        </span>
                        <span className="shrink-0 font-mono text-xs">
                          {leaderLabel ? (
                            <>
                              <span className="text-emerald-300">
                                {leaderLabel} {leaderPct}%
                              </span>
                              <span className="text-zinc-500">
                                {" · "}
                                {totalSafe} vote{totalSafe === 1 ? "" : "s"}
                              </span>
                            </>
                          ) : (
                            <span className="text-zinc-500">
                              No votes yet
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {t.league_type} · {t.scoring} ·{" "}
                        {relativeTimeShort(t.created_at)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Verdict appearances — recent draft/start-sit scenarios where this
           player is one of the candidates. Shows the leading pick + total
           votes so the user can see whether the crowd is reaching for or
           passing on this player. */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Verdict appearances
            </h3>
            <Link
              href="/judge"
              className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              All verdicts →
            </Link>
          </div>
          {playerVerdicts.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No verdict scenarios featuring {player.name} yet.{" "}
              <Link
                href="/verdict/new"
                className="text-emerald-300 underline-offset-4 hover:underline"
              >
                Post one
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-2">
              {playerVerdicts.map((v) => {
                const tally =
                  verdictTallies.get(v.id) ?? { byPlayer: {}, total: 0 };
                // Leading candidate by raw count; ties resolve to the first
                // candidate in array order (stable + mirrors /verdict/[id]).
                let leader: VerdictCandidate | null = null;
                let leaderCount = 0;
                for (const c of v.candidates) {
                  const n = tally.byPlayer[c.player_id] ?? 0;
                  if (n > leaderCount) {
                    leaderCount = n;
                    leader = c;
                  }
                }
                const leaderPct =
                  tally.total > 0 && leader
                    ? Math.round((leaderCount / tally.total) * 100)
                    : 0;
                const isThisPlayerLeading =
                  leader?.player_id === playerId && leaderCount > 0;
                // One-line scenario summary; mirrors the verdict detail page.
                const summary =
                  v.scenario_type === "draft"
                    ? `${v.context.round ? `Round ${v.context.round}` : "Draft pick"}${
                        v.context.position_needed
                          ? ` — ${v.context.position_needed} needed`
                          : ""
                      }`
                    : `Start/Sit — ${
                        v.context.week ? `Week ${v.context.week}` : ""
                      }${v.context.slot_type ? ` ${v.context.slot_type}` : ""}`
                        .replace(/\s+/g, " ")
                        .trim();
                return (
                  <li
                    key={v.id}
                    className="rounded-md border border-zinc-800 bg-zinc-950 text-sm transition hover:border-zinc-700"
                  >
                    <Link href={`/verdict/${v.id}`} className="block px-3 py-2">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                        <span className="text-zinc-200">
                          {summary || "Verdict"}
                          <span className="ml-2 text-xs text-zinc-500">
                            ({v.candidates.map((c) => c.name).join(" vs ")})
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-xs">
                          {tally.total > 0 && leader ? (
                            <>
                              <span
                                className={
                                  isThisPlayerLeading
                                    ? "text-emerald-300"
                                    : "text-zinc-300"
                                }
                              >
                                {leader.name} {leaderPct}%
                              </span>
                              <span className="text-zinc-500">
                                {" · "}
                                {tally.total} vote
                                {tally.total === 1 ? "" : "s"}
                              </span>
                            </>
                          ) : (
                            <span className="text-zinc-500">No votes yet</span>
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {v.context.scoring ?? "—"} ·{" "}
                        {relativeTimeShort(v.created_at)}
                      </div>
                    </Link>
                  </li>
                );
              })}
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
