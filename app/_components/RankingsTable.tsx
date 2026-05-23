"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { computeTiersForPosition } from "@/lib/tiers";

type PositionFilter = "ALL" | FantasyPosition;
type SortKey =
  | "MINE"
  | "VEGAS"
  | "COUNCIL"
  | "ESPN"
  | "SLEEPER"
  | "NFL"
  | "YAHOO"
  | "AVG";

/**
 * One source's published value for a given (player, ranking type, scoring) tuple.
 * `rank` is always present (we only store rows when we have a rank). `points`
 * is the source's season FPTS projection — null when the source doesn't
 * publish points (Yahoo public pre-rank), or when we haven't joined a
 * projection for that player (e.g. ADP rows on ESPN — ADP isn't a forecast).
 */
export type PlatformRankingEntry = {
  rank: number;
  points: number | null;
};

/**
 * Nested map of external platform rankings:
 *   playerId → source → rankingType (editorial/adp) → scoringSystem → { rank, points }
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
          Partial<Record<ScoringSystem, PlatformRankingEntry>>
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

/**
 * The signed-in member's own ranking: scoring_system → player_id → rank (their
 * position in their personal ranking). Empty when logged out or no ranking yet.
 */
export type MyRanksMap = Partial<
  Record<ScoringSystem, Record<number, number>>
>;

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const POSITION_OPTIONS: PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE"];
const VIEW_OPTIONS = ["Ranks", "Points"] as const;
type ViewMode = (typeof VIEW_OPTIONS)[number];

/**
 * External platforms displayed as single rank columns, in display order
 * (Sleeper / Yahoo / NFL). ESPN is rendered as its own column AFTER these
 * (last/most de-emphasized), so it's not in this list.
 */
const EXTRA_PLATFORMS: Array<{
  key: string;
  type: "editorial" | "adp";
  label: string;
  accent: string;
}> = [
  // External sources, de-emphasized vs the house columns (Council / Mine /
  // Market). Brand-accurate but muted (/80) so the hierarchy reads. Order
  // matches the column spec: Sleeper, Yahoo, NFL (ESPN renders last, separately).
  { key: "sleeper", type: "adp", label: "Sleeper", accent: "text-cyan-400/80" },
  { key: "yahoo", type: "editorial", label: "Yahoo", accent: "text-purple-400/80" },
  { key: "nfl", type: "editorial", label: "NFL", accent: "text-blue-400/80" },
];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

// Sources that publish projected points and therefore support point-tiers.
type TierSource = "avg" | "vegas" | "espn" | "sleeper" | "nfl";

// Full-width tier-divider border color per source — each matches that column's
// brand accent so the line is attributable to the column you're sorting by.
const TIER_LINE_COLOR: Record<TierSource, string> = {
  avg: "border-zinc-300/70",
  vegas: "border-amber-400/70",
  espn: "border-red-400/70",
  sleeper: "border-cyan-400/70",
  nfl: "border-blue-400/70",
};

function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

// "Jared Goff" → "J. Goff". Used in the sticky Player column once the table
// is scrolled sideways on mobile, to free horizontal room for data columns.
function condenseName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function lookupPlatformEntry(
  pr: PlatformRankingsMap,
  playerId: number,
  source: string,
  rankingType: "editorial" | "adp",
  scoring: ScoringSystem,
): PlatformRankingEntry | null {
  // Sources publish PPR consistently; Half and Standard often fall back to PPR.
  const tryScoring: ScoringSystem[] =
    scoring === "PPR" ? ["PPR"] : [scoring, "PPR"];
  for (const s of tryScoring) {
    const v = pr[playerId]?.[source]?.[rankingType]?.[s];
    if (v != null) return v;
  }
  return null;
}

function lookupPlatformRank(
  pr: PlatformRankingsMap,
  playerId: number,
  source: string,
  rankingType: "editorial" | "adp",
  scoring: ScoringSystem,
): number | null {
  return lookupPlatformEntry(pr, playerId, source, rankingType, scoring)?.rank ?? null;
}

function lookupPlatformPoints(
  pr: PlatformRankingsMap,
  playerId: number,
  source: string,
  rankingType: "editorial" | "adp",
  scoring: ScoringSystem,
): number | null {
  // For points we don't fall back across scoring systems — PPR points differ
  // from Half/Standard meaningfully, unlike rank which is often shared.
  return pr[playerId]?.[source]?.[rankingType]?.[scoring]?.points ?? null;
}

export default function RankingsTable({
  projections,
  platformRankings,
  councilConsensus,
  myRanks = {},
}: {
  projections: PlayerProjection[];
  platformRankings: PlatformRankingsMap;
  councilConsensus: CouncilConsensusMap;
  myRanks?: MyRanksMap;
}) {
  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [view, setView] = useState<ViewMode>("Ranks");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // When the table is scrolled sideways (mobile), condense the sticky Player
  // column to "J. Goff" so the data columns get room. At rest, full names.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setCondensed(el.scrollLeft > 8);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // AVG (the consensus across every source) is the default sort — it's the
  // integrated verdict that this multi-source comparison page is for. Single
  // sources stay clickable for users who want to see one perspective.
  // Council is the primary FF Council market authority, so it's the default
  // sort when present. Falls back to the Market (overall consensus) column
  // before any council votes exist.
  const initialSortKey: SortKey =
    Object.keys(councilConsensus).length > 0 ? "COUNCIL" : "AVG";
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

  const hasCouncil = useMemo(
    () => Object.keys(councilConsensus).length > 0,
    [councilConsensus],
  );

  const hasMine = useMemo(
    () =>
      Object.values(myRanks).some((m) => m && Object.keys(m).length > 0),
    [myRanks],
  );

  const tableData = useMemo(() => {
    const filtered =
      position === "ALL"
        ? projections
        : projections.filter((p) => p.position === position);

    // Vegas rank: position when sorted by VBD desc (Vegas-derived baseline).
    // Vegas points: the Vegas-derived season FPts projection itself.
    const vegasRankById = new Map<number, number>();
    [...filtered]
      .sort((a, b) => b.vbd[scoring] - a.vbd[scoring])
      .forEach((p, idx) => vegasRankById.set(p.playerId, idx + 1));

    // Each row carries BOTH the rank-mode and points-mode values for every
    // source. The rendering layer picks which to display based on `view`,
    // and sorting also dispatches on `view`. Computing both up-front keeps
    // toggling cheap and avoids divergent re-rank logic.
    type RowData = {
      player: PlayerProjection;
      vegasRank: number | null;
      vegasPoints: number | null;
      councilAvgRank: number | null;
      councilRankerCount: number;
      // Council and "Mine" are pure ranks — no projection.
      mineRank: number | null;
      espnRank: number | null;
      espnPoints: number | null;
      extraRanks: Array<number | null>;
      extraPoints: Array<number | null>;
      avgRank: number | null;
      avgPoints: number | null;
    };
    // Look up each player's raw stored rank per source (no re-ranking yet).
    type StoredRanks = {
      council: number | null;
      councilRankerCount: number;
      mine: number | null;
      espn: number | null;
      espnPts: number | null;
      extras: Array<number | null>;
      extraPts: Array<number | null>;
    };
    const storedByPid = new Map<number, StoredRanks>();
    for (const p of filtered) {
      const councilEntry = hasCouncil
        ? councilConsensus[p.playerId]?.[scoring]
        : undefined;
      storedByPid.set(p.playerId, {
        council: councilEntry?.avgRank ?? null,
        councilRankerCount: councilEntry?.rankerCount ?? 0,
        mine: hasMine ? myRanks[scoring]?.[p.playerId] ?? null : null,
        espn: hasEspn
          ? lookupPlatformRank(platformRankings, p.playerId, "espn", "editorial", scoring)
          : null,
        espnPts: hasEspn
          ? lookupPlatformPoints(platformRankings, p.playerId, "espn", "editorial", scoring)
          : null,
        extras: EXTRA_PLATFORMS.map((pf) =>
          lookupPlatformRank(platformRankings, p.playerId, pf.key, pf.type, scoring),
        ),
        extraPts: EXTRA_PLATFORMS.map((pf) =>
          lookupPlatformPoints(platformRankings, p.playerId, pf.key, pf.type, scoring),
        ),
      });
    }

    // When a position filter is active, re-rank every source within the
    // filtered set so each column shows positional rank (WR1, WR2, ...) the
    // way Vegas already does. When showing ALL positions, keep the stored
    // overall ranks. Points columns don't re-rank — they're absolute values,
    // not positions; we just filter the dataset and show each source's
    // published projected_points.
    const withinFilter = position !== "ALL";
    const rerank = (
      getter: (s: StoredRanks) => number | null,
    ): Map<number, number> => {
      const m = new Map<number, number>();
      const entries = filtered
        .map((p) => ({ pid: p.playerId, r: getter(storedByPid.get(p.playerId)!) }))
        .filter((x): x is { pid: number; r: number } => x.r != null);
      entries.sort((a, b) => a.r - b.r);
      entries.forEach((x, idx) => m.set(x.pid, idx + 1));
      return m;
    };
    const councilRerank = withinFilter ? rerank((s) => s.council) : null;
    const mineRerank = withinFilter ? rerank((s) => s.mine) : null;
    const espnRerank = withinFilter ? rerank((s) => s.espn) : null;
    const extraReranks = withinFilter
      ? EXTRA_PLATFORMS.map((_, idx) => rerank((s) => s.extras[idx]))
      : null;

    const rows: RowData[] = filtered.map((p) => {
      const stored = storedByPid.get(p.playerId)!;
      const displayCouncil = withinFilter
        ? councilRerank!.get(p.playerId) ?? null
        : stored.council;
      const displayMine = withinFilter
        ? mineRerank!.get(p.playerId) ?? null
        : stored.mine;
      const displayEspn = withinFilter
        ? espnRerank!.get(p.playerId) ?? null
        : stored.espn;
      const displayExtras = withinFilter
        ? stored.extras.map((_, idx) => extraReranks![idx].get(p.playerId) ?? null)
        : stored.extras;
      // Vegas counts in the consensus like every other source (and it's always
      // present). When a position is selected, vegasRankById already holds the
      // within-position rank, so it stays on the same scale as the reranked
      // sources. Dashes (null) are filtered out and never count as zero.
      const ranksForAvg = [
        vegasRankById.get(p.playerId) ?? null,
        displayCouncil,
        displayEspn,
        ...displayExtras,
      ].filter((r): r is number => r != null);
      const avgRank =
        ranksForAvg.length > 0
          ? ranksForAvg.reduce((s, n) => s + n, 0) / ranksForAvg.length
          : null;
      const vegasPoints = p.fantasyPoints[scoring];
      // Points AVG includes Vegas (which always has a projection) plus any
      // source that publishes points. Council has no projection so it
      // doesn't enter the average — keeps Council a pure rank citizen.
      const pointsForAvg = [
        vegasPoints,
        stored.espnPts,
        ...stored.extraPts,
      ].filter((v): v is number => v != null && v > 0);
      const avgPoints =
        pointsForAvg.length > 0
          ? pointsForAvg.reduce((s, n) => s + n, 0) / pointsForAvg.length
          : null;
      return {
        player: p,
        vegasRank: vegasRankById.get(p.playerId) ?? null,
        vegasPoints: vegasPoints > 0 ? vegasPoints : null,
        councilAvgRank: displayCouncil,
        councilRankerCount: stored.councilRankerCount,
        mineRank: displayMine,
        espnRank: displayEspn,
        espnPoints: stored.espnPts,
        extraRanks: displayExtras,
        extraPoints: stored.extraPts,
        avgRank,
        avgPoints,
      };
    });

    const valueOf = (row: RowData): number => {
      // In Ranks mode, smaller is better (rank 1 = best). In Points mode,
      // larger is better (more projected FPts = better). The sort comparator
      // always uses ascending order, so we negate the points so "best" sorts
      // first uniformly.
      let v: number | null;
      if (view === "Points") {
        if (sortKey === "VEGAS") v = row.vegasPoints;
        else if (sortKey === "COUNCIL") v = null; // Council has no points
        else if (sortKey === "MINE") v = null; // Mine is a rank, no points
        else if (sortKey === "ESPN") v = row.espnPoints;
        else if (sortKey === "AVG") v = row.avgPoints;
        else {
          const idx = EXTRA_PLATFORMS.findIndex(
            (pf) => pf.key.toUpperCase() === sortKey,
          );
          v = idx >= 0 ? row.extraPoints[idx] : null;
        }
        return v == null ? Number.NEGATIVE_INFINITY : -v;
      }
      if (sortKey === "VEGAS") v = row.vegasRank;
      else if (sortKey === "COUNCIL") v = row.councilAvgRank;
      else if (sortKey === "MINE") v = row.mineRank;
      else if (sortKey === "ESPN") v = row.espnRank;
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

    // Tiers track ONLY the column you're sorting by, drawn as ONE clearly
    // visible full-width divider per tier boundary in that column's brand color.
    // Showing every source's breaks at once looked jumbled (each source's tiers
    // fall at different rows); a faint per-cell underline was too subtle. The
    // sorted column's rows ARE in that source's order, so its breaks form clean
    // horizontal lines. We cluster the active source's PROJECTED POINTS via
    // Jenks (computeTiersForPosition) and break where a row's tier differs from
    // the next row's.
    //
    // Gating: only when a single position is selected — cross-position point
    // tiers are misleading (QBs would dominate). Council and Yahoo publish no
    // points, so sorting by them shows no tier lines.
    const sleeperIdx = EXTRA_PLATFORMS.findIndex((pf) => pf.key === "sleeper");
    const nflIdx = EXTRA_PLATFORMS.findIndex((pf) => pf.key === "nfl");
    const activeSource: TierSource | null =
      sortKey === "AVG"
        ? "avg"
        : sortKey === "VEGAS"
          ? "vegas"
          : sortKey === "ESPN"
            ? "espn"
            : sortKey === "SLEEPER"
              ? "sleeper"
              : sortKey === "NFL"
                ? "nfl"
                : null; // COUNCIL / MINE / YAHOO have no points → no tiers
    const pointsGetter: Record<TierSource, (r: RowData) => number | null> = {
      avg: (r) => r.avgPoints,
      vegas: (r) => r.vegasPoints,
      espn: (r) => r.espnPoints,
      sleeper: (r) => (sleeperIdx >= 0 ? r.extraPoints[sleeperIdx] : null),
      nfl: (r) => (nflIdx >= 0 ? r.extraPoints[nflIdx] : null),
    };
    const showTiers = position !== "ALL";
    let tierBreakByPlayerId: Map<number, boolean> | null = null;
    if (showTiers && activeSource && sorted.length > 0) {
      const input = sorted.map((r) => ({
        playerId: r.player.playerId,
        value: pointsGetter[activeSource](r) ?? 0,
      }));
      const { tiers } = computeTiersForPosition(input, (p) => p.value);
      const map = new Map(tiers.map((t) => [t.playerId, t.tier]));

      tierBreakByPlayerId = new Map();
      sorted.forEach((r, idx) => {
        let broke = false;
        if (idx < sorted.length - 1) {
          const cur = map.get(r.player.playerId);
          const next = map.get(sorted[idx + 1].player.playerId);
          broke = cur != null && next != null && cur !== next;
        }
        tierBreakByPlayerId!.set(r.player.playerId, broke);
      });
    }

    return { sorted, tierBreakByPlayerId, activeSource };
  }, [
    projections,
    scoring,
    position,
    view,
    sortKey,
    platformRankings,
    councilConsensus,
    myRanks,
    hasEspn,
    hasCouncil,
    hasMine,
  ]);

  // Lock the table layout so sorting can never reflow columns. Every data
  // column is a fixed 80px (w-20); the fixed non-data columns sum to ~136px
  // (chevron 32 + # 40 + Pos 48 + trailing 16) and Player takes the rest at a
  // 200px floor. `table-fixed` + this min-width means widths come from the
  // header once and never recalc from cell content. Mobile overflows → scroll.
  const dataColCount =
    2 + // Market + Vegas (always present)
    EXTRA_PLATFORMS.length +
    (hasCouncil ? 1 : 0) +
    (hasMine ? 1 : 0) +
    (hasEspn ? 1 : 0);
  const minTableWidth = 136 + 200 + dataColCount * 80;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <ControlGroup
          label="View"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
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
          {tableData.sorted.length} player{tableData.sorted.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Table */}
      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900"
      >
        <table
          className="w-full table-fixed text-sm"
          style={{ minWidth: minTableWidth }}
        >
          <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-sm uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="w-8 py-3 pl-3"></th>
              <th className="w-10 py-3 pr-2 text-right">#</th>
              <th className="sticky left-0 z-20 min-w-[140px] bg-zinc-900 py-3 pl-2 whitespace-nowrap sm:min-w-[200px] sm:pl-4">Player</th>
              <th className="w-12 py-3 text-center">Pos</th>
              {/* Council — primary FF Council authority. Emphasized column:
                  bold + faint emerald wash. Default sort. */}
              {hasCouncil && (
                <SortHeader
                  label="Council"
                  sortKey="COUNCIL"
                  color="text-emerald-200 font-bold"
                  extraClass="bg-emerald-500/[0.07]"
                  title="Council Consensus — the primary FF Council market. Average rank across approved members' current submissions. Default sort."
                  active={sortKey}
                  onClick={toggleSort}
                />
              )}
              {/* Mine — your personal identity layer, neon-green accent. */}
              {hasMine && (
                <SortHeader
                  label="Mine"
                  sortKey="MINE"
                  color="text-emerald-400 font-semibold"
                  title="Your personal ranking (from My Rankings). Not counted in the Market consensus."
                  active={sortKey}
                  onClick={toggleSort}
                />
              )}
              {/* Market — overall consensus across every source. */}
              <SortHeader
                label="Market"
                sortKey="AVG"
                color="text-zinc-100 font-semibold"
                title={
                  view === "Points"
                    ? "Market — average projected points across every source that publishes one (Vegas, ESPN, Sleeper, NFL). Higher = better."
                    : "Market — overall consensus rank across every source (Council, Vegas, Sleeper, Yahoo, NFL, ESPN)."
                }
                active={sortKey}
                onClick={toggleSort}
              />
              <SortHeader
                label="Vegas"
                sortKey="VEGAS"
                color="text-amber-400/90"
                title="FF Council Vegas-derived rank"
                active={sortKey}
                onClick={toggleSort}
              />
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
              {hasEspn && (
                <SortHeader
                  label="ESPN"
                  sortKey="ESPN"
                  color="text-red-400/80"
                  title="ESPN editorial preseason rank"
                  active={sortKey}
                  onClick={toggleSort}
                />
              )}
              <th className="w-3 sm:w-4" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {tableData.sorted.map((row, idx) => {
              const isExpanded = expandedId === row.player.playerId;
              const tierBreak =
                tableData.tierBreakByPlayerId?.get(row.player.playerId) ?? false;
              const tierBreakColor = tableData.activeSource
                ? TIER_LINE_COLOR[tableData.activeSource]
                : "";
              return (
                <RankRow
                  key={row.player.playerId}
                  player={row.player}
                  rank={idx + 1}
                  scoring={scoring}
                  view={view}
                  condensed={condensed}
                  isExpanded={isExpanded}
                  onToggle={() =>
                    setExpandedId(isExpanded ? null : row.player.playerId)
                  }
                  hasEspn={hasEspn}
                  espnRank={row.espnRank}
                  espnPoints={row.espnPoints}
                  hasCouncil={hasCouncil}
                  councilAvgRank={row.councilAvgRank}
                  councilRankerCount={row.councilRankerCount}
                  hasMine={hasMine}
                  mineRank={row.mineRank}
                  extraRanks={row.extraRanks}
                  extraPoints={row.extraPoints}
                  avgRank={row.avgRank}
                  avgPoints={row.avgPoints}
                  vegasRank={row.vegasRank}
                  vegasPoints={row.vegasPoints}
                  tierBreak={tierBreak}
                  tierBreakColor={tierBreakColor}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        <span className="text-zinc-300">#</span> is the player&apos;s rank in
        the current sort — the <span className="text-emerald-300">Council</span>{" "}
        market by default. <span className="text-emerald-400">Mine</span> is your
        personal ranking; <span className="text-zinc-300">Market</span> is the
        overall consensus. Sort by any column to find disagreements.
        {view === "Points"
          ? " Council, Mine and Yahoo don't publish point projections — those cells read —."
          : " Sleeper / NFL / Yahoo gaps are filled with mock numbers until their fetches reach full coverage."}
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
  view,
  condensed,
  isExpanded,
  onToggle,
  hasEspn,
  espnRank,
  espnPoints,
  hasCouncil,
  councilAvgRank,
  councilRankerCount,
  hasMine,
  mineRank,
  extraRanks,
  extraPoints,
  avgRank,
  avgPoints,
  vegasRank,
  vegasPoints,
  tierBreak,
  tierBreakColor,
}: {
  player: PlayerProjection;
  rank: number;
  scoring: ScoringSystem;
  view: ViewMode;
  condensed: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  hasEspn: boolean;
  espnRank: number | null;
  espnPoints: number | null;
  hasCouncil: boolean;
  councilAvgRank: number | null;
  councilRankerCount: number;
  hasMine: boolean;
  mineRank: number | null;
  extraRanks: Array<number | null>;
  extraPoints: Array<number | null>;
  avgRank: number | null;
  avgPoints: number | null;
  vegasRank: number | null;
  vegasPoints: number | null;
  // true = this row is the last player of a tier in the sorted column, so we
  // draw a full-width divider beneath it. `tierBreakColor` is that column's
  // brand border color. false everywhere on the ALL view (tiers gated off).
  tierBreak: boolean;
  tierBreakColor: string;
}) {
  const fpts = player.fantasyPoints[scoring];
  const vbd = player.vbd[scoring];
  const showPoints = view === "Points";
  // Format points with one decimal, no padding. Rank stays integer.
  const fmtPts = (v: number | null) => (v != null ? v.toFixed(1) : "—");
  const fmtRank = (v: number | null) => (v != null ? v.toFixed(0) : "—");
  // Full-width tier divider beneath this row when it's the last player of a
  // tier in the sorted column (colored by that column's brand accent).
  const tierDivider = tierBreak ? ` border-b-2 ${tierBreakColor}` : "";

  return (
    <>
      <tr
        onClick={onToggle}
        className={`group cursor-pointer border-t border-zinc-800/60 transition hover:bg-zinc-800/40${tierDivider}`}
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
            {condensed ? condenseName(player.name) : player.name}
          </Link>
          <span className="ml-2 font-mono text-sm text-zinc-500">
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
        {/* Column hierarchy: Council (primary authority) → Mine (you) →
            Market (consensus) → external sources → ESPN. Council wears a faint
            emerald wash + bold bright text so it reads as the core market. */}
        {hasCouncil && (
          <td
            className="min-w-[5rem] bg-emerald-500/[0.05] py-3 text-center font-mono text-sm font-semibold tabular-nums"
            title={
              showPoints
                ? "Council is a rank, not a projection — no points to show"
                : councilRankerCount
                  ? `${councilRankerCount} ranker${councilRankerCount === 1 ? "" : "s"}`
                  : "No council ranking"
            }
          >
            <span className="text-emerald-100">
              {showPoints
                ? "—"
                : councilAvgRank != null
                  ? Number.isInteger(councilAvgRank)
                    ? councilAvgRank.toFixed(0)
                    : councilAvgRank.toFixed(1)
                  : "—"}
            </span>
          </td>
        )}
        {hasMine && (
          <td
            className="min-w-[5rem] py-3 text-center font-mono text-sm font-medium tabular-nums"
            title={
              showPoints
                ? "Your ranking is a rank, not a projection — no points to show"
                : "Your personal ranking"
            }
          >
            <span className="text-emerald-400">
              {showPoints ? "—" : fmtRank(mineRank)}
            </span>
          </td>
        )}
        {/* Market — overall consensus. Neutral but important. */}
        <td className="min-w-[5rem] py-3 text-center font-mono text-sm font-semibold tabular-nums">
          {showPoints ? (
            avgPoints != null ? (
              <span className="text-zinc-100">{avgPoints.toFixed(1)}</span>
            ) : (
              <span className="text-zinc-600">—</span>
            )
          ) : avgRank != null ? (
            <span className="text-zinc-100">{avgRank.toFixed(1)}</span>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </td>
        <td className="min-w-[5rem] py-3 text-center font-mono text-sm tabular-nums">
          <span className="text-amber-400/90">
            {showPoints ? fmtPts(vegasPoints) : fmtRank(vegasRank)}
          </span>
        </td>
        {(showPoints ? extraPoints : extraRanks).map((r, idx) => {
          const key = EXTRA_PLATFORMS[idx].key;
          return (
            <td
              key={key}
              className="min-w-[5rem] py-3 text-center font-mono text-sm tabular-nums"
            >
              <span className={EXTRA_PLATFORMS[idx].accent}>
                {showPoints ? fmtPts(r) : fmtRank(r)}
              </span>
            </td>
          );
        })}
        {hasEspn && (
          <td className="min-w-[5rem] py-3 text-center font-mono text-sm tabular-nums">
            <span className="text-red-400/80">
              {showPoints ? fmtPts(espnPoints) : fmtRank(espnRank)}
            </span>
          </td>
        )}
        <td aria-hidden="true" />
      </tr>
      {isExpanded && (
        <tr className="border-t border-zinc-800/60 bg-zinc-950/50">
          <td
            colSpan={
              7 +
              (hasEspn ? 1 : 0) +
              (hasCouncil ? 1 : 0) +
              (hasMine ? 1 : 0) +
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
