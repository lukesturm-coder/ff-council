"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Scale, X } from "lucide-react";
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

  // Verdict banner — the loudest signal on the card. Sits at the top so
  // scanning a long list reads as a sequence of outcomes, not a wall of
  // player names. Color tracks the winning side (rose/sky/zinc), or
  // emerald when nobody's voted yet.
  const bannerClass =
    total === 0
      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
      : winner === "A"
        ? "bg-rose-500/15 text-rose-100 ring-rose-500/40"
        : winner === "B"
          ? "bg-sky-500/15 text-sky-100 ring-sky-500/40"
          : "bg-zinc-700/30 text-zinc-100 ring-zinc-500/40";
  const bannerLabel =
    total === 0
      ? "Cast the first vote →"
      : winner === "A"
        ? "Team A wins"
        : winner === "B"
          ? "Team B wins"
          : "Council called it even";

  return (
    <button
      type="button"
      onClick={() => onOpen(trade)}
      className="block w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60"
    >
      {/* Verdict banner */}
      <div
        className={`flex items-baseline justify-between gap-3 px-3 py-2 ring-1 ring-inset ${bannerClass} sm:px-4`}
      >
        <span className="text-sm font-semibold sm:text-base">{bannerLabel}</span>
        {total > 0 && (
          <span className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-xl font-bold leading-none sm:text-2xl">
              {winnerPct}%
            </span>
            <span className="text-xs text-zinc-400">
              {total} vote{total === 1 ? "" : "s"}
            </span>
          </span>
        )}
      </div>

      {/* Trade body */}
      <div className="p-3 sm:p-4">
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
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>{trade.league_type}</span>
          <span>·</span>
          <span>{trade.scoring}</span>
          <span>·</span>
          <span>{trade.team_count} teams</span>
          <span>·</span>
          <span>{new Date(trade.created_at).toLocaleDateString()}</span>
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

            {/* THE TRADE — the headline. Big, scannable, anchored at the
                top of the modal so the user sees what's being voted on
                before they see the voting columns. Faint team-color washes
                tie each side back to its column below. */}
            <div className="mb-4 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <TradeHeadlineSide
                label="Team A"
                side={trade.side_a}
                accent="rose"
              />
              <div className="flex items-center justify-center text-2xl text-zinc-600 sm:text-3xl">
                ↔
              </div>
              <TradeHeadlineSide
                label="Team B"
                side={trade.side_b}
                accent="sky"
              />
            </div>

            <p className="mb-3 text-xs text-zinc-500">
              One tap on a magnitude under either team — your full verdict in
              a single click.
            </p>

            {/* 3-column one-click grid:
                  [ Team A label + 4 magnitudes ] [ Even ] [ Team B label + 4 magnitudes ]
                Each magnitude submits (winner, tier) directly. Stacks on
                mobile. Columns get a faint team-color wash at rest so
                identity reads before tap. */}
            <div className="mb-3 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
              {/* Team A column */}
              <div className="flex flex-col gap-2 rounded-xl bg-rose-500/[0.03] p-2 ring-1 ring-inset ring-rose-500/10">
                <div className="px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-rose-300">
                  Team A wins by…
                </div>
                {MAGNITUDE_TIERS.map((t) => (
                  <MagnitudeButton
                    key={`A-${t.value}`}
                    tier={t}
                    team="A"
                    disabled={pending}
                    onClick={() => submitVote("A", t.value)}
                  />
                ))}
              </div>

              {/* Even column — quiet fulcrum between the towers */}
              <div className="flex items-center sm:min-w-[112px]">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submitVote("EVEN", "balanced")}
                  className="group flex w-full min-h-[68px] sm:min-h-0 sm:w-28 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-4 text-sm font-semibold text-zinc-200 transition hover:scale-[1.02] hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="flex flex-col items-center gap-1">
                      <Scale
                        className="h-4 w-4 text-zinc-500 transition group-hover:text-emerald-300"
                        strokeWidth={2}
                      />
                      <span>Even</span>
                      <span className="text-[10px] font-normal text-zinc-500">
                        Balanced
                      </span>
                    </span>
                  )}
                </button>
              </div>

              {/* Team B column */}
              <div className="flex flex-col gap-2 rounded-xl bg-sky-500/[0.03] p-2 ring-1 ring-inset ring-sky-500/10">
                <div className="px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                  Team B wins by…
                </div>
                {MAGNITUDE_TIERS.map((t) => (
                  <MagnitudeButton
                    key={`B-${t.value}`}
                    tier={t}
                    team="B"
                    disabled={pending}
                    onClick={() => submitVote("B", t.value)}
                  />
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
  { value: "extreme_imbalance", label: "Extreme imbalance", description: "Commissioner is corrupt." },
];

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

// One magnitude button. All four tiers (slight / clear / major / extreme)
// render at the SAME shade so visual weight doesn't bias the click —
// the user's choice should be driven by the label text, not by which
// button looks loudest. Team color (rose for A, sky for B) is the only
// hue applied, and equally across all four.
function MagnitudeButton({
  tier,
  team,
  disabled,
  onClick,
}: {
  tier: { value: string; label: string; description: string };
  team: "A" | "B";
  disabled: boolean;
  onClick: () => void;
}) {
  const restClasses =
    team === "A"
      ? "border-rose-500/25 bg-rose-500/[0.06] hover:border-rose-400/60 hover:bg-rose-500/15"
      : "border-sky-500/25 bg-sky-500/[0.06] hover:border-sky-400/60 hover:bg-sky-500/15";
  const labelColor =
    team === "A" ? "text-rose-100" : "text-sky-100";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group/btn relative min-h-[56px] rounded-lg border p-2.5 text-left shadow-sm transition-all duration-150 hover:scale-[1.015] hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${restClasses}`}
    >
      <div className={`text-sm font-semibold ${labelColor}`}>{tier.label}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400 group-hover/btn:text-zinc-300">
        {tier.description}
      </div>
    </button>
  );
}
