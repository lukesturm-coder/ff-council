"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Zap } from "lucide-react";
import type { FantasyPosition } from "@/lib/types";

export type DraftablePlayer = {
  player_id: number;
  name: string;
  team: string;
  position: FantasyPosition;
  fptsPPR: number;
  vbdPPR: number;
};

type Pick = {
  pickNumber: number;
  round: number;
  slotInRound: number;
  teamSlot: number; // 1..teamCount
  playerId: number;
};

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

const TEAM_COUNT = 12;
const ROUNDS = 8;
const TOTAL_PICKS = TEAM_COUNT * ROUNDS;

// Position needs for AI: how many at each position before bonus drops off
const TARGET_PER_POS: Record<FantasyPosition, number> = {
  QB: 2,
  RB: 4,
  WR: 5,
  TE: 2,
};

function pickToSlot(pickNumber: number): { round: number; slot: number } {
  const round = Math.ceil(pickNumber / TEAM_COUNT);
  const positionInRound = ((pickNumber - 1) % TEAM_COUNT) + 1;
  const slot = round % 2 === 1
    ? positionInRound
    : TEAM_COUNT - positionInRound + 1;
  return { round, slot };
}

function aiPick(
  available: DraftablePlayer[],
  teamRoster: DraftablePlayer[],
): DraftablePlayer | null {
  if (available.length === 0) return null;

  // Count current positions on this team
  const counts: Record<FantasyPosition, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
  };
  for (const p of teamRoster) counts[p.position]++;

  // Score: VBD + position-need bonus
  // Position need bonus: high when we have ZERO at position, lower as we fill up
  let best: DraftablePlayer | null = null;
  let bestScore = -Infinity;
  for (const p of available) {
    const have = counts[p.position];
    const target = TARGET_PER_POS[p.position];
    const need = Math.max(0, target - have);
    // Bonus per "need slot" — diminishing
    const needBonus = need * 12;
    const score = p.vbdPPR + needBonus;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export default function MockDraft({ players }: { players: DraftablePlayer[] }) {
  const [draftSlot, setDraftSlot] = useState<number | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [positionFilter, setPositionFilter] = useState<"ALL" | FantasyPosition>(
    "ALL",
  );

  const playerById = useMemo(() => {
    const m = new Map<number, DraftablePlayer>();
    for (const p of players) m.set(p.player_id, p);
    return m;
  }, [players]);

  const draftedIds = useMemo(
    () => new Set(picks.map((p) => p.playerId)),
    [picks],
  );

  const availablePlayers = useMemo(
    () =>
      players
        .filter((p) => !draftedIds.has(p.player_id))
        .filter((p) => positionFilter === "ALL" || p.position === positionFilter)
        .sort((a, b) => b.vbdPPR - a.vbdPPR),
    [players, draftedIds, positionFilter],
  );

  const nextPickNumber = picks.length + 1;
  const isDraftOver =
    nextPickNumber > TOTAL_PICKS ||
    nextPickNumber > players.length ||
    draftSlot == null;

  const nextSlot = !isDraftOver
    ? pickToSlot(nextPickNumber)
    : { round: ROUNDS + 1, slot: 0 };

  const isUserTurn = draftSlot != null && nextSlot.slot === draftSlot;

  // Auto-pick AI on its turn
  useEffect(() => {
    if (isDraftOver || isUserTurn || draftSlot == null) return;
    const teamRoster = picks
      .filter((p) => p.teamSlot === nextSlot.slot)
      .map((p) => playerById.get(p.playerId))
      .filter((p): p is DraftablePlayer => !!p);
    const available = players.filter((p) => !draftedIds.has(p.player_id));
    const chosen = aiPick(available, teamRoster);
    if (chosen) {
      // small delay so the user can follow along
      const timer = setTimeout(() => {
        setPicks((prev) => [
          ...prev,
          {
            pickNumber: nextPickNumber,
            round: nextSlot.round,
            slotInRound: nextSlot.slot,
            teamSlot: nextSlot.slot,
            playerId: chosen.player_id,
          },
        ]);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [
    picks,
    nextPickNumber,
    nextSlot.round,
    nextSlot.slot,
    isUserTurn,
    isDraftOver,
    draftSlot,
    players,
    playerById,
    draftedIds,
  ]);

  function makePick(playerId: number) {
    if (!isUserTurn || draftSlot == null) return;
    setPicks((prev) => [
      ...prev,
      {
        pickNumber: nextPickNumber,
        round: nextSlot.round,
        slotInRound: nextSlot.slot,
        teamSlot: draftSlot,
        playerId,
      },
    ]);
  }

  function autoPickForUser() {
    if (!isUserTurn) return;
    const teamRoster = picks
      .filter((p) => p.teamSlot === draftSlot)
      .map((p) => playerById.get(p.playerId))
      .filter((p): p is DraftablePlayer => !!p);
    const available = players.filter((p) => !draftedIds.has(p.player_id));
    const chosen = aiPick(available, teamRoster);
    if (chosen) makePick(chosen.player_id);
  }

  function resetDraft() {
    setPicks([]);
    setDraftSlot(null);
  }

  // Show draft slot selector if not chosen
  if (draftSlot == null) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8">
        <h3 className="mb-2 text-lg font-semibold">Pick your draft slot</h3>
        <p className="mb-4 text-sm text-zinc-400">
          12-team snake draft, {ROUNDS} rounds. Where are you picking?
        </p>
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).map((slot) => (
            <button
              key={slot}
              onClick={() => setDraftSlot(slot)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm font-mono text-zinc-200 transition hover:border-emerald-500/40 hover:bg-emerald-500/10"
            >
              #{slot}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Build per-team rosters
  const rostersBySlot = new Map<number, DraftablePlayer[]>();
  for (let slot = 1; slot <= TEAM_COUNT; slot++) {
    rostersBySlot.set(
      slot,
      picks
        .filter((p) => p.teamSlot === slot)
        .map((p) => playerById.get(p.playerId))
        .filter((p): p is DraftablePlayer => !!p),
    );
  }

  return (
    <div className="space-y-4">
      {/* Pick header */}
      <div className="flex flex-wrap items-baseline gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        {isDraftOver ? (
          <span className="text-sm font-semibold text-emerald-300">
            ✅ Draft complete — {picks.length} picks made
          </span>
        ) : (
          <>
            <span className="text-xs uppercase tracking-wider text-zinc-500">
              On the clock
            </span>
            <span className="font-mono text-lg font-semibold text-zinc-100">
              Pick {nextPickNumber} / {Math.min(TOTAL_PICKS, players.length)}
            </span>
            <span className="text-sm text-zinc-400">
              Round {nextSlot.round} · Slot {nextSlot.slot}
            </span>
            {isUserTurn ? (
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                YOUR PICK
              </span>
            ) : (
              <span className="text-xs text-zinc-500">
                Team {nextSlot.slot} thinking…
              </span>
            )}
          </>
        )}
        <button
          onClick={resetDraft}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Available players */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Available
            </h3>
            <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1">
              {(["ALL", "QB", "RB", "WR", "TE"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPositionFilter(p)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                    positionFilter === p
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {availablePlayers.slice(0, 50).map((p) => (
                  <tr
                    key={p.player_id}
                    className="border-t border-zinc-800/40 hover:bg-zinc-800/30"
                  >
                    <td className="py-1.5 pl-4 text-zinc-100">{p.name}</td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                      >
                        {p.position}
                      </span>
                    </td>
                    <td className="py-1.5 font-mono text-xs text-zinc-500">
                      {p.team}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs text-zinc-300">
                      {p.vbdPPR > 0 ? "+" : ""}
                      {p.vbdPPR.toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      <button
                        onClick={() => makePick(p.player_id)}
                        disabled={!isUserTurn}
                        className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isUserTurn && (
            <div className="border-t border-zinc-800 px-4 py-2 text-right">
              <button
                onClick={autoPickForUser}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
              >
                <Zap className="h-3 w-3" />
                Auto-pick best available
              </button>
            </div>
          )}
        </div>

        {/* My roster */}
        <div className="rounded-lg border border-emerald-500/30 bg-zinc-900">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
              Your roster (slot #{draftSlot})
            </h3>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(rostersBySlot.get(draftSlot) ?? []).map((p, idx) => (
                <tr
                  key={p.player_id}
                  className="border-t border-zinc-800/40"
                >
                  <td className="py-1.5 pl-4 font-mono text-xs text-zinc-500 w-8">
                    {idx + 1}
                  </td>
                  <td className="py-1.5 text-zinc-100">{p.name}</td>
                  <td className="py-1.5 pr-4 text-right">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                    >
                      {p.position}
                    </span>
                  </td>
                </tr>
              ))}
              {(rostersBySlot.get(draftSlot)?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-xs text-zinc-500">
                    No picks yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* All teams summary */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          All teams
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: TEAM_COUNT }, (_, i) => i + 1).map((slot) => {
            const r = rostersBySlot.get(slot) ?? [];
            return (
              <div
                key={slot}
                className={`rounded-md border bg-zinc-950 p-3 ${
                  slot === draftSlot
                    ? "border-emerald-500/40"
                    : "border-zinc-800"
                }`}
              >
                <p className="text-xs text-zinc-500">
                  Team {slot} {slot === draftSlot && "(you)"}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {r.length} picks
                  {r.length > 0 && (
                    <span className="ml-2 text-zinc-600">
                      {(() => {
                        const counts: Record<FantasyPosition, number> = {
                          QB: 0,
                          RB: 0,
                          WR: 0,
                          TE: 0,
                        };
                        for (const p of r) counts[p.position]++;
                        return `${counts.QB}QB·${counts.RB}RB·${counts.WR}WR·${counts.TE}TE`;
                      })()}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
