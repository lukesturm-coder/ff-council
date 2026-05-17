"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import VotingPanel from "./[id]/VotingPanel";

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

type Summary = {
  total_votes: number;
  votes_a: number;
  votes_b: number;
  votes_even: number;
};

export type TradeCardData = {
  id: string;
  league_type: string;
  scoring: string;
  team_count: number;
  side_a: Side;
  side_b: Side;
  created_at: string;
  summary: Summary | null;
};

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function pickLabel(p: SidePick): string {
  return `${p.year} R${p.round}${
    p.slot ? `.${String(p.slot).padStart(2, "0")}` : ""
  }`;
}

export function TradeListCardButton({
  trade,
  onOpen,
}: {
  trade: TradeCardData;
  onOpen: (t: TradeCardData) => void;
}) {
  const total = trade.summary?.total_votes ?? 0;
  const aPct =
    total > 0 ? Math.round(((trade.summary?.votes_a ?? 0) / total) * 100) : 0;
  const bPct =
    total > 0 ? Math.round(((trade.summary?.votes_b ?? 0) / total) * 100) : 0;
  const evenPct = total > 0 ? 100 - aPct - bPct : 0;

  const verdict =
    total === 0
      ? "No votes yet"
      : aPct > bPct && aPct > evenPct
        ? `${aPct}% favor Team A`
        : bPct > aPct && bPct > evenPct
          ? `${bPct}% favor Team B`
          : `${evenPct}% even`;

  return (
    <button
      type="button"
      onClick={() => onOpen(trade)}
      className="block w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:p-4"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
        <CardSidePreview side={trade.side_a} accent="rose" />
        <div className="flex items-center justify-center text-xs text-zinc-500">
          ↔
        </div>
        <CardSidePreview side={trade.side_b} accent="sky" />
        <div className="col-span-3 flex flex-row items-center justify-between gap-1 border-t border-zinc-800 pt-2 text-xs md:col-span-1 md:flex-col md:items-end md:justify-center md:border-t-0 md:pt-0">
          <span className="font-medium text-zinc-200">{verdict}</span>
          <span className="text-zinc-500">
            {total} vote{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span>{trade.league_type}</span>
        <span>·</span>
        <span>{trade.scoring}</span>
        <span>·</span>
        <span>{trade.team_count} teams</span>
        <span>·</span>
        <span>{new Date(trade.created_at).toLocaleDateString()}</span>
      </div>
    </button>
  );
}

function CardSidePreview({
  side,
  accent,
}: {
  side: Side;
  accent: "rose" | "sky";
}) {
  const color = accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div className="space-y-1">
      {side.players.slice(0, 3).map((p, idx) => (
        <div key={`p-${idx}`} className="flex items-center gap-2 text-sm">
          {p.position && POSITION_STYLES[p.position] && (
            <span
              className={`inline-flex rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
            >
              {p.position}
            </span>
          )}
          <span className="truncate text-zinc-100">{p.name}</span>
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            {p.team}
          </span>
        </div>
      ))}
      {side.picks.slice(0, 2).map((pk, idx) => (
        <div key={`pk-${idx}`} className="flex items-center gap-2 text-sm">
          <span className={`text-[10px] uppercase tracking-wider ${color}`}>
            pick
          </span>
          <span className="font-mono text-xs text-zinc-300">
            {pk.year} R{pk.round}
          </span>
        </div>
      ))}
      {side.players.length + side.picks.length > 5 && (
        <p className="text-xs text-zinc-600">
          + {side.players.length + side.picks.length - 5} more
        </p>
      )}
    </div>
  );
}

export default function TradeListClient({ trades }: { trades: TradeCardData[] }) {
  const [openTrade, setOpenTrade] = useState<TradeCardData | null>(null);

  return (
    <>
      <div className="space-y-3">
        {trades.map((t) => (
          <TradeListCardButton key={t.id} trade={t} onOpen={setOpenTrade} />
        ))}
      </div>

      {openTrade && (
        <TradeModal trade={openTrade} onClose={() => setOpenTrade(null)} />
      )}
    </>
  );
}

function TradeModal({
  trade,
  onClose,
}: {
  trade: TradeCardData;
  onClose: () => void;
}) {
  const [voted, setVoted] = useState(false);
  // Winner state lives up here so clicking the Team A / Team B side panel
  // at the top of the modal can drive the verdict — VotingPanel below
  // mirrors the selection.
  const [winner, setWinner] = useState<"A" | "B" | "EVEN" | null>(null);

  // Lock body scroll while open + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Auto-close after a successful vote (match home-modal pattern, ~2.5s).
  useEffect(() => {
    if (!voted) return;
    const t = setTimeout(onClose, 2500);
    return () => clearTimeout(t);
  }, [voted, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700/60 bg-zinc-900 p-4 shadow-2xl shadow-emerald-900/10 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        {voted ? (
          <div className="py-10 text-center">
            <h3 className="text-2xl font-bold text-emerald-300">Thanks!</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Your verdict has been added to the Trade Court.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 pr-8">
              <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
                Your verdict?
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                {trade.league_type} · {trade.scoring}
              </p>
            </div>

            <p className="-mt-2 mb-3 text-xs text-zinc-500">
              Tap the side that won — or the buttons below.
            </p>

            <div className="mb-5 flex flex-col gap-3 sm:flex-row">
              <ModalSidePanel
                label="Team A receives"
                side={trade.side_a}
                accent="text-rose-300"
                team="A"
                selected={winner === "A"}
                onSelect={() => setWinner("A")}
              />
              <div className="flex items-center justify-center text-xs uppercase tracking-wider text-zinc-600">
                for
              </div>
              <ModalSidePanel
                label="Team B receives"
                side={trade.side_b}
                accent="text-sky-300"
                team="B"
                selected={winner === "B"}
                onSelect={() => setWinner("B")}
              />
            </div>

            <VotingPanel
              tradeId={trade.id}
              winner={winner}
              onWinnerChange={setWinner}
              myVote={null}
              onVoted={() => setVoted(true)}
            />

            <div className="mt-4 flex items-center justify-end text-xs text-zinc-500">
              <Link
                href={`/trades/${trade.id}`}
                className="underline-offset-4 hover:text-zinc-300 hover:underline"
                onClick={onClose}
              >
                View full trade →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModalSidePanel({
  label,
  side,
  accent,
  team,
  selected,
  onSelect,
}: {
  label: string;
  side: Side;
  accent: string;
  team: "A" | "B";
  selected: boolean;
  onSelect: () => void;
}) {
  const selectedBorder =
    team === "A"
      ? "border-rose-500/60 bg-rose-500/5 ring-1 ring-rose-500/30"
      : "border-sky-500/60 bg-sky-500/5 ring-1 ring-sky-500/30";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex-1 cursor-pointer rounded-md border p-3 text-left transition ${
        selected
          ? selectedBorder
          : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${accent}`}
        >
          {label}
        </span>
        {selected && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">
            ✓ Your pick
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {side.players.map((p, idx) => (
          <div key={`p-${idx}`} className="flex items-center gap-2 text-sm">
            <span
              className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                POSITION_STYLES[p.position] ??
                "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
              }`}
            >
              {p.position}
            </span>
            <span className="text-zinc-200">{p.name}</span>
            <span className="ml-auto font-mono text-xs text-zinc-500">
              {p.team}
            </span>
          </div>
        ))}
        {side.picks.map((p, idx) => (
          <div
            key={`pk-${idx}`}
            className="flex items-center gap-2 text-xs text-zinc-400"
          >
            <span className="inline-flex shrink-0 rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
              pick
            </span>
            <span className="font-mono">{pickLabel(p)}</span>
          </div>
        ))}
        {side.players.length + side.picks.length === 0 && (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </div>
    </button>
  );
}
