"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { computeTiersForPosition, tierStyle } from "@/lib/tiers";

// ---------------------------------------------------------------------------
// Draft board view — Sleeper-Tiers / Fantasy Footballers UDK pattern.
//
// Per-position grid where each TIER is a horizontal row of player chips.
// Click a chip to mark drafted (visual only; pure client state).
//
// Why this lives next to the chart view and not on its own page:
//   The chart and the board operate on the SAME tier computation. Toggling
//   format/source between them should re-tier both views identically — the
//   user's mental model is "tiers of this player pool" and the only thing
//   changing is presentation. Sharing the route + URL params makes the
//   round-trip free.
//
// Persistence:
//   Drafted state lives in localStorage so a refresh mid-draft doesn't
//   blow away progress. Schema: Record<playerId, true>. We HYDRATE post-mount
//   (SSR-safe) and the first render shows nothing as drafted — once the
//   effect fires we swap in the stored set. This causes a brief flash on
//   slow devices, but in exchange we get clean SSR markup.
//
// Source/format toggles intentionally do NOT clear drafted state. The user's
// drafted player_ids are stable across signal choices; resetting them every
// time someone flips to Half-PPR would be hostile.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ffc-draft-board-state-v1";

type Source = "vegas" | "council";
type PositionFilter = "All" | FantasyPosition;

const POSITIONS: FantasyPosition[] = ["QB", "RB", "WR", "TE"];
const POSITION_LABELS: Record<FantasyPosition, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
};

// Position color ramp — borders + chip accents. Mirrors POSITION_CHIP from
// TiersView so visual identity stays consistent across modes.
const POSITION_CHIP_BORDER: Record<FantasyPosition, string> = {
  QB: "border-rose-500/40",
  RB: "border-emerald-500/40",
  WR: "border-sky-500/40",
  TE: "border-amber-500/40",
};
const POSITION_DOT: Record<FantasyPosition, string> = {
  QB: "bg-rose-400",
  RB: "bg-emerald-400",
  WR: "bg-sky-400",
  TE: "bg-amber-400",
};

type DraftedMap = Record<number, true>;

export default function DraftBoardView({
  projections,
  scoring,
  source,
  councilAvgRank,
}: {
  projections: PlayerProjection[];
  scoring: ScoringSystem;
  source: Source;
  councilAvgRank: Record<number, number>;
}) {
  const [drafted, setDrafted] = useState<DraftedMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("All");
  const [hideDrafted, setHideDrafted] = useState(false);

  // Hydrate drafted set from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object") {
          // Normalize: only keep numeric keys mapping to true.
          const cleaned: DraftedMap = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            const id = Number(k);
            if (Number.isFinite(id) && v === true) cleaned[id] = true;
          }
          setDrafted(cleaned);
        }
      }
    } catch {
      // ignore corrupt localStorage — start clean
    }
    setHydrated(true);
  }, []);

  // Persist on change, but only after hydration so we don't blow away saved
  // state on first render with the empty default.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafted));
    } catch {
      // Quota / private-mode — drop silently
    }
  }, [drafted, hydrated]);

  const toggleDrafted = useCallback((playerId: number) => {
    setDrafted((prev) => {
      const next = { ...prev };
      if (next[playerId]) delete next[playerId];
      else next[playerId] = true;
      return next;
    });
  }, []);

  const resetBoard = useCallback(() => {
    setDrafted({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const visiblePositions: FantasyPosition[] =
    positionFilter === "All" ? POSITIONS : [positionFilter];

  const totalDrafted = Object.keys(drafted).length;

  return (
    <div className="space-y-4">
      <BoardControls
        positionFilter={positionFilter}
        hideDrafted={hideDrafted}
        totalDrafted={totalDrafted}
        onPositionFilter={setPositionFilter}
        onHideDrafted={setHideDrafted}
        onReset={resetBoard}
      />

      {visiblePositions.map((pos) => (
        <PositionBoard
          key={pos}
          position={pos}
          projections={projections}
          scoring={scoring}
          source={source}
          councilAvgRank={councilAvgRank}
          drafted={drafted}
          hideDrafted={hideDrafted}
          onToggle={toggleDrafted}
        />
      ))}
    </div>
  );
}

function BoardControls({
  positionFilter,
  hideDrafted,
  totalDrafted,
  onPositionFilter,
  onHideDrafted,
  onReset,
}: {
  positionFilter: PositionFilter;
  hideDrafted: boolean;
  totalDrafted: number;
  onPositionFilter: (p: PositionFilter) => void;
  onHideDrafted: (h: boolean) => void;
  onReset: () => void;
}) {
  const filters: PositionFilter[] = ["All", "QB", "RB", "WR", "TE"];
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          Position
        </span>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => onPositionFilter(f)}
            className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
              positionFilter === f
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={hideDrafted}
          onChange={(e) => onHideDrafted(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-emerald-500"
        />
        <span className="text-zinc-300">Hide fully-drafted tiers</span>
      </label>

      <button
        onClick={onReset}
        disabled={totalDrafted === 0}
        className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:border-rose-500/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:text-zinc-300"
        title="Clear all drafted players from the board"
      >
        Reset board
        {totalDrafted > 0 && (
          <span className="ml-1 font-mono text-xs text-zinc-500">
            ({totalDrafted})
          </span>
        )}
      </button>
    </div>
  );
}

function PositionBoard({
  position,
  projections,
  scoring,
  source,
  councilAvgRank,
  drafted,
  hideDrafted,
  onToggle,
}: {
  position: FantasyPosition;
  projections: PlayerProjection[];
  scoring: ScoringSystem;
  source: Source;
  councilAvgRank: Record<number, number>;
  drafted: DraftedMap;
  hideDrafted: boolean;
  onToggle: (id: number) => void;
}) {
  const positionPlayers = useMemo(
    () => projections.filter((p) => p.position === position),
    [projections, position],
  );

  // Same clustering logic as PositionTierChart in TiersView — pulled out into
  // a thin shared shape so source/scoring toggles keep both views in sync.
  const clustered = useMemo(() => {
    if (source === "council") {
      const ranked = positionPlayers.filter(
        (p) => councilAvgRank[p.playerId] != null,
      );
      if (ranked.length === 0) {
        return computeTiersForPosition(
          positionPlayers,
          (p) => p.fantasyPoints[scoring],
        );
      }
      return computeTiersForPosition(
        ranked,
        (p) => -councilAvgRank[p.playerId],
      );
    }
    return computeTiersForPosition(
      positionPlayers,
      (p) => p.fantasyPoints[scoring],
    );
  }, [positionPlayers, scoring, source, councilAvgRank]);

  // Group players by tier, preserving descending-value order within tier.
  const tiersGrouped = useMemo(() => {
    const byTier = new Map<
      number,
      Array<(typeof clustered.tiers)[number]>
    >();
    for (const p of clustered.tiers) {
      if (!byTier.has(p.tier)) byTier.set(p.tier, []);
      byTier.get(p.tier)!.push(p);
    }
    return Array.from(byTier.entries()).sort((a, b) => a[0] - b[0]);
  }, [clustered]);

  if (clustered.tiers.length === 0) return null;

  const totalPlayers = clustered.tiers.length;
  const draftedCount = clustered.tiers.filter((p) => drafted[p.playerId])
    .length;
  const undraftedCount = totalPlayers - draftedCount;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-100 sm:text-lg">
          {POSITION_LABELS[position]}
        </h3>
        <span className="text-xs text-zinc-400">
          <span className="font-mono font-semibold text-zinc-200">
            {position}
          </span>{" "}
          ·{" "}
          <span className="font-mono font-semibold text-emerald-300">
            {undraftedCount}
          </span>{" "}
          of {totalPlayers} undrafted
        </span>
      </div>

      <div className="space-y-2">
        {tiersGrouped.map(([tier, players]) => {
          const undraftedInTier = players.filter((p) => !drafted[p.playerId]);
          const isFullyDrafted = undraftedInTier.length === 0;
          if (hideDrafted && isFullyDrafted) return null;

          const isLastInTier = undraftedInTier.length === 1;
          const lastManId = isLastInTier
            ? undraftedInTier[0].playerId
            : null;

          const fptsValues = players.map((p) => p.fantasyPoints[scoring]);
          const tierMax = Math.max(...fptsValues);
          const tierMin = Math.min(...fptsValues);
          const style = tierStyle(tier);

          return (
            <div
              key={tier}
              className={`flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-2 sm:flex-row sm:items-start sm:gap-3 ${
                isFullyDrafted ? "opacity-60" : ""
              }`}
            >
              {/* Tier header — stacks above row on mobile, sits to the left on sm+ */}
              <div className="flex shrink-0 items-center gap-2 sm:w-48 sm:flex-col sm:items-start sm:gap-1">
                <span
                  className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs font-semibold ring-1 ring-inset ${style.badge}`}
                >
                  T{tier}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {players.length}{" "}
                  {players.length === 1 ? "player" : "players"} ·{" "}
                  <span className="font-mono tabular-nums">
                    {tierMin.toFixed(0)}–{tierMax.toFixed(0)}
                  </span>{" "}
                  FPts
                </span>
                {isLastInTier && (
                  <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-amber-300 sm:inline">
                    Last in tier
                  </span>
                )}
              </div>

              {/* Chips row */}
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {players.map((p) => (
                  <PlayerChip
                    key={p.playerId}
                    name={p.name}
                    team={p.team}
                    position={p.position}
                    fpts={p.fantasyPoints[scoring]}
                    drafted={Boolean(drafted[p.playerId])}
                    isLastInTier={p.playerId === lastManId}
                    onClick={() => onToggle(p.playerId)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlayerChip({
  name,
  team,
  position,
  fpts,
  drafted,
  isLastInTier,
  onClick,
}: {
  name: string;
  team: string;
  position: FantasyPosition;
  fpts: number;
  drafted: boolean;
  isLastInTier: boolean;
  onClick: () => void;
}) {
  // Visual states (in priority order):
  //  - drafted: dimmed + line-through, no ring pulse (even if it WAS the last)
  //  - last-in-tier (undrafted only): amber animate-pulse ring + eyebrow
  //  - default: position-color border, hover-brighten
  const baseBorder = POSITION_CHIP_BORDER[position];
  const ringClass = isLastInTier && !drafted
    ? "ring-2 ring-amber-400/60 animate-pulse"
    : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center gap-1.5 rounded-md border bg-zinc-900 px-2 py-1.5 text-left transition hover:border-zinc-500 hover:bg-zinc-800 ${baseBorder} ${ringClass} ${
        drafted ? "opacity-50" : ""
      }`}
      aria-pressed={drafted}
      title={
        drafted
          ? `${name} — drafted (click to undo)`
          : isLastInTier
            ? `${name} — LAST player in this tier`
            : `${name} — click to mark drafted`
      }
    >
      {isLastInTier && !drafted && (
        <span className="absolute -top-2 left-1 rounded bg-amber-500 px-1 py-px font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-950">
          Last in tier
        </span>
      )}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${POSITION_DOT[position]}`}
        aria-hidden
      />
      <span className="flex min-w-0 flex-col">
        <span
          className={`truncate text-xs font-semibold leading-tight text-zinc-100 sm:text-sm ${
            drafted ? "line-through" : ""
          }`}
        >
          {name}
        </span>
        <span className="font-mono text-[10px] leading-tight text-zinc-500">
          {team} ·{" "}
          <span className="tabular-nums text-zinc-400">{fpts.toFixed(1)}</span>
        </span>
      </span>
    </button>
  );
}
