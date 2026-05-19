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
type LeagueType = (typeof LEAGUE_TYPES)[number]["value"];

// Parse free-form pick phrases like "2027 mid 2nd", "2027 1.05", "2028 early
// 1st", "2027 Rd 3". Requires a year (20xx) and a round; slot is optional.
// Returns null when the input isn't recognisably a pick.
function parsePick(input: string): Pick | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const yearMatch = s.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const rest = s.replace(yearMatch[1], " ").replace(/\s+/g, " ");

  // Dot notation: "1.05" → round 1, slot 5
  const dotMatch = rest.match(/(?<![\d.])([1-9])\.(\d{1,2})(?![\d.])/);
  if (dotMatch) {
    return {
      year,
      round: Number(dotMatch[1]),
      slot: Number(dotMatch[2]),
    };
  }

  let round: number | null = null;
  const ordMatch = rest.match(/\b([1-9])(?:st|nd|rd|th)\b/);
  if (ordMatch) round = Number(ordMatch[1]);
  else {
    const rMatch = rest.match(/\b(?:r|rd|round)\s*([1-9])\b/);
    if (rMatch) round = Number(rMatch[1]);
  }
  if (!round) return null;

  // Slot descriptor: early/mid/late → 3/6/10
  let slot: number | null = null;
  if (/\bearly\b/.test(rest)) slot = 3;
  else if (/\bmid(?:dle)?\b/.test(rest)) slot = 6;
  else if (/\blate\b/.test(rest)) slot = 10;

  return { year, round, slot };
}

function formatPick(p: Pick): string {
  const slotPart = p.slot != null ? `.${String(p.slot).padStart(2, "0")}` : "";
  return `${p.year} R${p.round}${slotPart}`;
}

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
  const [leagueType, setLeagueType] = useState<LeagueType>("redraft");

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
      {/* Format choices — pulled to the top because these are the two
          settings most likely to make a vote wrong if mis-set. Visually
          larger than the secondary fields below. */}
      <section className="space-y-5 rounded-lg border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-5">
        <div>
          <label className="block text-sm font-semibold text-zinc-100 sm:text-base">
            What kind of league?
          </label>
          <p className="mt-0.5 text-xs text-zinc-400">
            Affects how council members value picks vs players.
          </p>
          <RadioGroup
            name="league_type"
            defaultValue="redraft"
            options={LEAGUE_TYPES}
            size="lg"
            onChange={(v) => {
              setLeagueType(v);
              // Redraft leagues don't trade picks — clear any that were
              // typed in before the user switched away from dynasty/keeper.
              if (v === "redraft") {
                setSideAPicks([]);
                setSideBPicks([]);
              }
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-zinc-100 sm:text-base">
            Scoring system?
          </label>
          <p className="mt-0.5 text-xs text-zinc-400">
            Determines how valuable WRs and TEs are relative to RBs.
          </p>
          <RadioGroup
            name="scoring"
            defaultValue="PPR"
            options={SCORING_OPTIONS}
            size="lg"
          />
        </div>
      </section>

      {/* Secondary context — smaller, below the headline format choices */}
      <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <legend className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          League context
        </legend>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          leagueType={leagueType}
        />
        <TradeSidePicker
          label="Team B receives"
          selectedPlayers={sideBPlayers}
          setSelectedPlayers={setSideBPlayers}
          picks={sideBPicks}
          setPicks={setSideBPicks}
          allPlayers={players}
          excludeIds={[...sideAPlayers, ...sideBPlayers]}
          leagueType={leagueType}
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
          Submit trade for community vote
        </button>
      </div>
    </form>
  );
}

function RadioGroup<T extends string>({
  name,
  defaultValue,
  options,
  onChange,
  size = "sm",
}: {
  name: string;
  defaultValue: T;
  options: readonly { value: T; label: string }[];
  onChange?: (v: T) => void;
  size?: "sm" | "lg";
}) {
  const [value, setValue] = useState<T>(defaultValue);
  const containerCls =
    size === "lg"
      ? "mt-2 flex flex-wrap gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 p-1.5"
      : "mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1";
  const pillCls =
    size === "lg"
      ? "rounded-md px-3.5 py-2 text-sm font-semibold transition"
      : "rounded px-2.5 py-1 text-xs font-medium transition";
  return (
    <div className={containerCls}>
      <input type="hidden" name={name} value={value} />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => {
            setValue(opt.value);
            onChange?.(opt.value);
          }}
          className={`${pillCls} ${
            value === opt.value
              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-500/40"
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
  leagueType,
}: {
  label: string;
  selectedPlayers: number[];
  setSelectedPlayers: (ids: number[]) => void;
  picks: Pick[];
  setPicks: (picks: Pick[]) => void;
  allPlayers: PickablePlayer[];
  excludeIds: number[];
  leagueType: LeagueType;
}) {
  const [search, setSearch] = useState("");

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

  const allowsPicks = leagueType !== "redraft";
  const parsedPick = allowsPicks ? parsePick(search) : null;
  const showDropdown = filtered.length > 0 || parsedPick != null;

  const placeholder = allowsPicks
    ? "Search players, or type a pick (e.g. 2027 mid 2nd)"
    : "Search players to add";

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>

      {/* Selected players + picks */}
      <div className="space-y-1.5">
        {selected.length === 0 && picks.length === 0 && (
          <p className="text-xs text-zinc-600">
            {allowsPicks
              ? "Add players or picks below"
              : "Add players below"}
          </p>
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
              {formatPick(pk)}
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

      {/* Search input (players + picks) */}
      <div className="relative">
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={placeholder}
            className="block w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
            {parsedPick && (
              <button
                key="pick-suggestion"
                type="button"
                onClick={() => {
                  setPicks([...picks, parsedPick]);
                  setSearch("");
                }}
                className="flex w-full items-center gap-2 border-b border-zinc-800/60 bg-zinc-900 px-3 py-2 text-left text-sm hover:bg-zinc-800"
              >
                <span className="flex-1 font-mono text-zinc-100">
                  Add {formatPick(parsedPick)}
                </span>
                <span className="text-xs text-zinc-500">pick</span>
              </button>
            )}
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
    </div>
  );
}
