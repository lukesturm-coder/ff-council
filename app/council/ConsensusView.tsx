"use client";

import { useMemo, useState } from "react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { TIER_STYLES, computeTiersByPlayer } from "@/lib/tiers";

export type ConsensusRow = {
  playerId: number;
  name: string;
  team: string;
  position: FantasyPosition;
  vegasVbd: number;
  vegasFpts: number;
  rankerCount: number;
  avgRank: number;
  medianRank: number;
  stddevRank: number | null;
  minRank: number;
  maxRank: number;
};

type PositionFilter = "ALL" | FantasyPosition;

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const POSITION_OPTIONS: PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE"];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

export default function ConsensusView({
  consensusByScoring,
  projections,
}: {
  consensusByScoring: Record<ScoringSystem, ConsensusRow[]>;
  projections: PlayerProjection[];
}) {
  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [position, setPosition] = useState<PositionFilter>("ALL");

  const tierByPlayer = useMemo(
    () => computeTiersByPlayer(projections, scoring),
    [projections, scoring],
  );

  const view = useMemo(() => {
    const rows = consensusByScoring[scoring];
    const filtered =
      position === "ALL" ? rows : rows.filter((r) => r.position === position);

    // Vegas VBD rank within the filtered set (1 = highest VBD)
    const vegasSorted = [...filtered].sort((a, b) => b.vegasVbd - a.vegasVbd);
    const vegasRankById = new Map<number, number>();
    vegasSorted.forEach((r, idx) => vegasRankById.set(r.playerId, idx + 1));

    return { rows: filtered, vegasRankById };
  }, [consensusByScoring, scoring, position]);

  if (view.rows.length === 0) {
    return (
      <div className="space-y-4">
        <Controls
          scoring={scoring}
          setScoring={setScoring}
          position={position}
          setPosition={setPosition}
        />
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-center text-sm text-zinc-400">
          No consensus data yet for{" "}
          <span className="text-zinc-200">{scoring}</span>
          {position !== "ALL" && (
            <>
              {" "}/ <span className="text-zinc-200">{position}</span>
            </>
          )}
          . The Council Consensus appears once approved members submit
          rankings for this scoring system.
          {projections.length > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              {projections.length} players are available in the pool.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Controls
        scoring={scoring}
        setScoring={setScoring}
        position={position}
        setPosition={setPosition}
      />

      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="w-10 py-3 pl-2 text-right sm:w-12 sm:pl-4">#</th>
              <th className="py-3 pl-2 sm:pl-4">Player</th>
              <th className="py-3 pl-2">Pos</th>
              <th
                className="py-3 pl-2"
                title="Per-position tier (S/A/B/C/D) based on natural FPts gaps in Vegas projections"
              >
                Tier
              </th>
              <th className="hidden py-3 pl-2 sm:table-cell">Team</th>
              <th className="py-3 pr-2 text-right sm:pr-4" title="Average council rank">
                Avg
              </th>
              <th className="hidden py-3 pr-4 text-right sm:table-cell" title="Median council rank">
                Med
              </th>
              <th
                className="py-3 pr-2 text-right sm:pr-4"
                title="Standard deviation of council ranks — high = disagreement"
              >
                <span className="sm:hidden">Spr</span>
                <span className="hidden sm:inline">Std Dev</span>
              </th>
              <th
                className="hidden py-3 pr-4 text-right sm:table-cell"
                title="Number of council members who ranked this player"
              >
                Rankers
              </th>
              <th
                className="py-3 pr-2 text-right sm:pr-4"
                title="Council rank vs Vegas VBD rank"
              >
                <span className="sm:hidden">Edge</span>
                <span className="hidden sm:inline">Edge vs Vegas</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, idx) => {
              const rank = idx + 1;
              const vegasRank = view.vegasRankById.get(row.playerId) ?? null;
              const edge = vegasRank == null ? null : vegasRank - rank;
              const stddevDisplay =
                row.stddevRank == null
                  ? "—"
                  : row.stddevRank.toFixed(1);
              const spreadColor =
                row.stddevRank == null
                  ? "text-zinc-500"
                  : row.stddevRank >= 5
                    ? "text-rose-300"
                    : row.stddevRank >= 2
                      ? "text-amber-300"
                      : "text-zinc-300";

              return (
                <tr
                  key={row.playerId}
                  className="border-t border-zinc-800/60 transition hover:bg-zinc-800/30"
                >
                  <td className="py-3 pl-2 text-right font-mono text-zinc-500 sm:pl-4">
                    {rank}
                  </td>
                  <td className="py-3 pl-2 font-medium sm:pl-4">{row.name}</td>
                  <td className="py-3 pl-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[row.position]}`}
                    >
                      {row.position}
                    </span>
                  </td>
                  <td className="py-3 pl-2">
                    {(() => {
                      const tier = tierByPlayer.get(row.playerId);
                      return tier ? (
                        <span
                          className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset ${TIER_STYLES[tier].badge}`}
                          title={`Tier ${tier} · ${TIER_STYLES[tier].label}`}
                        >
                          {tier}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      );
                    })()}
                  </td>
                  <td className="hidden py-3 pl-2 font-mono text-xs text-zinc-400 sm:table-cell">
                    {row.team}
                  </td>
                  <td className="py-3 pr-2 text-right font-mono tabular-nums sm:pr-4">
                    {row.avgRank.toFixed(1)}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-400 sm:table-cell">
                    {row.medianRank.toFixed(0)}
                  </td>
                  <td
                    className={`py-3 pr-2 text-right font-mono text-xs tabular-nums sm:pr-4 ${spreadColor}`}
                  >
                    {stddevDisplay}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs text-zinc-500 sm:table-cell">
                    {row.rankerCount}
                  </td>
                  <td className="py-3 pr-2 text-right font-mono text-xs tabular-nums sm:pr-4">
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
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        <span className="text-zinc-300">Std Dev</span> is the standard
        deviation of council ranks — green ≤ 2, amber 2–5, red ≥ 5. High = a
        controversial player the council can&apos;t agree on.{" "}
        <span className="text-zinc-300">Rankers</span> = how many council
        members have submitted a rank for that player.{" "}
        <span className="text-zinc-300">Edge vs Vegas</span> shows where the
        council&apos;s collective judgment diverges from the market — positive
        means the council ranks them higher than the Vegas Edge ranking does.
      </p>
    </div>
  );
}

function Controls({
  scoring,
  setScoring,
  position,
  setPosition,
}: {
  scoring: ScoringSystem;
  setScoring: (s: ScoringSystem) => void;
  position: PositionFilter;
  setPosition: (p: PositionFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          Scoring
        </span>
        {SCORING_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setScoring(s)}
            className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
              scoring === s
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          Pos
        </span>
        {POSITION_OPTIONS.map((p) => (
          <button
            key={p}
            onClick={() => setPosition(p)}
            className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
              position === p
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
