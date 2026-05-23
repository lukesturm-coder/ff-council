"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import TrendingChart, { type TrendingSeries } from "./TrendingChart";

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

export type Mover = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  currentRank: number;
  change: number;
  color: string;
};

function MoverRow({
  m,
  rising,
  selected,
  dimmed,
  onSelect,
}: {
  m: Mover;
  rising: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const Arrow = rising ? ArrowUpRight : ArrowDownRight;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition ${
        selected
          ? "bg-zinc-800 ring-1 ring-inset ring-zinc-600"
          : "hover:bg-zinc-800/50"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: m.color }}
        aria-hidden
      />
      <span
        className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
          POSITION_STYLES[m.position] ??
          "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
        }`}
      >
        {m.position}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
        {m.name}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-zinc-500">
        #{m.currentRank}
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-0.5 font-mono text-xs font-semibold ${
          rising ? "text-emerald-400" : "text-red-400"
        }`}
      >
        <Arrow className="h-3.5 w-3.5" />
        {Math.abs(m.change)}
      </span>
    </button>
  );
}

export default function TrendingBoardClient({
  risers,
  fallers,
  series,
  weeks,
  scoring,
}: {
  risers: Mover[];
  fallers: Mover[];
  series: TrendingSeries[];
  weeks: number;
  scoring: string;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const toggle = (id: number) =>
    setSelectedId((cur) => (cur === id ? null : id));

  function group(movers: Mover[], rising: boolean) {
    return movers.map((m) => (
      <MoverRow
        key={m.playerId}
        m={m}
        rising={rising}
        selected={selectedId === m.playerId}
        dimmed={selectedId != null && selectedId !== m.playerId}
        onSelect={() => toggle(m.playerId)}
      />
    ));
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden />
          <h2 className="text-base font-semibold text-zinc-100 sm:text-lg">
            Trending
          </h2>
          <span className="hidden text-xs text-zinc-500 sm:inline">
            risers &amp; fallers
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">
          {scoring} · last {weeks} wks
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-6">
        <div className="space-y-3">
          {risers.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                <ArrowUpRight className="h-3.5 w-3.5" /> Rising
              </div>
              <div className="space-y-0.5">{group(risers, true)}</div>
            </div>
          )}
          {fallers.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
                <ArrowDownRight className="h-3.5 w-3.5" /> Falling
              </div>
              <div className="space-y-0.5">{group(fallers, false)}</div>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <TrendingChart
            series={series}
            weeks={weeks}
            selectedId={selectedId}
            onSelect={toggle}
          />
          <p className="mt-1.5 text-center text-[10px] text-zinc-600">
            Tap a line or a name to trace it · lower is better
          </p>
        </div>
      </div>
    </section>
  );
}
