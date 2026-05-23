"use client";

import { useMemo, useState, useTransition } from "react";
import { Check } from "lucide-react";
import type { CourtCase, CourtPlayer } from "@/lib/court";
import { submitCourtPick } from "./actions";

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function PlayerButton({
  player,
  selected,
  disabled,
  onClick,
}: {
  player: CourtPlayer;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[60px] flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-emerald-400/70 bg-emerald-500/10 ring-1 ring-emerald-400/40"
          : "border-zinc-800 bg-zinc-950/60 hover:border-emerald-500/40 hover:bg-emerald-500/5"
      }`}
    >
      <span
        className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
          POSITION_STYLES[player.position] ??
          "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
        }`}
      >
        {player.position}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-100">
          {player.name}
        </span>
        <span className="font-mono text-[11px] text-zinc-500">
          {player.team}
        </span>
      </span>
      {selected && (
        <Check className="h-4 w-4 shrink-0 text-emerald-300" strokeWidth={3} />
      )}
    </button>
  );
}

export default function CourtPicker({
  cases,
  initialPicks,
}: {
  cases: CourtCase[];
  initialPicks: Record<string, number>;
}) {
  const [picks, setPicks] = useState<Record<string, number>>(initialPicks);
  const [savingCase, setSavingCase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const made = useMemo(() => Object.keys(picks).length, [picks]);

  function choose(caseId: string, playerId: number) {
    if (savingCase) return;
    const prev = picks[caseId];
    if (prev === playerId) return;
    setError(null);
    setPicks((p) => ({ ...p, [caseId]: playerId }));
    setSavingCase(caseId);
    startTransition(async () => {
      const res = await submitCourtPick({ caseId, pickPlayerId: playerId });
      setSavingCase(null);
      if (!res.ok) {
        // Revert the optimistic change.
        setPicks((p) => {
          const next = { ...p };
          if (prev == null) delete next[caseId];
          else next[caseId] = prev;
          return next;
        });
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-[3.25rem] z-10 -mx-1 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 backdrop-blur">
        <span className="text-xs text-zinc-400">
          <span className="font-mono font-semibold text-emerald-300">
            {made}
          </span>
          {" / "}
          {cases.length} locked in
        </span>
        {error && <span className="text-xs text-rose-300">{error}</span>}
        {!error && made === cases.length && (
          <span className="text-xs font-medium text-emerald-300">
            All set — good luck.
          </span>
        )}
      </div>

      {cases.map((c) => {
        const picked = picks[c.id];
        return (
          <div
            key={c.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-3"
          >
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
              <span className="font-mono">Case {c.order_index}</span>
              <span className="text-zinc-700">·</span>
              <span>Who scores more?</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <PlayerButton
                player={c.player_a}
                selected={picked === c.player_a.player_id}
                disabled={savingCase === c.id}
                onClick={() => choose(c.id, c.player_a.player_id)}
              />
              <div className="flex items-center justify-center text-xs font-semibold uppercase tracking-wider text-zinc-600">
                vs
              </div>
              <PlayerButton
                player={c.player_b}
                selected={picked === c.player_b.player_id}
                disabled={savingCase === c.id}
                onClick={() => choose(c.id, c.player_b.player_id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
