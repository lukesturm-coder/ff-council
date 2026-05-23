"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Polymarket "All markets"-style grid for every live decision (trades + tough
// calls), with category filter pills. Cards reuse the emerald share-bar visual
// language from the home voting cards, laid out in a responsive grid.

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

export type TradeDecision = {
  kind: "trade";
  id: string;
  sideA: string;
  sideB: string;
  aPct: number;
  bPct: number;
  evenPct: number;
  winner: "A" | "B" | "EVEN";
  winnerPct: number;
  total: number;
  meta: string;
  categories: string[];
};

export type VerdictDecision = {
  kind: "verdict";
  id: string;
  question: string;
  options: { name: string; position: string; pct: number }[];
  total: number;
  meta: string;
  categories: string[];
};

export type Decision = TradeDecision | VerdictDecision;

type Filter = { key: string; label: string };
const FILTERS: Filter[] = [
  { key: "all", label: "All" },
  { key: "trades", label: "Trades" },
  { key: "draft", label: "Draft" },
  { key: "dynasty", label: "Dynasty" },
  { key: "redraft", label: "Redraft" },
];

function TradeCard({ d }: { d: TradeDecision }) {
  const aWins = d.winner === "A";
  const bWins = d.winner === "B";
  const winnerName = aWins ? d.sideA : bWins ? d.sideB : null;
  return (
    <Link
      href={`/trades/${d.id}`}
      className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition hover:border-emerald-500/40 hover:bg-zinc-900/60"
    >
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
        Trade
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
        <span
          className={`truncate ${aWins ? "font-semibold text-emerald-300" : "text-zinc-400"}`}
        >
          {d.sideA}
        </span>
        <span className="text-xs text-zinc-600">↔</span>
        <span
          className={`truncate text-right ${bWins ? "font-semibold text-emerald-300" : "text-zinc-400"}`}
        >
          {d.sideB}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${d.total > 0 ? d.winnerPct : 0}%` }}
        />
      </div>
      <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-semibold text-emerald-300">
          {d.total === 0
            ? "Tap to weigh in"
            : d.winner === "EVEN"
              ? `Too close · ${d.winnerPct}%`
              : `${d.winnerPct}% pick ${winnerName}`}
        </span>
        <span className="shrink-0 text-zinc-500">
          {d.total} vote{d.total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">
        {d.meta}
      </div>
    </Link>
  );
}

function VerdictCard({ d }: { d: VerdictDecision }) {
  const shown = d.options.slice(0, 3);
  return (
    <Link
      href={`/verdict/${d.id}`}
      className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition hover:border-emerald-500/40 hover:bg-zinc-900/60"
    >
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
        Tough call
      </div>
      <p className="text-sm font-medium text-zinc-100">{d.question}</p>
      {shown.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {shown.map((o, i) => {
            const isLeader = i === 0 && d.total > 0;
            return (
              <div
                key={`${o.name}-${i}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-2"
              >
                <span
                  className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                    POSITION_STYLES[o.position] ??
                    "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
                  }`}
                >
                  {o.position}
                </span>
                <div className="min-w-0">
                  <span
                    className={`block truncate text-sm ${
                      isLeader ? "font-semibold text-emerald-200" : "text-zinc-300"
                    }`}
                  >
                    {o.name}
                  </span>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${
                        isLeader ? "bg-emerald-500" : "bg-zinc-600"
                      }`}
                      style={{ width: `${o.pct}%` }}
                    />
                  </div>
                </div>
                <span
                  className={`shrink-0 font-mono text-xs tabular-nums ${
                    isLeader ? "font-semibold text-emerald-300" : "text-zinc-400"
                  }`}
                >
                  {o.pct}%
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">Tap to weigh in.</p>
      )}
      <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          {d.total} vote{d.total === 1 ? "" : "s"} · tap to vote
        </span>
        {d.meta && (
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">
            {d.meta}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function AllDecisionsClient({
  decisions,
}: {
  decisions: Decision[];
}) {
  const [filter, setFilter] = useState("all");

  const visible = useMemo(
    () =>
      filter === "all"
        ? decisions
        : decisions.filter((d) => d.categories.includes(filter)),
    [decisions, filter],
  );

  return (
    <section className="mt-10 border-t border-zinc-800 pt-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-100 sm:text-xl">
          All decisions
        </h2>
        <Link
          href="/judge"
          className="shrink-0 text-xs text-emerald-400 underline-offset-4 hover:underline"
        >
          Open Judge →
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition ${
              filter === f.key
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-500/40"
                : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-400">
          Nothing here yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((d) =>
            d.kind === "trade" ? (
              <TradeCard key={`t-${d.id}`} d={d} />
            ) : (
              <VerdictCard key={`v-${d.id}`} d={d} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
