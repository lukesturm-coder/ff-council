"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { castVote } from "./[id]/actions";

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

  // Pick the leader of A / B / EVEN. Whatever wins drives the verdict
  // chip and the subtle winner-side highlight on the preview.
  type Winner = "A" | "B" | "EVEN" | null;
  const winner: Winner =
    total === 0
      ? null
      : aPct >= bPct && aPct >= evenPct
        ? "A"
        : bPct >= aPct && bPct >= evenPct
          ? "B"
          : "EVEN";
  const winnerPct =
    winner === "A" ? aPct : winner === "B" ? bPct : winner === "EVEN" ? evenPct : 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(trade)}
      className="block w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:p-4"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
        <CardSidePreview
          side={trade.side_a}
          accent="rose"
          isWinner={winner === "A"}
        />
        <div className="flex items-center justify-center text-xs text-zinc-500">
          ↔
        </div>
        <CardSidePreview
          side={trade.side_b}
          accent="sky"
          isWinner={winner === "B"}
        />
        <div className="col-span-3 flex flex-row items-center justify-between gap-2 border-t border-zinc-800 pt-2 text-xs md:col-span-1 md:min-w-[140px] md:flex-col md:items-end md:justify-center md:border-t-0 md:pt-0">
          {total === 0 ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                Cast first vote
              </span>
              <span className="text-zinc-500">0 votes</span>
            </>
          ) : (
            <>
              <span
                className={`font-mono text-lg font-bold leading-none tabular-nums ${
                  winner === "A"
                    ? "text-rose-300"
                    : winner === "B"
                      ? "text-sky-300"
                      : "text-zinc-200"
                }`}
              >
                {winnerPct}%
              </span>
              <span className="font-medium text-zinc-200 md:text-right">
                {winner === "A"
                  ? "favor Team A"
                  : winner === "B"
                    ? "favor Team B"
                    : "called it even"}
              </span>
              <span className="text-zinc-500">
                {total} vote{total === 1 ? "" : "s"}
              </span>
            </>
          )}
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
  isWinner,
}: {
  side: Side;
  accent: "rose" | "sky";
  isWinner?: boolean;
}) {
  const color = accent === "rose" ? "text-rose-300" : "text-sky-300";
  // Winning side gets a faint ring + slightly brighter player names so
  // the eye can tell which side the council picked before reading copy.
  return (
    <div
      className={`min-w-0 space-y-1 rounded-md p-1.5 transition ${
        isWinner
          ? accent === "rose"
            ? "bg-rose-500/5 ring-1 ring-inset ring-rose-500/30"
            : "bg-sky-500/5 ring-1 ring-inset ring-sky-500/30"
          : ""
      }`}
    >
      {side.players.slice(0, 3).map((p, idx) => (
        <div key={`p-${idx}`} className="flex items-center gap-2 text-sm">
          {p.position && POSITION_STYLES[p.position] && (
            <span
              className={`inline-flex rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
            >
              {p.position}
            </span>
          )}
          <span
            className={`truncate ${
              isWinner ? "font-semibold text-zinc-50" : "text-zinc-100"
            }`}
          >
            {p.name}
          </span>
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
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function openByTrade(t: TradeCardData) {
    const idx = trades.findIndex((x) => x.id === t.id);
    if (idx >= 0) setOpenIndex(idx);
  }

  return (
    <>
      <div className="space-y-3">
        {trades.map((t) => (
          <TradeListCardButton key={t.id} trade={t} onOpen={openByTrade} />
        ))}
      </div>

      {openIndex != null && trades[openIndex] && (
        <TradeModal
          // key forces a full remount when advancing — clears voted/winner state
          key={trades[openIndex].id}
          trade={trades[openIndex]}
          position={openIndex + 1}
          total={trades.length}
          onClose={() => setOpenIndex(null)}
          onNext={
            openIndex + 1 < trades.length
              ? () => setOpenIndex(openIndex + 1)
              : null
          }
        />
      )}
    </>
  );
}

function TradeModal({
  trade,
  position,
  total,
  onClose,
  onNext,
}: {
  trade: TradeCardData;
  position: number;
  total: number;
  onClose: () => void;
  onNext: (() => void) | null;
}) {
  const [voted, setVoted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitVote(
    winner: "A" | "B" | "EVEN",
    tier:
      | "balanced"
      | "slight_edge"
      | "clear_advantage"
      | "major_advantage"
      | "extreme_imbalance",
  ) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await castVote({
        tradeId: trade.id,
        winner,
        fairnessTier: tier,
        fairnessLean: winner === "EVEN" ? null : winner,
      });
      if (res.ok) setVoted(true);
      else setError(res.error);
    });
  }

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
              Verdict {position} of {total} recorded.
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              {onNext ? (
                <button
                  type="button"
                  onClick={onNext}
                  className="rounded-md bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                >
                  Vote on the next one →
                </button>
              ) : (
                <p className="text-sm text-zinc-400">
                  You&apos;re caught up — that was the last one.
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                Done for now
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 pr-8">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
                  Your verdict?
                </h3>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {position} / {total}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {trade.league_type} · {trade.scoring}
              </p>
            </div>

            <p className="-mt-2 mb-3 text-xs text-zinc-500">
              One tap on a magnitude under either team — your full verdict in
              a single click.
            </p>

            {/* 3-column one-click grid:
                  [ Team A receives + 4 magnitudes ] [ Even ] [ Team B receives + 4 magnitudes ]
                Each magnitude submits (winner, tier) directly. Stacks on mobile. */}
            <div className="mb-3 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
              {/* Team A column */}
              <div className="flex flex-col gap-2">
                <ModalSidePreview
                  label="Team A receives"
                  side={trade.side_a}
                  accent="text-rose-300"
                />
                {MAGNITUDE_TIERS.map((t) => (
                  <button
                    key={`A-${t.value}`}
                    type="button"
                    disabled={pending}
                    onClick={() => submitVote("A", t.value)}
                    className="min-h-[52px] rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-left transition hover:border-rose-500/60 hover:bg-rose-500/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="text-sm font-semibold text-rose-200">
                      {t.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {t.description}
                    </div>
                  </button>
                ))}
              </div>

              {/* Even column — single tall button */}
              <div className="flex sm:min-w-[120px]">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submitVote("EVEN", "balanced")}
                  className="flex w-full min-h-[80px] sm:min-h-0 sm:w-32 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="flex flex-col items-center gap-0.5">
                      <span>Even</span>
                      <span className="text-[11px] font-normal text-zinc-500">
                        Balanced trade
                      </span>
                    </span>
                  )}
                </button>
              </div>

              {/* Team B column */}
              <div className="flex flex-col gap-2">
                <ModalSidePreview
                  label="Team B receives"
                  side={trade.side_b}
                  accent="text-sky-300"
                />
                {MAGNITUDE_TIERS.map((t) => (
                  <button
                    key={`B-${t.value}`}
                    type="button"
                    disabled={pending}
                    onClick={() => submitVote("B", t.value)}
                    className="min-h-[52px] rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-left transition hover:border-sky-500/60 hover:bg-sky-500/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="text-sm font-semibold text-sky-200">
                      {t.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {t.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="mb-3 text-xs text-rose-300">Error: {error}</p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500">
              {onNext ? (
                <button
                  type="button"
                  onClick={onNext}
                  className="underline-offset-4 hover:text-zinc-300 hover:underline"
                >
                  Skip →
                </button>
              ) : (
                <span />
              )}
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

// Magnitude tiers shown under each team column in the modal.
// Mirrors the same constants used in /judge JudgeFeed.tsx.
const MAGNITUDE_TIERS: Array<{
  value: "slight_edge" | "clear_advantage" | "major_advantage" | "extreme_imbalance";
  label: string;
  description: string;
}> = [
  { value: "slight_edge", label: "Slight edge", description: "Marginally ahead — close to fair." },
  { value: "clear_advantage", label: "Clear advantage", description: "Noticeably better deal for the winning side." },
  { value: "major_advantage", label: "Major advantage", description: "Strongly favors one side." },
  { value: "extreme_imbalance", label: "Extreme imbalance", description: "Lopsided. Worth a league-level look." },
];

// Read-only preview of one side's players + picks. Sits at the top of each
// team column in the modal; the clickable magnitude buttons live below it.
function ModalSidePreview({
  label,
  side,
  accent,
}: {
  label: string;
  side: Side;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div
        className={`mb-2 text-xs font-semibold uppercase tracking-wider ${accent}`}
      >
        {label}
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
    </div>
  );
}
