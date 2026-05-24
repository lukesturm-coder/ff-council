"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { castVote, type TradeConsensus } from "./[id]/actions";
import { verdictFromCounts, type FairnessTier } from "@/lib/trade-verdict";
import SentimentSelector from "./_components/SentimentSelector";
import TradeConsensusReveal from "./_components/TradeConsensusReveal";

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
  // Optional per-side fairness-tier breakdown. Present when the list query
  // selects fairness_tier (Judge docket does); lets the card show true
  // severity. When absent the card falls back to direction + winnerPct.
  tiers_a?: Partial<Record<FairnessTier, number>>;
  tiers_b?: Partial<Record<FairnessTier, number>>;
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

// Market-style sentiment phrasing (replaces the old "Slight Edge / Clear
// Advantage" legalese). Driven by which side leads + how lopsided the lean is.
function sentimentLabel(leader: "A" | "B" | "EVEN", zone: string): string {
  if (leader === "EVEN") return "Dead even";
  const team = leader === "A" ? "Team A" : "Team B";
  if (zone === "slight") return `Council leaning ${team}`;
  if (zone === "clear") return `Strong ${team} sentiment`;
  return `${team} landslide`; // major / fleece
}

// 3-segment live sentiment bar: Team A (rose) · Even (zinc) · Team B (sky).
function SentimentSplitBar({
  aPct,
  evenPct,
  bPct,
}: {
  aPct: number;
  evenPct: number;
  bPct: number;
}) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className="h-full bg-rose-500/80" style={{ width: `${aPct}%` }} />
      <div className="h-full bg-zinc-600/70" style={{ width: `${evenPct}%` }} />
      <div className="h-full bg-sky-500/80" style={{ width: `${bPct}%` }} />
    </div>
  );
}

export function TradeListCardButton({
  trade,
  onOpen,
  voted = true,
}: {
  trade: TradeCardData;
  onOpen: (t: TradeCardData) => void;
  // Until the user has voted on this trade, we hide the council's call so the
  // result can't anchor their vote. Defaults to true for non-gated callers.
  voted?: boolean;
}) {
  const total = trade.summary?.total_votes ?? 0;

  // Signed direction + severity verdict for the banner. Uses per-side tier
  // counts when the list query provides them (Judge docket), otherwise the
  // counts-based builder degrades to direction-only severity.
  const verdict = verdictFromCounts({
    votes_a: trade.summary?.votes_a ?? 0,
    votes_b: trade.summary?.votes_b ?? 0,
    votes_even: trade.summary?.votes_even ?? 0,
    tiers_a: trade.summary?.tiers_a,
    tiers_b: trade.summary?.tiers_b,
  });

  // Only reveal the verdict once the user has voted. The vote COUNT still shows
  // (social proof, not a result that biases the pick).
  const showResult = voted && total > 0;
  type Winner = "A" | "B" | "EVEN" | null;
  const winner: Winner = showResult ? verdict.leader : null;

  const a = trade.summary?.votes_a ?? 0;
  const b = trade.summary?.votes_b ?? 0;
  const aPct = total > 0 ? Math.round((a / total) * 100) : 0;
  const bPct = total > 0 ? Math.round((b / total) * 100) : 0;
  const evenPct = total > 0 ? 100 - aPct - bPct : 0;
  // Controversy = how evenly A and B split (1 = dead heat). A 52/48 lights up;
  // a 90/10 doesn't. Needs enough volume to be meaningful.
  const decisive = a + b;
  const controversy = decisive > 0 ? 1 - Math.abs(a - b) / decisive : 0;
  const divided = showResult && total >= 5 && controversy >= 0.8;

  const bannerClass = !showResult
    ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
    : divided
      ? "bg-amber-500/15 text-amber-100 ring-amber-500/40"
      : winner === "A"
        ? "bg-rose-500/15 text-rose-100 ring-rose-500/40"
        : winner === "B"
          ? "bg-sky-500/15 text-sky-100 ring-sky-500/40"
          : "bg-zinc-700/30 text-zinc-100 ring-zinc-500/40";
  const bannerLabel = !showResult
    ? total === 0
      ? "Cast the first vote →"
      : "Tap to weigh in →"
    : divided
      ? "Highly divided"
      : sentimentLabel(verdict.leader, verdict.zone);

  return (
    <button
      type="button"
      onClick={() => onOpen(trade)}
      className="block w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60"
    >
      {/* Sentiment banner — market-style read of where the council leans, with
          a controversy flag when the split is a dead heat. */}
      <div
        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ring-1 ring-inset ${bannerClass} sm:px-4`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {divided && (
            <span className="shrink-0 rounded bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
              Hot debate
            </span>
          )}
          <span className="truncate text-sm font-semibold sm:text-base">
            {bannerLabel}
          </span>
          {showResult && winner !== "EVEN" && (
            <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-300/80">
              {winner === "A" ? aPct : bPct}%
            </span>
          )}
        </span>
        {total > 0 && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">
            {total} vote{total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Live sentiment split — only after voting (pre-vote stays hidden so it
          can't anchor the pick). */}
      {showResult && (
        <div className="px-3.5 pt-3 sm:px-4">
          <SentimentSplitBar aPct={aPct} evenPct={evenPct} bPct={bPct} />
        </div>
      )}

      {/* Trade body */}
      <div className="p-3.5 sm:p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3">
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
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600">
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300/90">
            Trade
          </span>
          <span>
            {trade.team_count}T · {trade.scoring}
          </span>
        </div>
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

export function TradeModal({
  trade,
  position,
  total,
  onClose,
  onNext,
  onVoted,
}: {
  trade: TradeCardData;
  position: number;
  total: number;
  onClose: () => void;
  onNext: (() => void) | null;
  /** Fires once on a successful vote so the list can reveal this card. */
  onVoted?: () => void;
}) {
  const [reveal, setReveal] = useState<{
    consensus: TradeConsensus;
    winner: "A" | "B" | "EVEN";
  } | null>(null);
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
      if (res.ok) {
        setReveal({ consensus: res.consensus, winner });
        onVoted?.();
      } else setError(res.error);
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

        <div className="mb-4 pr-8">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
              {reveal ? "Council verdict" : "Your verdict?"}
            </h3>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {position} / {total}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {trade.league_type} · {trade.scoring}
          </p>
        </div>

        {/* THE TRADE — always anchored at the top so the voter sees what's
            being judged, before (selector) and after (reveal) voting. */}
        <div className="mb-4 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <TradeHeadlineSide label="Team A" side={trade.side_a} accent="rose" />
          <div className="flex items-center justify-center text-2xl text-zinc-600 sm:text-3xl">
            ↔
          </div>
          <TradeHeadlineSide label="Team B" side={trade.side_b} accent="sky" />
        </div>

        {reveal ? (
          <div className="space-y-4">
            <TradeConsensusReveal
              tradeId={trade.id}
              consensus={reveal.consensus}
              myWinner={reveal.winner}
            />
            {onNext ? (
              <button
                type="button"
                onClick={onNext}
                className="w-full rounded-md bg-emerald-500/20 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
              >
                Next trade →
              </button>
            ) : (
              <p className="text-center text-xs text-zinc-500">
                Caught up — that was the last one.
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mb-2 text-center text-xs text-zinc-500">
              Who got the better end? One tap.
            </p>
            <SentimentSelector onVote={submitVote} pending={pending} />

            {error && (
              <p className="mt-3 text-xs text-rose-300">Error: {error}</p>
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

// Read-only preview of one side's players + picks. Sits at the top of each
// team column in the modal as a "quiet header" — borderless, just a divider
// under the label — so the tactile magnitude buttons below feel like the
// primary affordance.
// Prominent player + pick display for each side at the top of the modal.
// This is the actual trade — readable at a glance — so the voter sees
// WHAT they're judging before they see the voting columns.
function TradeHeadlineSide({
  label,
  side,
  accent,
}: {
  label: string;
  side: Side;
  accent: "rose" | "sky";
}) {
  const tints =
    accent === "rose"
      ? "bg-rose-500/[0.06] ring-rose-500/30"
      : "bg-sky-500/[0.06] ring-sky-500/30";
  const labelColor =
    accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div
      className={`rounded-lg p-3 ring-1 ring-inset ${tints}`}
    >
      <div
        className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${labelColor}`}
      >
        {label}
      </div>
      <div className="space-y-1.5">
        {side.players.map((p, idx) => (
          <div
            key={`p-${idx}`}
            className="flex items-center gap-2 text-base font-medium"
          >
            <span
              className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                POSITION_STYLES[p.position] ??
                "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
              }`}
            >
              {p.position}
            </span>
            <span className="text-zinc-100">{p.name}</span>
            <span className="ml-auto font-mono text-[11px] text-zinc-500">
              {p.team}
            </span>
          </div>
        ))}
        {side.picks.map((p, idx) => (
          <div
            key={`pk-${idx}`}
            className="flex items-center gap-2 text-sm text-zinc-300"
          >
            <span className="inline-flex shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
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

