"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Plus, Send, X } from "lucide-react";
import type {
  FantasyPosition,
  ScoringSystem,
} from "@/lib/types";

export type TradePlayer = {
  playerId: number;
  name: string;
  position: FantasyPosition;
  team: string;
  fantasyPoints: Record<ScoringSystem, number>;
  vbd: Record<ScoringSystem, number>;
  espnAdp: Partial<Record<ScoringSystem, number>>;
  fpAdp: Partial<Record<ScoringSystem, number>>;
  councilRank: Partial<Record<ScoringSystem, number>>;
};

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

// Convert ADP/rank values (lower=better) into a comparable "value" — invert so
// higher numbers = better. Using 250 - rank gives a positive value space where
// rank 1 → 249, rank 50 → 200, etc. Roughly proportional to draft position.
function adpValue(rank: number | undefined): number | null {
  if (rank == null || !Number.isFinite(rank)) return null;
  return Math.max(0, 250 - rank);
}

function averageOrNull(values: (number | null | undefined)[]): number | null {
  const filtered = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function sumOrZero(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export default function TradeCalculator({ players }: { players: TradePlayer[] }) {
  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [sideA, setSideA] = useState<number[]>([]);
  const [sideB, setSideB] = useState<number[]>([]);
  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");

  const playerById = useMemo(() => {
    const m = new Map<number, TradePlayer>();
    for (const p of players) m.set(p.playerId, p);
    return m;
  }, [players]);

  const aPlayers = sideA
    .map((id) => playerById.get(id))
    .filter((p): p is TradePlayer => !!p);
  const bPlayers = sideB
    .map((id) => playerById.get(id))
    .filter((p): p is TradePlayer => !!p);

  // Verdict metrics for each side
  const aMetrics = computeMetrics(aPlayers, scoring);
  const bMetrics = computeMetrics(bPlayers, scoring);

  function addToSide(side: "A" | "B", playerId: number) {
    if (side === "A") {
      if (!sideA.includes(playerId)) setSideA([...sideA, playerId]);
      setSearchA("");
    } else {
      if (!sideB.includes(playerId)) setSideB([...sideB, playerId]);
      setSearchB("");
    }
  }

  function removeFromSide(side: "A" | "B", playerId: number) {
    if (side === "A") setSideA(sideA.filter((id) => id !== playerId));
    else setSideB(sideB.filter((id) => id !== playerId));
  }

  function swapSides() {
    setSideA(sideB);
    setSideB(sideA);
  }

  function clearAll() {
    setSideA([]);
    setSideB([]);
  }

  return (
    <div className="space-y-6">
      {/* Scoring toggle */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
            Scoring
          </span>
          {SCORING_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setScoring(s)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                scoring === s
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={swapSides}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Swap sides
        </button>
        {(sideA.length > 0 || sideB.length > 0) && (
          <button
            onClick={clearAll}
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Two sides */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TradeSide
          label="Team A gives"
          players={aPlayers}
          search={searchA}
          onSearchChange={setSearchA}
          allPlayers={players}
          onAdd={(id) => addToSide("A", id)}
          onRemove={(id) => removeFromSide("A", id)}
          excludeIds={[...sideA, ...sideB]}
          scoring={scoring}
        />
        <TradeSide
          label="Team B gives"
          players={bPlayers}
          search={searchB}
          onSearchChange={setSearchB}
          allPlayers={players}
          onAdd={(id) => addToSide("B", id)}
          onRemove={(id) => removeFromSide("B", id)}
          excludeIds={[...sideA, ...sideB]}
          scoring={scoring}
        />
      </div>

      {/* Verdict */}
      {(aPlayers.length > 0 || bPlayers.length > 0) && (
        <VerdictPanel a={aMetrics} b={bMetrics} scoring={scoring} />
      )}

      {/* Send to Trade Court */}
      {aPlayers.length > 0 && bPlayers.length > 0 && (
        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500">
            Want the council&apos;s take instead of just the math?
          </p>
          <Link
            href={`/trades/new?a=${sideA.join(",")}&b=${sideB.join(",")}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            <Send className="h-3.5 w-3.5" />
            Submit to Trade Court
          </Link>
        </div>
      )}
    </div>
  );
}

function TradeSide({
  label,
  players,
  search,
  onSearchChange,
  allPlayers,
  onAdd,
  onRemove,
  excludeIds,
  scoring,
}: {
  label: string;
  players: TradePlayer[];
  search: string;
  onSearchChange: (s: string) => void;
  allPlayers: TradePlayer[];
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  excludeIds: number[];
  scoring: ScoringSystem;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase().trim();
    const excluded = new Set(excludeIds);
    return allPlayers
      .filter(
        (p) =>
          !excluded.has(p.playerId) &&
          (p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring])
      .slice(0, 8);
  }, [search, allPlayers, excludeIds, scoring]);

  const sideFpts = sumOrZero(players.map((p) => p.fantasyPoints[scoring]));
  const sideVbd = sumOrZero(players.map((p) => p.vbd[scoring]));

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        <p className="font-mono text-xs text-zinc-400">
          {players.length} player{players.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Selected players */}
      <div className="space-y-1.5">
        {players.length === 0 && (
          <p className="text-xs text-zinc-600">No players yet — add some below</p>
        )}
        {players.map((p) => (
          <div
            key={p.playerId}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
          >
            <span className="flex-1 font-medium text-zinc-100">{p.name}</span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
            >
              {p.position}
            </span>
            <span className="w-10 font-mono text-xs text-zinc-400">
              {p.team}
            </span>
            <span
              className="w-16 text-right font-mono text-xs text-zinc-300"
              title="Vegas season FPts"
            >
              {p.fantasyPoints[scoring].toFixed(1)}
            </span>
            <button
              onClick={() => onRemove(p.playerId)}
              className="text-zinc-500 transition hover:text-rose-400"
              aria-label={`Remove ${p.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Side totals */}
      {players.length > 0 && (
        <div className="flex items-baseline justify-between border-t border-zinc-800 pt-2 text-xs text-zinc-400">
          <span>Vegas total</span>
          <span className="font-mono font-semibold text-zinc-200">
            {sideFpts.toFixed(1)}
          </span>
        </div>
      )}
      {players.length > 0 && (
        <div className="flex items-baseline justify-between text-xs text-zinc-500">
          <span>VBD total</span>
          <span className="font-mono">{sideVbd.toFixed(1)}</span>
        </div>
      )}

      {/* Search input + dropdown */}
      <div className="relative">
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Add player (search by name or team)"
            className="block w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
        {filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
            {filtered.map((p) => (
              <button
                key={p.playerId}
                onClick={() => onAdd(p.playerId)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-zinc-800"
              >
                <span className="flex-1 truncate">{p.name}</span>
                <span
                  className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                >
                  {p.position}
                </span>
                <span className="w-10 font-mono text-xs text-zinc-500">
                  {p.team}
                </span>
                <span className="w-14 text-right font-mono text-xs text-zinc-400">
                  {p.fantasyPoints[scoring].toFixed(1)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type SideMetrics = {
  vegasFpts: number;
  vegasVbd: number;
  espnAdpAvg: number | null;
  fpAdpAvg: number | null;
  councilAvg: number | null;
  espnValue: number | null;
  fpValue: number | null;
  councilValue: number | null;
};

function computeMetrics(
  players: TradePlayer[],
  scoring: ScoringSystem,
): SideMetrics {
  const vegasFpts = sumOrZero(players.map((p) => p.fantasyPoints[scoring]));
  const vegasVbd = sumOrZero(players.map((p) => p.vbd[scoring]));

  const espnAdpAvg = averageOrNull(
    players.map((p) => p.espnAdp[scoring] ?? p.espnAdp.PPR),
  );
  const fpAdpAvg = averageOrNull(players.map((p) => p.fpAdp[scoring]));
  const councilAvg = averageOrNull(players.map((p) => p.councilRank[scoring]));

  return {
    vegasFpts,
    vegasVbd,
    espnAdpAvg,
    fpAdpAvg,
    councilAvg,
    espnValue: averageOrNull(
      players.map((p) => adpValue(p.espnAdp[scoring] ?? p.espnAdp.PPR)),
    ),
    fpValue: averageOrNull(
      players.map((p) => adpValue(p.fpAdp[scoring])),
    ),
    councilValue: averageOrNull(
      players.map((p) => adpValue(p.councilRank[scoring])),
    ),
  };
}

function VerdictPanel({
  a,
  b,
  scoring,
}: {
  a: SideMetrics;
  b: SideMetrics;
  scoring: ScoringSystem;
}) {
  type Row = {
    label: string;
    aValue: number | null;
    bValue: number | null;
    aDisplay: string;
    bDisplay: string;
    /** Whose value wins. "lower" means lower is better (ADP), "higher" means higher is better (FPts). */
    direction: "higher" | "lower";
    color: string;
  };

  const rows: Row[] = [
    {
      label: "Vegas FPts",
      aValue: a.vegasFpts,
      bValue: b.vegasFpts,
      aDisplay: a.vegasFpts.toFixed(1),
      bDisplay: b.vegasFpts.toFixed(1),
      direction: "higher",
      color: "text-zinc-100",
    },
    {
      label: "Vegas VBD",
      aValue: a.vegasVbd,
      bValue: b.vegasVbd,
      aDisplay: a.vegasVbd.toFixed(1),
      bDisplay: b.vegasVbd.toFixed(1),
      direction: "higher",
      color: "text-zinc-200",
    },
    {
      label: "ESPN ADP (avg, lower = better)",
      aValue: a.espnAdpAvg,
      bValue: b.espnAdpAvg,
      aDisplay: a.espnAdpAvg != null ? a.espnAdpAvg.toFixed(1) : "—",
      bDisplay: b.espnAdpAvg != null ? b.espnAdpAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-rose-300",
    },
    {
      label: "FP ADP (avg, lower = better)",
      aValue: a.fpAdpAvg,
      bValue: b.fpAdpAvg,
      aDisplay: a.fpAdpAvg != null ? a.fpAdpAvg.toFixed(1) : "—",
      bDisplay: b.fpAdpAvg != null ? b.fpAdpAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-sky-300",
    },
    {
      label: "Council (avg, lower = better)",
      aValue: a.councilAvg,
      bValue: b.councilAvg,
      aDisplay: a.councilAvg != null ? a.councilAvg.toFixed(1) : "—",
      bDisplay: b.councilAvg != null ? b.councilAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-emerald-300",
    },
  ];

  // Overall verdict: across all sources where both sides have data, who wins more often?
  let aWins = 0;
  let bWins = 0;
  for (const r of rows) {
    if (r.aValue == null || r.bValue == null) continue;
    if (r.direction === "higher") {
      if (r.aValue > r.bValue) aWins++;
      else if (r.bValue > r.aValue) bWins++;
    } else {
      if (r.aValue < r.bValue) aWins++;
      else if (r.bValue < r.aValue) bWins++;
    }
  }

  const verdict =
    aWins === 0 && bWins === 0
      ? "Add players to both sides to see a verdict"
      : aWins > bWins
        ? `Team A wins ${aWins}–${bWins} across sources`
        : bWins > aWins
          ? `Team B wins ${bWins}–${aWins} across sources`
          : `Even split ${aWins}–${bWins}`;

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Verdict ({scoring})
        </h3>
        <p
          className={`text-sm font-semibold ${
            aWins > bWins
              ? "text-rose-300"
              : bWins > aWins
                ? "text-sky-300"
                : "text-zinc-400"
          }`}
        >
          {verdict}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-zinc-500">
          <tr className="text-left">
            <th className="py-1">Source</th>
            <th className="py-1 text-right">Team A</th>
            <th className="py-1 text-right">Team B</th>
            <th className="py-1 text-right">Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            let winner: "A" | "B" | "tie" | "none" = "none";
            let diffText = "—";
            if (r.aValue != null && r.bValue != null) {
              const diff =
                r.direction === "higher"
                  ? r.aValue - r.bValue
                  : r.bValue - r.aValue;
              if (Math.abs(diff) < 0.05) winner = "tie";
              else winner = diff > 0 ? "A" : "B";
              diffText =
                r.direction === "higher"
                  ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`
                  : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`;
            }
            return (
              <tr
                key={r.label}
                className="border-t border-zinc-800/60 text-zinc-300"
              >
                <td className={`py-2 ${r.color}`}>{r.label}</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.aDisplay}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.bDisplay}
                </td>
                <td
                  className={`py-2 text-right font-mono tabular-nums ${
                    winner === "A"
                      ? "text-rose-300"
                      : winner === "B"
                        ? "text-sky-300"
                        : "text-zinc-600"
                  }`}
                >
                  {winner === "A"
                    ? `A ${diffText}`
                    : winner === "B"
                      ? `B ${diffText}`
                      : winner === "tie"
                        ? "≈ tie"
                        : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
