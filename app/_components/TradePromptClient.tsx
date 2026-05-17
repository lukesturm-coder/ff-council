"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import VotingPanel from "@/app/trades/[id]/VotingPanel";

const DISMISS_KEY = "ffc-trade-prompt-dismissed-until";
const VOTED_KEY = "ffc-trade-prompt-voted-trades";

type SidePlayer = { name: string; team: string; position: string };
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

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

function SidePanel({
  label,
  side,
  accent,
}: {
  label: string;
  side: Side;
  accent: string;
}) {
  return (
    <div className="flex-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
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
            <span className="font-mono text-xs text-zinc-500">{p.team}</span>
          </div>
        ))}
        {side.picks.map((p, idx) => (
          <div key={`pk-${idx}`} className="text-xs text-zinc-400">
            🏈 {pickLabel(p)}
          </div>
        ))}
        {side.players.length + side.picks.length === 0 && (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </div>
    </div>
  );
}

export default function TradePromptClient({
  tradeId,
  sideA,
  sideB,
  scoring,
  leagueType,
}: {
  tradeId: string | null;
  sideA: Side | null;
  sideB: Side | null;
  scoring: string;
  leagueType: string;
}) {
  const [open, setOpen] = useState(false);
  const [voted, setVoted] = useState(false);

  // Decide whether to open on mount (client-only so SSR can render without
  // flicker, then the modal pops in once we read localStorage).
  useEffect(() => {
    if (!tradeId) return;
    const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) ?? "0");
    if (Date.now() < dismissedUntil) return;

    try {
      const votedList: string[] = JSON.parse(
        localStorage.getItem(VOTED_KEY) ?? "[]",
      );
      if (votedList.includes(tradeId)) return;
    } catch {
      // ignore bad JSON
    }
    // Small delay so the page paints first; KTC does this too — feels less
    // like an aggressive pop-up if the user gets a glimpse of the content.
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [tradeId]);

  // Lock scroll on the underlying page while the modal is open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  function dismiss() {
    localStorage.setItem(
      DISMISS_KEY,
      String(Date.now() + 24 * 60 * 60 * 1000),
    );
    setOpen(false);
  }

  function markVoted() {
    if (!tradeId) return;
    try {
      const votedList: string[] = JSON.parse(
        localStorage.getItem(VOTED_KEY) ?? "[]",
      );
      if (!votedList.includes(tradeId)) {
        votedList.push(tradeId);
        const trimmed = votedList.slice(-50);
        localStorage.setItem(VOTED_KEY, JSON.stringify(trimmed));
      }
    } catch {
      // ignore
    }
    setVoted(true);
    setTimeout(() => setOpen(false), 3500);
  }

  if (!open || !tradeId || !sideA || !sideB) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700/60 bg-zinc-900 p-6 shadow-2xl shadow-emerald-900/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={dismiss}
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
            <div className="mb-4 text-center">
              <h3 className="text-2xl font-bold text-zinc-100">Your verdict?</h3>
              <p className="mt-1 text-sm text-zinc-400">
                FF Council&apos;s trade rulings are crowdsourced from drafters
                like you.
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {leagueType} · {scoring}
              </p>
            </div>

            <div className="mb-5 flex flex-col gap-3 sm:flex-row">
              <SidePanel label="Team A" side={sideA} accent="text-rose-300" />
              <div className="flex items-center justify-center text-xs uppercase tracking-wider text-zinc-600">
                for
              </div>
              <SidePanel label="Team B" side={sideB} accent="text-sky-300" />
            </div>

            <VotingPanel tradeId={tradeId} myVote={null} onVoted={markVoted} />

            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500">
              <button
                type="button"
                onClick={dismiss}
                className="underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                Maybe later
              </button>
              <Link
                href={`/trades/${tradeId}`}
                className="underline-offset-4 hover:text-zinc-300 hover:underline"
                onClick={() => setOpen(false)}
              >
                See full trade →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
