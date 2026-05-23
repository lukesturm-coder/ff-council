"use client";

import { useState, useTransition } from "react";
import { castVote, type TradeConsensus } from "./actions";
import SentimentSelector, {
  type SentimentTier,
} from "@/app/trades/_components/SentimentSelector";
import TradeConsensusReveal from "@/app/trades/_components/TradeConsensusReveal";

// Full-page trade verdict — the same 5-option one-tap layout used in the
// /judge feed and the browse modal (replaces the old multi-step VotingPanel).
// Vote → see the market reveal in place. Already-voted users land straight on
// the reveal with a "change pick" path back to the selector.

type MyVote = {
  winner: "A" | "B" | "EVEN";
  fairness_tier: string;
  fairness_lean: string | null;
} | null;

function optionKey(winner: "A" | "B" | "EVEN", tier: SentimentTier): string {
  if (winner === "EVEN") return "even";
  const strong = tier !== "slight_edge";
  if (winner === "A") return strong ? "strongA" : "leanA";
  return strong ? "strongB" : "leanB";
}

function keyFromMyVote(v: NonNullable<MyVote>): string {
  const tier: SentimentTier =
    v.winner === "EVEN"
      ? "balanced"
      : v.fairness_tier === "slight_edge"
        ? "slight_edge"
        : "clear_advantage";
  return optionKey(v.winner, tier);
}

export default function TradeVotePanel({
  tradeId,
  myVote,
  initialConsensus,
}: {
  tradeId: string;
  myVote: MyVote;
  initialConsensus: TradeConsensus;
}) {
  const [mode, setMode] = useState<"vote" | "result">(
    myVote ? "result" : "vote",
  );
  const [consensus, setConsensus] = useState<TradeConsensus>(initialConsensus);
  const [myWinner, setMyWinner] = useState<"A" | "B" | "EVEN" | null>(
    myVote?.winner ?? null,
  );
  const [pickedKey, setPickedKey] = useState<string | null>(
    myVote ? keyFromMyVote(myVote) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(winner: "A" | "B" | "EVEN", tier: SentimentTier) {
    if (pending) return;
    setError(null);
    setPickedKey(optionKey(winner, tier));
    startTransition(async () => {
      const res = await castVote({
        tradeId,
        winner,
        fairnessTier: tier,
        fairnessLean: winner === "EVEN" ? null : winner,
      });
      if (res.ok) {
        setConsensus(res.consensus);
        setMyWinner(winner);
        setMode("result");
      } else {
        setError(res.error);
      }
    });
  }

  if (mode === "result" && myWinner) {
    return (
      <div className="space-y-3">
        <TradeConsensusReveal
          tradeId={tradeId}
          consensus={consensus}
          myWinner={myWinner}
        />
        <button
          type="button"
          onClick={() => setMode("vote")}
          className="text-xs text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
        >
          Change my pick
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Your verdict
      </h3>
      <p className="mb-3 text-xs text-zinc-500">
        Who got the better end? One tap.
      </p>
      <SentimentSelector onVote={submit} pending={pending} picked={pickedKey} />
      {error && (
        <p className="mt-3 text-center text-xs text-rose-300">Error: {error}</p>
      )}
    </div>
  );
}
