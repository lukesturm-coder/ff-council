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
type SortKey =
  | "VEGAS"
  | "COUNCIL"
  | "ESPN"
  | "FP"
  | "SLEEPER"
  | "NFL"
  | "CBS"
  | "YAHOO"
  | "AVG";

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

/**
 * Platforms displayed as a single rank column (Sleeper / NFL / CBS / Yahoo).
 * ESPN and FantasyPros are rendered explicitly above because ESPN has two
 * sub-columns (editorial + ADP) and FP has the "consensus" framing.
 */
const EXTRA_PLATFORMS: Array<{
  key: string;
  type: "editorial" | "adp";
  label: string;
  accent: string;
}> = [
  // Brand-accurate colors (closest Tailwind shades to each platform's logo).
  // All blues are distinct shades so columns don't visually merge.
  { key: "sleeper", type: "adp", label: "Sleeper", accent: "text-cyan-400" },
  { key: "nfl", type: "editorial", label: "NFL", accent: "text-blue-400" },
  { key: "cbs", type: "editorial", label: "CBS", accent: "text-indigo-400" },
  { key: "yahoo", type: "editorial", label: "Yahoo", accent: "text-purple-400" },
];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // AVG (the consensus across every source) is the default sort — it's the
  // integrated verdict that this multi-source comparison page is for. Single
  // sources stay clickable for users who want to see one perspective.
  const initialSortKey: SortKey = "AVG";
  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey);

  function toggleSort(key: SortKey) {
    // Click an inactive column → sort by it. Click the active column → reset
    // back to the default sort.
    setSortKey(key === sortKey ? initialSortKey : key);
  }

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

  const view = useMemo(() => {
    const filtered =
      position === "ALL"
        ? projections
        : projections.filter((p) => p.position === position);

    // Vegas rank: position when sorted by VBD desc (Vegas-derived baseline).
    const vegasRankById = new Map<number, number>();
    [...filtered]
      .sort((a, b) => b.vbd[scoring] - a.vbd[scoring])
      .forEach((p, idx) => vegasRankById.set(p.playerId, idx + 1));

    // Build a row record per player with all rank columns precomputed.
    type RowData = {
      player: PlayerProjection;
      vegasRank: number | null;
      councilAvgRank: number | null;
      councilRankerCount: number;
      espnRank: number | null;
      fpRank: number | null;
      extraRanks: Array<number | null>;
      avgRank: number | null;
    };
    const rows: RowData[] = filtered.map((p) => {
      const councilEntry = hasCouncil
        ? councilConsensus[p.playerId]?.[scoring]
        : undefined;
      const espnRank = hasEspn
        ? lookupPlatformRank(
            platformRankings,
            p.playerId,
            "espn",
            "editorial",
            scoring,
          )
        : null;
      const fpRank = hasFp
        ? lookupPlatformRank(
            platformRankings,
            p.playerId,
            "fantasypros",
            "adp",
            scoring,
          )
        : null;
      const extraRanks = EXTRA_PLATFORMS.map((pf) =>
        lookupPlatformRank(
          platformRankings,
          p.playerId,
          pf.key,
          pf.type,
          scoring,
        ),
      );
      const ranksForAvg = [
        councilEntry?.avgRank ?? null,
        espnRank,
        fpRank,
        ...extraRanks,
      ].filter((r): r is number => r != null);
      const avgRank =
        ranksForAvg.length > 0
          ? ranksForAvg.reduce((s, n) => s + n, 0) / ranksForAvg.length
          : null;
      return {
        player: p,
        vegasRank: vegasRankById.get(p.playerId) ?? null,
        councilAvgRank: councilEntry?.avgRank ?? null,
        councilRankerCount: councilEntry?.rankerCount ?? 0,
        espnRank,
        fpRank,
        extraRanks,
        avgRank,
      };
    });

    const valueOf = (row: RowData): number => {
      let v: number | null;
      if (sortKey === "VEGAS") v = row.vegasRank;
      else if (sortKey === "COUNCIL") v = row.councilAvgRank;
      else if (sortKey === "ESPN") v = row.espnRank;
      else if (sortKey === "FP") v = row.fpRank;
      else if (sortKey === "AVG") v = row.avgRank;
      else {
        const idx = EXTRA_PLATFORMS.findIndex(
          (pf) => pf.key.toUpperCase() === sortKey,
        );
        v = idx >= 0 ? row.extraRanks[idx] : null;
      }
      return v == null ? Number.POSITIVE_INFINITY : v;
    };

    const sorted = [...rows].sort((a, b) => valueOf(a) - valueOf(b));

    return { sorted };
  }, [
    projections,
    scoring,
    position,
    sortKey,
    platformRankings,
    councilConsensus,
    hasEspn,
    hasFp,
    hasCouncil,
  ]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
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
              <th className="w-8 py-3 pl-3"></th>
              <th className="w-10 py-3 pr-2 text-right">#</th>
              <th className="sticky left-0 z-20 min-w-[140px] bg-zinc-900 py-3 pl-2 whitespace-nowrap sm:min-w-[200px] sm:pl-4">Player</th>
              <th className="w-12 py-3 text-center">Pos</th>
              <SortHeader
                label="AVG"
                sortKey="AVG"
                color="text-zinc-100"
                title="Average rank across every available source — the consensus across Council, Vegas, ESPN, FP, Sleeper, NFL, CBS, Yahoo. Default sort."
                active={sortKey}
                onClick={toggleSort}
              />
              {hasCouncil && (
                <SortHeader
                  label="Council"
                  sortKey="COUNCIL"
                  color="text-emerald-400"
                  title="Council Consensus — average rank across approved council members' current submissions"
                  active={sortKey}
                  onClick={toggleSort}
                />
              )}
              <SortHeader
                label="Vegas"
                sortKey="VEGAS"
                color="text-amber-400"
                title="FF Council Vegas-derived rank"
                active={sortKey}
                onClick={toggleSort}
              />
              {hasEspn && (
                <SortHeader
                  label="ESPN"
                  sortKey="ESPN"
                  color="text-red-400"
                  title="ESPN editorial preseason rank"
                  active={sortKey}
                  onClick={toggleSort}
                />
              )}
              {hasFp && (
                <SortHeader
                  label="FP"
                  sortKey="FP"
                  color="text-teal-400"
                  title="FantasyPros consensus ADP — aggregated across multiple platforms"
                  active={sortKey}
                  onClick={toggleSort}
                />
              )}
              {EXTRA_PLATFORMS.map((pf) => (
                <SortHeader
                  key={pf.key}
                  label={pf.label}
                  sortKey={pf.key.toUpperCase() as SortKey}
                  color={pf.accent}
                  title={`${pf.label} ${pf.type === "adp" ? "ADP" : "editorial rank"} (mock data until 2026 preseason rankings publish)`}
                  active={sortKey}
                  onClick={toggleSort}
                />
              ))}
              <th className="w-3 sm:w-4" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {view.sorted.map((row, idx) => {
              const isExpanded = expandedId === row.player.playerId;
              return (
                <RankRow
                  key={row.player.playerId}
                  player={row.player}
                  rank={idx + 1}
                  scoring={scoring}
                  isExpanded={isExpanded}
                  onToggle={() =>
                    setExpandedId(isExpanded ? null : row.player.playerId)
                  }
                  hasEspn={hasEspn}
                  espnRank={row.espnRank}
                  hasFp={hasFp}
                  fpRank={row.fpRank}
                  hasCouncil={hasCouncil}
                  councilAvgRank={row.councilAvgRank}
                  councilRankerCount={row.councilRankerCount}
                  extraRanks={row.extraRanks}
                  avgRank={row.avgRank}
                  vegasRank={row.vegasRank}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        <span className="text-zinc-300">#</span> is the player&apos;s rank in
        the current sort — average across all sources by default. Other columns show
        each source&apos;s rank for comparison; sort by any column to find
        disagreements. Sleeper / NFL / CBS / Yahoo are mock numbers until
        those platforms publish 2026 preseason rankings.
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

function SortHeader({
  label,
  sortKey: key,
  color,
  title,
  active,
  onClick,
  extraClass,
}: {
  label: string;
  sortKey: SortKey;
  color: string;
  title: string;
  active: SortKey;
  onClick: (k: SortKey) => void;
  extraClass?: string;
}) {
  const isActive = active === key;
  return (
    <th
      className={`w-20 min-w-[5rem] py-3 text-center select-none cursor-pointer ${extraClass ?? ""} ${
        isActive ? "bg-zinc-800/30" : "hover:bg-zinc-800/20"
      }`}
      title={isActive ? `${title} — click again to reset` : title}
      onClick={() => onClick(key)}
    >
      <span className={color}>{label}</span>
      {isActive && (
        <span className="ml-1 text-[10px] text-zinc-400">▲</span>
      )}
    </th>
  );
}

function RankRow({
  player,
  rank,
  scoring,
  isExpanded,
  onToggle,
  hasEspn,
  espnRank,
  hasFp,
  fpRank,
  hasCouncil,
  councilAvgRank,
  councilRankerCount,
  extraRanks,
  avgRank,
  vegasRank,
}: {
  player: PlayerProjection;
  rank: number;
  scoring: ScoringSystem;
  isExpanded: boolean;
  onToggle: () => void;
  hasEspn: boolean;
  espnRank: number | null;
  hasFp: boolean;
  fpRank: number | null;
  hasCouncil: boolean;
  councilAvgRank: number | null;
  councilRankerCount: number;
  extraRanks: Array<number | null>;
  avgRank: number | null;
  vegasRank: number | null;
}) {
  const fpts = player.fantasyPoints[scoring];
  const vbd = player.vbd[scoring];

  return (
    <>
      <tr
        onClick={onToggle}
        className="group cursor-pointer border-t border-zinc-800/60 transition hover:bg-zinc-800/40"
      >
        <td className="pl-3 align-middle">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-600" />
          )}
        </td>
        <td className="py-3 pr-2 text-right font-mono text-zinc-500">{rank}</td>
        <td className="sticky left-0 z-10 bg-zinc-900 py-3 pl-2 font-medium whitespace-nowrap group-hover:bg-zinc-800 sm:pl-4">
          <Link
            href={`/player/${player.playerId}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-emerald-300 hover:underline underline-offset-4"
          >
            {player.name}
          </Link>
          <span className="ml-2 font-mono text-xs text-zinc-500">
            ({player.team})
          </span>
        </td>
        <td className="py-3 text-center">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
          >
            {player.position}
          </span>
        </td>
        {/* AVG is the leftmost data column — the consensus across every
            source, sorted by default. Single-source columns follow. */}
        <td className="min-w-[5rem] py-3 text-center font-mono text-xs font-semibold tabular-nums">
          {avgRank != null ? (
            <span className="text-zinc-100">{avgRank.toFixed(1)}</span>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </td>
        {hasCouncil && (
          <td
            className="min-w-[5rem] py-3 text-center font-mono text-xs tabular-nums"
            title={
              councilRankerCount
                ? `${councilRankerCount} ranker${councilRankerCount === 1 ? "" : "s"}`
                : "No council ranking"
            }
          >
            <span className="text-emerald-400">
              {councilAvgRank != null
                ? Number.isInteger(councilAvgRank)
                  ? councilAvgRank.toFixed(0)
                  : councilAvgRank.toFixed(1)
                : "—"}
            </span>
          </td>
        )}
        <td className="min-w-[5rem] py-3 text-center font-mono text-xs tabular-nums">
          <span className="text-amber-400">
            {vegasRank != null ? vegasRank.toFixed(0) : "—"}
          </span>
        </td>
        {hasEspn && (
          <td className="min-w-[5rem] py-3 text-center font-mono text-xs tabular-nums">
            <span className="text-red-400">
              {espnRank != null ? espnRank.toFixed(0) : "—"}
            </span>
          </td>
        )}
        {hasFp && (
          <td className="min-w-[5rem] py-3 text-center font-mono text-xs tabular-nums">
            <span className="text-teal-400">
              {fpRank != null ? fpRank.toFixed(0) : "—"}
            </span>
          </td>
        )}
        {extraRanks.map((r, idx) => (
          <td
            key={EXTRA_PLATFORMS[idx].key}
            className="min-w-[5rem] py-3 text-center font-mono text-xs tabular-nums"
          >
            <span className={EXTRA_PLATFORMS[idx].accent}>
              {r != null ? r.toFixed(0) : "—"}
            </span>
          </td>
        ))}
        <td aria-hidden="true" />
      </tr>
      {isExpanded && (
        <tr className="border-t border-zinc-800/60 bg-zinc-950/50">
          <td
            colSpan={
              7 +
              (hasEspn ? 1 : 0) +
              (hasCouncil ? 1 : 0) +
              (hasFp ? 1 : 0) +
              EXTRA_PLATFORMS.length
            }
            className="px-3 py-4 sm:px-12"
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
              · Edge:{" "}
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
