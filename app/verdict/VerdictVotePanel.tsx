"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import type { FantasyPosition } from "@/lib/types";
import { castVerdictVote } from "./actions";
import type { VerdictPlayer } from "./types";

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

// One-tap candidate voting. Click a player card → cast vote → "Thanks!"
// state. Used both in the list-page modal and the detail page.
export default function VerdictVotePanel({
  scenarioId,
  candidates,
  voteCounts,
  totalVotes,
  myPickPlayerId,
  onVoted,
}: {
  scenarioId: string;
  candidates: VerdictPlayer[];
  voteCounts: Record<number, number>;
  totalVotes: number;
  myPickPlayerId: number | null;
  onVoted?: (pickPlayerId: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<number | null>(myPickPlayerId);
  const [msg, setMsg] = useState<string | null>(null);

  function vote(playerId: number) {
    if (pending) return;
    setMsg(null);
    setSelectedId(playerId);
    startTransition(async () => {
      const res = await castVerdictVote({
        scenarioId,
        pickPlayerId: playerId,
      });
      if (res.ok) {
        setMsg(myPickPlayerId ? "Vote updated." : "Vote recorded.");
        onVoted?.(playerId);
      } else {
        setMsg(`Error: ${res.error}`);
        setSelectedId(myPickPlayerId);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Your verdict
      </h3>
      <p className="text-xs text-zinc-500">
        Tap the player you would take — one tap is your vote.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {candidates.map((c) => {
          const count = voteCounts[c.player_id] ?? 0;
          const pct =
            totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isMyPick = selectedId === c.player_id;
          return (
            <button
              key={c.player_id}
              type="button"
              disabled={pending}
              onClick={() => vote(c.player_id)}
              className={`relative overflow-hidden rounded-md border px-3 py-3 text-left transition disabled:cursor-not-allowed ${
                isMyPick
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
              }`}
            >
              {/* Bar showing this candidate's share of votes */}
              {totalVotes > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 ${
                    isMyPick ? "bg-emerald-500/15" : "bg-zinc-700/30"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              )}
              <div className="relative flex items-center gap-2">
                <span
                  className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[c.position]}`}
                >
                  {c.position}
                </span>
                <span className="flex-1 truncate font-medium text-zinc-100">
                  {c.name}
                </span>
                <span className="font-mono text-xs text-zinc-500">
                  {c.team}
                </span>
                <span className="ml-1 shrink-0 font-mono text-xs text-zinc-400 tabular-nums">
                  {count > 0 ? `${pct}%` : "—"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {msg && (
        <p
          className={`flex items-center gap-1.5 text-xs ${
            msg.startsWith("Error") ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {!msg.startsWith("Error") && <Check className="h-3.5 w-3.5" />}
          {msg}
        </p>
      )}
    </div>
  );
}
