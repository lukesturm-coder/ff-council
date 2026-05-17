"use client";

import { useMemo, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import type { FantasyPosition } from "@/lib/types";
import { submitTrade } from "./actions";

export type PickablePlayer = {
  player_id: number;
  name: string;
  team: string;
  position: FantasyPosition;
  vegasFptsPPR: number;
};

type Pick = { year: number; round: number; slot: number | null };

const LEAGUE_TYPES = [
  { value: "redraft", label: "Redraft" },
  { value: "dynasty", label: "Dynasty" },
  { value: "keeper", label: "Keeper" },
] as const;

const SCORING_OPTIONS = [
  { value: "PPR", label: "PPR" },
  { value: "Half", label: "Half PPR" },
  { value: "Standard", label: "Standard" },
  { value: "Superflex", label: "Superflex" },
  { value: "TEPremium", label: "TE Premium" },
] as const;

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

export default function TradeSubmissionForm({
  players,
  prefillA,
  prefillB,
}: {
  players: PickablePlayer[];
  prefillA: number[];
  prefillB: number[];
}) {
  const [sideAPlayers, setSideAPlayers] = useState<number[]>(prefillA);
  const [sideBPlayers, setSideBPlayers] = useState<number[]>(prefillB);
  const [sideAPicks, setSideAPicks] = useState<Pick[]>([]);
  const [sideBPicks, setSideBPicks] = useState<Pick[]>([]);

  const playerById = useMemo(() => {
    const m = new Map<number, PickablePlayer>();
    for (const p of players) m.set(p.player_id, p);
    return m;
  }, [players]);

  // Serialize for the hidden inputs that the server action reads
  const sideA = useMemo(
    () => ({
      players: sideAPlayers
        .map((id) => playerById.get(id))
        .filter((p): p is PickablePlayer => !!p)
        .map((p) => ({
          player_id: p.player_id,
          name: p.name,
          team: p.team,
          position: p.position,
        })),
      picks: sideAPicks,
    }),
    [sideAPlayers, sideAPicks, playerById],
  );
  const sideB = useMemo(
    () => ({
      players: sideBPlayers
        .map((id) => playerById.get(id))
        .filter((p): p is PickablePlayer => !!p)
        .map((p) => ({
          player_id: p.player_id,
          name: p.name,
          team: p.team,
          position: p.position,
        })),
      picks: sideBPicks,
    }),
    [sideBPlayers, sideBPicks, playerById],
  );

  return (
    <form action={submitTrade} className="space-y-6">
      {/* League context */}
      <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <legend className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          League context
        </legend>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-500">
              League type
            </label>
            <RadioGroup
              name="league_type"
              defaultValue="redraft"
              options={LEAGUE_TYPES}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-500">
              Scoring
            </label>
            <RadioGroup
              name="scoring"
              defaultValue="PPR"
              options={SCORING_OPTIONS}
            />
          </div>
          <div>
            <label
              htmlFor="team_count"
              className="block text-xs uppercase tracking-wider text-zinc-500"
            >
              Team count
            </label>
            <input
              id="team_count"
              name="team_count"
              type="number"
              defaultValue={12}
              min={4}
              max={32}
              className="mt-1 w-24 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label
              htmlFor="context_note"
              className="block text-xs uppercase tracking-wider text-zinc-500"
            >
              Context (optional)
            </label>
            <input
              id="context_note"
              name="context_note"
              type="text"
              placeholder="e.g. I'm a contender, rebuilding, etc."
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
        </div>
      </fieldset>

      {/* The two sides */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TradeSidePicker
          label="Team A receives"
          selectedPlayers={sideAPlayers}
          setSelectedPlayers={setSideAPlayers}
          picks={sideAPicks}
          setPicks={setSideAPicks}
          allPlayers={players}
          excludeIds={[...sideAPlayers, ...sideBPlayers]}
        />
        <TradeSidePicker
          label="Team B receives"
          selectedPlayers={sideBPlayers}
          setSelectedPlayers={setSideBPlayers}
          picks={sideBPicks}
          setPicks={setSideBPicks}
          allPlayers={players}
          excludeIds={[...sideAPlayers, ...sideBPlayers]}
        />
      </div>

      {/* Optional league note */}
      <div>
        <label
          htmlFor="league_note"
          className="block text-xs uppercase tracking-wider text-zinc-500"
        >
          League notes (optional)
        </label>
        <textarea
          id="league_note"
          name="league_note"
          rows={2}
          placeholder="Anything else the council should know?"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      {/* Hidden serialized payloads */}
      <input type="hidden" name="side_a" value={JSON.stringify(sideA)} />
      <input type="hidden" name="side_b" value={JSON.stringify(sideB)} />

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-zinc-500">
          {sideA.players.length + sideA.picks.length} ↔{" "}
          {sideB.players.length + sideB.picks.length}
        </p>
        <button
          type="submit"
          disabled={
            sideA.players.length + sideA.picks.length === 0 ||
            sideB.players.length + sideB.picks.length === 0
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          Submit for council review
        </button>
      </div>
    </form>
  );
}

function RadioGroup<T extends string>({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: T;
  options: readonly { value: T; label: string }[];
}) {
  const [value, setValue] = useState<T>(defaultValue);
  return (
    <div className="mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1">
      <input type="hidden" name={name} value={value} />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setValue(opt.value)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${
            value === opt.value
              ? "bg-emerald-500/20 text-emerald-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TradeSidePicker({
  label,
  selectedPlayers,
  setSelectedPlayers,
  picks,
  setPicks,
  allPlayers,
  excludeIds,
}: {
  label: string;
  selectedPlayers: number[];
  setSelectedPlayers: (ids: number[]) => void;
  picks: Pick[];
  setPicks: (picks: Pick[]) => void;
  allPlayers: PickablePlayer[];
  excludeIds: number[];
}) {
  const [search, setSearch] = useState("");
  const currentYear = new Date().getFullYear();
  const [pickYear, setPickYear] = useState(currentYear + 1);
  const [pickRound, setPickRound] = useState(1);

  const playerById = useMemo(() => {
    const m = new Map<number, PickablePlayer>();
    for (const p of allPlayers) m.set(p.player_id, p);
    return m;
  }, [allPlayers]);

  const selected = selectedPlayers
    .map((id) => playerById.get(id))
    .filter((p): p is PickablePlayer => !!p);

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase().trim();
    const excluded = new Set(excludeIds);
    return allPlayers
      .filter(
        (p) =>
          !excluded.has(p.player_id) &&
          (p.name.toLowerCase().includes(q) ||
            p.team.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.vegasFptsPPR - a.vegasFptsPPR)
      .slice(0, 8);
  }, [search, allPlayers, excludeIds]);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>

      {/* Selected players */}
      <div className="space-y-1.5">
        {selected.length === 0 && picks.length === 0 && (
          <p className="text-xs text-zinc-600">Add players or picks below</p>
        )}
        {selected.map((p) => (
          <div
            key={p.player_id}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm"
          >
            <span className="flex-1 truncate font-medium text-zinc-100">
              {p.name}
            </span>
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
            >
              {p.position}
            </span>
            <span className="w-10 font-mono text-xs text-zinc-400">
              {p.team}
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedPlayers(
                  selectedPlayers.filter((id) => id !== p.player_id),
                )
              }
              className="text-zinc-500 hover:text-rose-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {picks.map((pk, idx) => (
          <div
            key={`pick-${idx}`}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm"
          >
            <span className="flex-1 font-mono text-zinc-100">
              {pk.year} {pk.round}
              {pk.slot != null ? `.${String(pk.slot).padStart(2, "0")}` : ""}
            </span>
            <span className="text-xs text-zinc-500">pick</span>
            <button
              type="button"
              onClick={() => setPicks(picks.filter((_, i) => i !== idx))}
              className="text-zinc-500 hover:text-rose-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add player */}
      <div className="relative">
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players to add"
            className="block w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        {filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
            {filtered.map((p) => (
              <button
                key={p.player_id}
                type="button"
                onClick={() => {
                  setSelectedPlayers([...selectedPlayers, p.player_id]);
                  setSearch("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800"
              >
                <span className="flex-1 truncate">{p.name}</span>
                <span
                  className={`inline-flex rounded px-1 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                >
                  {p.position}
                </span>
                <span className="w-10 font-mono text-xs text-zinc-500">
                  {p.team}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add pick */}
      <div className="flex items-center gap-1.5">
        <select
          value={pickYear}
          onChange={(e) => setPickYear(Number(e.target.value))}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
        >
          {[currentYear, currentYear + 1, currentYear + 2, currentYear + 3].map(
            (y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ),
          )}
        </select>
        <select
          value={pickRound}
          onChange={(e) => setPickRound(Number(e.target.value))}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
        >
          {[1, 2, 3, 4].map((r) => (
            <option key={r} value={r}>
              Rd {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            setPicks([...picks, { year: pickYear, round: pickRound, slot: null }])
          }
          className="inline-flex items-center gap-1 rounded-md bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <Plus className="h-3 w-3" />
          Add pick
        </button>
      </div>
    </div>
  );
}
