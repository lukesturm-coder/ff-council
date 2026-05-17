"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { castVote, type VoteInput } from "./actions";

type FairnessTier = VoteInput["fairnessTier"];
type Winner = VoteInput["winner"];

// Non-balanced tiers only — "Balanced" is derived when winner = Even.
const MAGNITUDE_TIERS: {
  value: Exclude<FairnessTier, "balanced">;
  label: string;
  description: string;
}[] = [
  {
    value: "slight_edge",
    label: "Slight Edge",
    description: "Marginally ahead — close to fair.",
  },
  {
    value: "clear_advantage",
    label: "Clear Advantage",
    description: "Noticeably better deal for the winning side.",
  },
  {
    value: "major_advantage",
    label: "Major Advantage",
    description: "Strongly favors one side — most would reject the worse end.",
  },
  {
    value: "extreme_imbalance",
    label: "Extreme Imbalance",
    description: "Lopsided. Worth a league-level look.",
  },
];

export default function VotingPanel({
  tradeId,
  winner: controlledWinner,
  onWinnerChange,
  myVote,
  onVoted,
}: {
  tradeId: string;
  // Controlled mode: parent owns the winner. If undefined, VotingPanel
  // manages winner internally (initialised from myVote).
  winner?: Winner | null;
  onWinnerChange?: (w: Winner | null) => void;
  myVote: {
    winner: "A" | "B" | "EVEN";
    fairness_tier: string;
    fairness_lean: string | null;
  } | null;
  onVoted?: () => void;
}) {
  const [internalWinner, setInternalWinner] = useState<Winner | null>(
    (myVote?.winner as Winner) ?? null,
  );
  const isControlled = controlledWinner !== undefined;
  const winner = isControlled ? controlledWinner : internalWinner;

  // Only relevant when winner != Even
  const [magnitude, setMagnitude] = useState<
    Exclude<FairnessTier, "balanced"> | null
  >(
    myVote?.fairness_tier && myVote.fairness_tier !== "balanced"
      ? (myVote.fairness_tier as Exclude<FairnessTier, "balanced">)
      : null,
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function pickWinner(w: Winner) {
    if (isControlled) onWinnerChange?.(w);
    else setInternalWinner(w);
    if (w === "EVEN") setMagnitude(null); // forced balanced
    setMsg(null);
  }

  const canSubmit =
    winner === "EVEN" || (winner !== null && magnitude !== null);

  function submit() {
    if (!canSubmit || !winner) return;
    setMsg(null);
    startTransition(async () => {
      const res = await castVote({
        tradeId,
        winner,
        fairnessTier: winner === "EVEN" ? "balanced" : magnitude!,
        fairnessLean:
          winner === "EVEN" ? null : (winner as "A" | "B"),
      });
      if (res.ok) {
        setMsg(myVote ? "Vote updated." : "Vote recorded.");
        onVoted?.();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  return (
    <div className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Your verdict
      </h3>

      {/* Step 1: Who won */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
          Who won?
        </p>
        <div className="grid grid-cols-3 gap-2">
          <VoteOption
            active={winner === "A"}
            onClick={() => pickWinner("A")}
            color="rose"
            label="Team A"
          />
          <VoteOption
            active={winner === "EVEN"}
            onClick={() => pickWinner("EVEN")}
            color="zinc"
            label="Even"
          />
          <VoteOption
            active={winner === "B"}
            onClick={() => pickWinner("B")}
            color="sky"
            label="Team B"
          />
        </div>
      </div>

      {/* Step 2: How big a margin? — only when there IS a winner */}
      {winner && winner !== "EVEN" && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
            By how much?
          </p>
          <div className="space-y-1.5">
            {MAGNITUDE_TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setMagnitude(t.value)}
                className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                  magnitude === t.value
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                <span
                  className={`block sm:inline ${
                    magnitude === t.value
                      ? "text-emerald-200"
                      : "text-zinc-200"
                  }`}
                >
                  {t.label}
                </span>
                <span className="block text-xs text-zinc-500 sm:ml-2 sm:inline">
                  {t.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {winner === "EVEN" && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
          Recorded as <span className="text-zinc-200">Balanced</span> — both
          sides walk away fairly.
        </div>
      )}

      {/* Submit */}
      <div className="flex flex-col items-stretch gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-end">
        {msg && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              msg.startsWith("Error") ? "text-rose-300" : "text-emerald-300"
            }`}
          >
            {!msg.startsWith("Error") && <Check className="h-3.5 w-3.5" />}
            {msg}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || pending}
          className="rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : myVote ? "Update vote" : "Cast vote"}
        </button>
      </div>
    </div>
  );
}

function VoteOption({
  active,
  onClick,
  color,
  label,
}: {
  active: boolean;
  onClick: () => void;
  color: "rose" | "sky" | "zinc";
  label: string;
}) {
  const activeColors: Record<typeof color, string> = {
    rose: "border-rose-500/50 bg-rose-500/10 text-rose-200",
    sky: "border-sky-500/50 bg-sky-500/10 text-sky-200",
    zinc: "border-zinc-500/50 bg-zinc-500/10 text-zinc-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
        active
          ? activeColors[color]
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
      }`}
    >
      {label}
    </button>
  );
}
