"use client";

import { Loader2 } from "lucide-react";

// The 5-option weighted sentiment selector that replaces the old 9-button
// grid. One tap = a full verdict (winner + magnitude), submitted immediately:
//
//   [ Strong A ] [ Lean A ] [ Even ] [ Lean B ] [ Strong B ]
//      -2          -1         0         +1          +2
//
// Maps onto the existing (winner, fairness_tier) data model:
//   Strong → clear_advantage (magnitude 2), Lean → slight_edge (1).
// Market framing only — no "fleece"/toxic language.

export type SentimentTier = "balanced" | "slight_edge" | "clear_advantage";

type Option = {
  key: string;
  winner: "A" | "B" | "EVEN";
  tier: SentimentTier;
  side: "A" | "B" | "even";
  strength: string; // "Strong" / "Lean" / ""
  team: string; // "Team A" / "Even" / "Team B"
};

const OPTIONS: Option[] = [
  { key: "strongA", winner: "A", tier: "clear_advantage", side: "A", strength: "Strong", team: "Team A" },
  { key: "leanA", winner: "A", tier: "slight_edge", side: "A", strength: "Lean", team: "Team A" },
  { key: "even", winner: "EVEN", tier: "balanced", side: "even", strength: "", team: "Even" },
  { key: "leanB", winner: "B", tier: "slight_edge", side: "B", strength: "Lean", team: "Team B" },
  { key: "strongB", winner: "B", tier: "clear_advantage", side: "B", strength: "Strong", team: "Team B" },
];

const SIDE_CLASS: Record<Option["side"], string> = {
  A: "border-rose-500/30 bg-rose-500/[0.06] text-rose-100 hover:border-rose-400/60 hover:bg-rose-500/15",
  B: "border-sky-500/30 bg-sky-500/[0.06] text-sky-100 hover:border-sky-400/60 hover:bg-sky-500/15",
  even:
    "border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:border-emerald-500/40 hover:bg-emerald-500/5",
};

export default function SentimentSelector({
  onVote,
  pending,
  picked,
}: {
  onVote: (winner: "A" | "B" | "EVEN", tier: SentimentTier) => void;
  pending: boolean;
  /** key of the option the user just tapped — pulses before advancing. */
  picked?: string | null;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
      {OPTIONS.map((o) => {
        const isPicked = picked === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={pending}
            onClick={() => onVote(o.winner, o.tier)}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-2 text-center transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
              isPicked
                ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/15 text-emerald-100"
                : SIDE_CLASS[o.side]
            }`}
          >
            {pending && isPicked ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {o.strength ? (
                  <span className="text-[9px] font-semibold uppercase tracking-wider opacity-70">
                    {o.strength}
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold uppercase tracking-wider opacity-0">
                    ·
                  </span>
                )}
                <span className="text-xs font-bold leading-tight sm:text-sm">
                  {o.side === "even" ? "Even" : o.side}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
