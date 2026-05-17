"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";

type PositionFilter = "ALL" | FantasyPosition;
type Tier = "S" | "A" | "B" | "C" | "D";
type SortMode =
  | "VBD"
  | "FPts"
  | "ADP"
  | "ESPN"
  | "ESPN_ADP"
  | "FP_ADP"
  | "COUNCIL";

/**
 * Nested map of external platform rankings:
 *   playerId → source → rankingType (editorial/adp) → scoringSystem → rank
 * Built server-side from platform_rankings table and passed in as a prop.
 */
export type PlatformRankingsMap = Record<
  number, // player_id
  Partial<
    Record<
      string, // source
      Partial<
        Record<
          "editorial" | "adp",
          Partial<Record<ScoringSystem, number>>
        >
      >
    >
  >
>;

/**
 * Council consensus, keyed by player_id → scoring_system → { avgRank, rankerCount }.
 * Sourced from the council_consensus view (avg of approved members' current
 * rankings per scoring system).
 */
export type CouncilConsensusMap = Record<
  number,
  Partial<Record<ScoringSystem, { avgRank: number; rankerCount: number }>>
>;

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const POSITION_OPTIONS: PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE"];

function tierOf(rank: number, total: number): Tier {
  const pct = rank / total;
  if (pct <= 0.1) return "S";
  if (pct <= 0.3) return "A";
  if (pct <= 0.55) return "B";
  if (pct <= 0.85) return "C";
  return "D";
}

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

const TIER_STYLES: Record<Tier, string> = {
  S: "bg-amber-400/20 text-amber-200 ring-amber-400/40",
  A: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30",
  B: "bg-sky-400/10 text-sky-200 ring-sky-400/25",
  C: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  D: "bg-zinc-700/30 text-zinc-500 ring-zinc-700/40",
};

function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function lookupPlatformRank(
  pr: PlatformRankingsMap,
  playerId: number,
  source: string,
  rankingType: "editorial" | "adp",
  scoring: ScoringSystem,
): number | null {
  // Sources publish PPR consistently; Half and Standard often fall back to PPR.
  const tryScoring: ScoringSystem[] =
    scoring === "PPR" ? ["PPR"] : [scoring, "PPR"];
  for (const s of tryScoring) {
    const v = pr[playerId]?.[source]?.[rankingType]?.[s];
    if (v != null) return v;
  }
  return null;
}

export default function RankingsTable({
  projections,
  platformRankings,
  councilConsensus,
}: {
  projections: PlayerProjection[];
  platformRankings: PlatformRankingsMap;
  councilConsensus: CouncilConsensusMap;
}) {
  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("VBD");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const hasEspn = useMemo(
    () =>
      Object.values(platformRankings).some(
        (p) => p.espn?.editorial || p.espn?.adp,
      ),
    [platformRankings],
  );

  const hasFp = useMemo(
    () => Object.values(platformRankings).some((p) => p.fantasypros?.adp),
    [platformRankings],
  );

  const hasCouncil = useMemo(
    () => Object.keys(councilConsensus).length > 0,
    [councilConsensus],
  );

  const SORT_OPTIONS: SortMode[] = useMemo(() => {
    const opts: SortMode[] = ["VBD", "FPts", "ADP"];
    if (hasCouncil) opts.push("COUNCIL");
    if (hasEspn) opts.push("ESPN", "ESPN_ADP");
    if (hasFp) opts.push("FP_ADP");
    return opts;
  }, [hasEspn, hasFp, hasCouncil]);

  const view = useMemo(() => {
    const adpField: "adp" | "adpPPR" =
      scoring === "Standard" ? "adp" : "adpPPR";

    const filtered =
      position === "ALL"
        ? projections
        : projections.filter((p) => p.position === position);

    const sortKey = (p: PlayerProjection): number => {
      if (sortMode === "VBD") return -p.vbd[scoring];
      if (sortMode === "FPts") return -p.fantasyPoints[scoring];
      if (sortMode === "ESPN") {
        const v = lookupPlatformRank(platformRankings, p.playerId, "espn", "editorial", scoring);
        return v == null ? Number.POSITIVE_INFINITY : v;
      }
      if (sortMode === "ESPN_ADP") {
        const v = lookupPlatformRank(platformRankings, p.playerId, "espn", "adp", scoring);
        return v == null ? Number.POSITIVE_INFINITY : v;
      }
      if (sortMode === "FP_ADP") {
        const v = lookupPlatformRank(platformRankings, p.playerId, "fantasypros", "adp", scoring);
        return v == null ? Number.POSITIVE_INFINITY : v;
      }
      if (sortMode === "COUNCIL") {
        const v = councilConsensus[p.playerId]?.[scoring]?.avgRank;
        return v == null ? Number.POSITIVE_INFINITY : v;
      }
      // ADP — missing ADP sinks to the bottom
      const a = p[adpField];
      return a == null ? Number.POSITIVE_INFINITY : a;
    };

    const sorted = [...filtered].sort((a, b) => sortKey(a) - sortKey(b));

    // Roster ADP rank within visible set — used for Edge column
    const adpEntries = sorted
      .map((p) => ({ id: p.playerId, adp: p[adpField] }))
      .filter((e): e is { id: number; adp: number } => e.adp != null)
      .sort((a, b) => a.adp - b.adp);
    const adpRankById = new Map<number, number>();
    adpEntries.forEach((e, idx) => adpRankById.set(e.id, idx + 1));

    return { sorted, adpRankById, adpField };
  }, [projections, scoring, position, sortMode, platformRankings, councilConsensus]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <ControlGroup
          label="Sort"
          options={SORT_OPTIONS}
          value={sortMode}
          onChange={setSortMode}
          labels={{
            VBD: "VBD",
            FPts: "FPts",
            ADP: "ADP",
            COUNCIL: "Council",
            ESPN: "ESPN Rank",
            ESPN_ADP: "ESPN ADP",
            FP_ADP: "FP ADP",
          }}
        />
        <ControlGroup
          label="Scoring"
          options={SCORING_OPTIONS}
          value={scoring}
          onChange={setScoring}
        />
        <ControlGroup
          label="Pos"
          options={POSITION_OPTIONS}
          value={position}
          onChange={setPosition}
        />
        <div className="ml-auto text-xs text-zinc-500">
          {view.sorted.length} player{view.sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="w-10 py-3 pl-4"></th>
              <th className="w-12 py-3 text-right">#</th>
              <th className="py-3 pl-4">Player</th>
              <th className="py-3 pl-2">Pos</th>
              <th className="py-3 pl-2">Team</th>
              <th className="py-3 pr-4 text-right" title="Roster ADP">
                ADP
              </th>
              <th
                className="py-3 pr-4 text-right"
                title="Value-Based Drafting: FPts above the replacement-level player at this position"
              >
                VBD
              </th>
              <th className="py-3 pr-4 text-right text-zinc-600">FPts</th>
              {hasCouncil && (
                <th
                  className="py-3 pr-4 text-right"
                  title="Council Consensus — average rank across approved council members' current submissions"
                >
                  <span className="text-emerald-300">Council</span>
                </th>
              )}
              {hasEspn && (
                <>
                  <th
                    className="py-3 pr-4 text-right"
                    title="ESPN editorial preseason rank"
                  >
                    <span className="text-rose-300">ESPN</span> Rank
                  </th>
                  <th
                    className="py-3 pr-4 text-right"
                    title="ESPN crowd ADP (real draft average)"
                  >
                    <span className="text-rose-300">ESPN</span> ADP
                  </th>
                </>
              )}
              {hasFp && (
                <th
                  className="py-3 pr-4 text-right"
                  title="FantasyPros consensus ADP — aggregated across ESPN, Yahoo, Sleeper, NFL, RTSports drafts"
                >
                  <span className="text-sky-300">FP</span> ADP
                </th>
              )}
              <th className="py-3 pr-4 text-center">Tier</th>
              <th className="py-3 pr-4 text-right">Edge</th>
            </tr>
          </thead>
          <tbody>
            {view.sorted.map((p, idx) => {
              const rank = idx + 1;
              const tier = tierOf(rank, view.sorted.length);
              const adpValue = p[view.adpField];
              const adpRank = view.adpRankById.get(p.playerId);
              const edge = adpRank != null ? adpRank - rank : null;
              const isExpanded = expandedId === p.playerId;
              const espnRank = hasEspn
                ? lookupPlatformRank(
                    platformRankings,
                    p.playerId,
                    "espn",
                    "editorial",
                    scoring,
                  )
                : null;
              const espnAdp = hasEspn
                ? lookupPlatformRank(
                    platformRankings,
                    p.playerId,
                    "espn",
                    "adp",
                    scoring,
                  )
                : null;
              const councilEntry = hasCouncil
                ? councilConsensus[p.playerId]?.[scoring]
                : undefined;
              const fpAdp = hasFp
                ? lookupPlatformRank(
                    platformRankings,
                    p.playerId,
                    "fantasypros",
                    "adp",
                    scoring,
                  )
                : null;

              return (
                <RankRow
                  key={p.playerId}
                  player={p}
                  rank={rank}
                  tier={tier}
                  scoring={scoring}
                  adpValue={adpValue}
                  edge={edge}
                  isExpanded={isExpanded}
                  onToggle={() =>
                    setExpandedId(isExpanded ? null : p.playerId)
                  }
                  hasEspn={hasEspn}
                  espnRank={espnRank}
                  espnAdp={espnAdp}
                  hasFp={hasFp}
                  fpAdp={fpAdp}
                  hasCouncil={hasCouncil}
                  councilAvgRank={councilEntry?.avgRank ?? null}
                  councilRankerCount={councilEntry?.rankerCount ?? 0}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        <span className="text-zinc-300">VBD</span> = FPts above the
        replacement-level player at the same position (QB12, RB24, WR30, TE12
        in a 12-team league).{" "}
        {hasEspn && (
          <>
            <span className="text-rose-300">ESPN</span> columns are{" "}
            <span className="text-zinc-300">editorial rank</span> (their
            staff&apos;s board) and{" "}
            <span className="text-zinc-300">ADP</span> (where users actually
            draft).
          </>
        )}{" "}
        Sort by any column to find disagreements.
      </p>
    </div>
  );
}

function ControlGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition ${
            value === opt
              ? "bg-emerald-500/20 text-emerald-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}

function rankColor(value: number | null): string {
  if (value == null) return "text-zinc-700";
  if (value <= 12) return "text-emerald-300";
  if (value <= 36) return "text-zinc-200";
  if (value <= 96) return "text-zinc-400";
  return "text-zinc-600";
}

function RankRow({
  player,
  rank,
  tier,
  scoring,
  adpValue,
  edge,
  isExpanded,
  onToggle,
  hasEspn,
  espnRank,
  espnAdp,
  hasFp,
  fpAdp,
  hasCouncil,
  councilAvgRank,
  councilRankerCount,
}: {
  player: PlayerProjection;
  rank: number;
  tier: Tier;
  scoring: ScoringSystem;
  adpValue: number | undefined;
  edge: number | null;
  isExpanded: boolean;
  onToggle: () => void;
  hasEspn: boolean;
  espnRank: number | null;
  espnAdp: number | null;
  hasFp: boolean;
  fpAdp: number | null;
  hasCouncil: boolean;
  councilAvgRank: number | null;
  councilRankerCount: number;
}) {
  const fpts = player.fantasyPoints[scoring];
  const vbd = player.vbd[scoring];

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-t border-zinc-800/60 transition hover:bg-zinc-800/40"
      >
        <td className="pl-4 align-middle">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-600" />
          )}
        </td>
        <td className="py-3 text-right font-mono text-zinc-500">{rank}</td>
        <td className="py-3 pl-4 font-medium">
          <Link
            href={`/player/${player.playerId}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-emerald-300 hover:underline underline-offset-4"
          >
            {player.name}
          </Link>
        </td>
        <td className="py-3 pl-2">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
          >
            {player.position}
          </span>
        </td>
        <td className="py-3 pl-2 font-mono text-xs text-zinc-400">
          {player.team}
        </td>
        <td className="py-3 pr-4 text-right font-mono text-xs text-zinc-400">
          {adpValue != null ? adpValue.toFixed(1) : "—"}
        </td>
        <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums">
          <span
            className={
              vbd > 50
                ? "text-emerald-300"
                : vbd > 0
                  ? "text-zinc-100"
                  : "text-zinc-500"
            }
          >
            {vbd > 0 ? "+" : ""}
            {vbd.toFixed(1)}
          </span>
        </td>
        <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-500">
          {fpts.toFixed(1)}
        </td>
        {hasCouncil && (
          <td
            className="py-3 pr-4 text-right font-mono text-xs tabular-nums"
            title={
              councilRankerCount
                ? `${councilRankerCount} ranker${councilRankerCount === 1 ? "" : "s"}`
                : "No council ranking"
            }
          >
            <span className={rankColor(councilAvgRank)}>
              {councilAvgRank != null ? councilAvgRank.toFixed(1) : "—"}
            </span>
          </td>
        )}
        {hasEspn && (
          <>
            <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
              <span className={rankColor(espnRank)}>
                {espnRank != null ? espnRank.toFixed(0) : "—"}
              </span>
            </td>
            <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
              <span className={rankColor(espnAdp)}>
                {espnAdp != null ? espnAdp.toFixed(1) : "—"}
              </span>
            </td>
          </>
        )}
        {hasFp && (
          <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
            <span className={rankColor(fpAdp)}>
              {fpAdp != null ? fpAdp.toFixed(1) : "—"}
            </span>
          </td>
        )}
        <td className="py-3 pr-4 text-center">
          <span
            className={`inline-flex w-6 justify-center rounded px-1 py-0.5 text-xs font-bold ring-1 ring-inset ${TIER_STYLES[tier]}`}
          >
            {tier}
          </span>
        </td>
        <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
          {edge == null ? (
            <span className="text-zinc-500">—</span>
          ) : edge > 0 ? (
            <span className="text-emerald-400">+{edge}</span>
          ) : edge < 0 ? (
            <span className="text-rose-400">{edge}</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-t border-zinc-800/60 bg-zinc-950/50">
          <td
            colSpan={
              10 + (hasEspn ? 2 : 0) + (hasFp ? 1 : 0) + (hasCouncil ? 1 : 0)
            }
            className="px-12 py-4"
          >
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="text-xs uppercase tracking-wider text-zinc-500">
                Markets feeding this projection
              </div>
              <div className="text-right text-xs uppercase tracking-wider text-zinc-500">
                Per-week implied
              </div>
              {player.markets.map((m) => (
                <div key={m.betType} className="contents text-zinc-300">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-zinc-200">
                      {m.betType}
                    </span>
                    <span className="font-mono text-zinc-400">
                      O/U {m.line}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      ({formatAmerican(m.overPayout)} /{" "}
                      {formatAmerican(m.underPayout)})
                    </span>
                  </div>
                  <div className="text-right font-mono tabular-nums text-zinc-400">
                    {(m.line / 17).toFixed(1)}
                    <span className="ml-1 text-xs text-zinc-600">/wk</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
              <span className="text-zinc-300">{scoring}</span> · Season FPts:{" "}
              <span className="font-mono text-zinc-200">{fpts.toFixed(1)}</span>{" "}
              · Per game:{" "}
              <span className="font-mono text-zinc-300">
                {(fpts / 17).toFixed(1)}
              </span>{" "}
              · VBD:{" "}
              <span
                className={
                  vbd > 0
                    ? "font-mono font-semibold text-emerald-300"
                    : "font-mono text-zinc-500"
                }
              >
                {vbd > 0 ? "+" : ""}
                {vbd.toFixed(1)}
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
