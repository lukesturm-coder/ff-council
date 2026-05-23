"use client";

import { useMemo, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import type { FantasyPosition } from "@/lib/types";
import { submitVerdict } from "../actions";
import type { VerdictScenarioType } from "../types";
import TradeSubmissionForm from "../../trades/new/TradeSubmissionForm";

export type PickablePlayer = {
  player_id: number;
  name: string;
  team: string;
  position: FantasyPosition;
  vegasFptsPPR: number;
};

// The big "what kind of call?" picker. Start/Sit + Draft post a verdict
// scenario; Trade posts a trade for council review (reuses the Trade Court
// submission form). Trade Court (/trades/new) still works standalone too.
type CallType = VerdictScenarioType | "trade";
const CALL_TYPES: Array<{ value: CallType; label: string; sub: string }> = [
  { value: "start_sit", label: "Start / Sit", sub: "Who do I start?" },
  { value: "draft", label: "Draft", sub: "Who do I draft?" },
  { value: "trade", label: "Trade", sub: "Is this deal fair?" },
];

const SCORING_OPTIONS = [
  { value: "PPR", label: "PPR" },
  { value: "Half", label: "Half PPR" },
  { value: "Standard", label: "Standard" },
  { value: "Superflex", label: "Superflex" },
  { value: "TEPremium", label: "TE Premium" },
] as const;

const DRAFT_POSITIONS = [
  { value: "QB", label: "QB" },
  { value: "RB", label: "RB" },
  { value: "WR", label: "WR" },
  { value: "TE", label: "TE" },
  { value: "FLEX", label: "FLEX" },
  { value: "Any", label: "Any" },
] as const;

const SLOT_TYPES = [
  { value: "QB", label: "QB" },
  { value: "RB", label: "RB" },
  { value: "WR", label: "WR" },
  { value: "TE", label: "TE" },
  { value: "FLEX", label: "FLEX" },
] as const;

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

const MAX_CANDIDATES = 5;
const MAX_ROSTER = 10;
const NOTES_MAX = 500;

export default function VerdictSubmissionForm({
  players,
  initialScenarioType = "draft",
}: {
  players: PickablePlayer[];
  // Optional starting tab — set by /verdict/new when entering via the
  // unified case-type picker (?type=draft|start_sit). User can still
  // toggle to the other mode inside the form.
  initialScenarioType?: VerdictScenarioType;
}) {
  const [scenarioType, setScenarioType] =
    useState<CallType>(initialScenarioType);

  // Context (mode-dependent)
  const [scoring, setScoring] = useState<string>("PPR");
  const [positionNeeded, setPositionNeeded] = useState<string>("Any");
  const [slotType, setSlotType] = useState<string>("FLEX");
  const [leagueSize, setLeagueSize] = useState<number | "">(12);
  const [round, setRound] = useState<number | "">(1);
  const [week, setWeek] = useState<number | "">(1);

  // Selected player ids
  const [candidateIds, setCandidateIds] = useState<number[]>([]);
  const [rosterIds, setRosterIds] = useState<number[]>([]);

  const [notes, setNotes] = useState("");

  const playerById = useMemo(() => {
    const m = new Map<number, PickablePlayer>();
    for (const p of players) m.set(p.player_id, p);
    return m;
  }, [players]);

  const candidates = useMemo(
    () =>
      candidateIds
        .map((id) => playerById.get(id))
        .filter((p): p is PickablePlayer => !!p)
        .map((p) => ({
          player_id: p.player_id,
          name: p.name,
          team: p.team,
          position: p.position,
        })),
    [candidateIds, playerById],
  );

  const roster = useMemo(
    () =>
      rosterIds
        .map((id) => playerById.get(id))
        .filter((p): p is PickablePlayer => !!p)
        .map((p) => ({
          player_id: p.player_id,
          name: p.name,
          team: p.team,
          position: p.position,
        })),
    [rosterIds, playerById],
  );

  // Build the mode-specific context payload. Each mode only emits the keys
  // it owns so the stored JSON stays clean.
  const context = useMemo(() => {
    if (scenarioType === "draft") {
      return {
        scoring,
        position_needed: positionNeeded,
        league_size: leagueSize === "" ? null : Number(leagueSize),
        round: round === "" ? null : Number(round),
      };
    }
    return {
      scoring,
      slot_type: slotType,
      week: week === "" ? null : Number(week),
      league_size: leagueSize === "" ? null : Number(leagueSize),
    };
  }, [
    scenarioType,
    scoring,
    positionNeeded,
    leagueSize,
    round,
    slotType,
    week,
  ]);

  const candidateCount = candidates.length;
  const canSubmit = candidateCount >= 2 && candidateCount <= MAX_CANDIDATES;

  return (
    <div className="space-y-6">
      {/* What kind of call? — big top-level picker, OUTSIDE the forms so we can
          swap between the verdict form and the trade form (no nested forms). */}
      <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
        <legend className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          What kind of call?
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {CALL_TYPES.map((t) => {
            const active = scenarioType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setScenarioType(t.value)}
                className={`flex flex-col items-start gap-0.5 rounded-xl border p-4 text-left transition sm:p-5 ${
                  active
                    ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/40"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                }`}
              >
                <span
                  className={`text-base font-bold sm:text-lg ${
                    active ? "text-emerald-200" : "text-zinc-100"
                  }`}
                >
                  {t.label}
                </span>
                <span className="text-xs text-zinc-500">{t.sub}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {scenarioType === "trade" ? (
        <TradeSubmissionForm players={players} prefillA={[]} prefillB={[]} />
      ) : (
        <form action={submitVerdict} className="space-y-6">

      {/* Context */}
      <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
        <legend className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          Context
        </legend>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-500">
              Scoring
            </label>
            <RadioGroup
              name="scoring_visible"
              value={scoring}
              options={SCORING_OPTIONS}
              onChange={(v) => setScoring(v)}
            />
          </div>

          {scenarioType === "draft" ? (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-500">
                  Position needed
                </label>
                <RadioGroup
                  name="position_needed_visible"
                  value={positionNeeded}
                  options={DRAFT_POSITIONS}
                  onChange={(v) => setPositionNeeded(v)}
                />
              </div>
              <div>
                <label
                  htmlFor="league_size"
                  className="block text-xs uppercase tracking-wider text-zinc-500"
                >
                  League size
                </label>
                <input
                  id="league_size"
                  type="number"
                  value={leagueSize}
                  onChange={(e) =>
                    setLeagueSize(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  min={4}
                  max={32}
                  className="mt-1 w-24 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
                />
              </div>
              <div>
                <label
                  htmlFor="round"
                  className="block text-xs uppercase tracking-wider text-zinc-500"
                >
                  Round (optional)
                </label>
                <input
                  id="round"
                  type="number"
                  value={round}
                  onChange={(e) =>
                    setRound(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  min={1}
                  max={30}
                  className="mt-1 w-24 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-500">
                  Slot type
                </label>
                <RadioGroup
                  name="slot_type_visible"
                  value={slotType}
                  options={SLOT_TYPES}
                  onChange={(v) => setSlotType(v)}
                />
              </div>
              <div>
                <label
                  htmlFor="week"
                  className="block text-xs uppercase tracking-wider text-zinc-500"
                >
                  Week
                </label>
                <input
                  id="week"
                  type="number"
                  value={week}
                  onChange={(e) =>
                    setWeek(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  min={1}
                  max={18}
                  className="mt-1 w-24 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
                />
              </div>
              <div>
                <label
                  htmlFor="league_size_ss"
                  className="block text-xs uppercase tracking-wider text-zinc-500"
                >
                  League size (optional)
                </label>
                <input
                  id="league_size_ss"
                  type="number"
                  value={leagueSize}
                  onChange={(e) =>
                    setLeagueSize(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  min={4}
                  max={32}
                  className="mt-1 w-24 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
                />
              </div>
            </>
          )}
        </div>
      </fieldset>

      {/* Candidates */}
      <PlayerPickerSection
        label={`Candidates (${candidateCount}/${MAX_CANDIDATES})`}
        helper={
          scenarioType === "draft"
            ? "Who's on the board? Pick 2-5 players the council should choose between."
            : "Pick 2-5 players you're deciding between this week."
        }
        selectedIds={candidateIds}
        setSelectedIds={setCandidateIds}
        allPlayers={players}
        excludeIds={candidateIds}
        maxItems={MAX_CANDIDATES}
        emptyMessage="Add at least 2 candidates"
      />

      {/* Roster (draft mode only) */}
      {scenarioType === "draft" && (
        <PlayerPickerSection
          label={`Your current roster (${rosterIds.length}/${MAX_ROSTER}, optional)`}
          helper="Helps the council weigh positional need. Skip if you don't want to share."
          selectedIds={rosterIds}
          setSelectedIds={setRosterIds}
          allPlayers={players}
          excludeIds={[...rosterIds, ...candidateIds]}
          maxItems={MAX_ROSTER}
          emptyMessage="Optional"
        />
      )}

      {/* Notes */}
      <div>
        <label
          htmlFor="notes"
          className="block text-xs uppercase tracking-wider text-zinc-500"
        >
          Notes (optional)
        </label>
        <textarea
          id="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
          placeholder="Anything else the council should know?"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <p className="mt-1 text-right text-xs text-zinc-600">
          {notes.length}/{NOTES_MAX}
        </p>
      </div>

      {/* Hidden serialized payloads consumed by submitVerdict */}
      <input type="hidden" name="scenario_type" value={scenarioType} />
      <input type="hidden" name="candidates" value={JSON.stringify(candidates)} />
      <input
        type="hidden"
        name="roster"
        value={JSON.stringify(scenarioType === "draft" ? roster : [])}
      />
      <input type="hidden" name="context" value={JSON.stringify(context)} />
      <input type="hidden" name="notes" value={notes} />
      <input type="hidden" name="image_url" value="" />

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-zinc-500">
          {candidateCount < 2
            ? `Add ${2 - candidateCount} more`
            : `${candidateCount} candidate${candidateCount === 1 ? "" : "s"}`}
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          Submit for community vote
        </button>
      </div>
        </form>
      )}
    </div>
  );
}

function RadioGroup<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange?: (v: T) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1">
      <input type="hidden" name={name} value={value} />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange?.(opt.value)}
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

function PlayerPickerSection({
  label,
  helper,
  selectedIds,
  setSelectedIds,
  allPlayers,
  excludeIds,
  maxItems,
  emptyMessage,
}: {
  label: string;
  helper: string;
  selectedIds: number[];
  setSelectedIds: (ids: number[]) => void;
  allPlayers: PickablePlayer[];
  excludeIds: number[];
  maxItems: number;
  emptyMessage: string;
}) {
  const [search, setSearch] = useState("");

  const playerById = useMemo(() => {
    const m = new Map<number, PickablePlayer>();
    for (const p of allPlayers) m.set(p.player_id, p);
    return m;
  }, [allPlayers]);

  const selected = selectedIds
    .map((id) => playerById.get(id))
    .filter((p): p is PickablePlayer => !!p);

  const atCap = selectedIds.length >= maxItems;

  const filtered = useMemo(() => {
    if (!search.trim() || atCap) return [];
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
  }, [search, allPlayers, excludeIds, atCap]);

  return (
    <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <legend className="px-2 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </legend>
      <p className="text-xs text-zinc-500">{helper}</p>

      <div className="space-y-1.5">
        {selected.length === 0 && (
          <p className="text-xs text-zinc-600">{emptyMessage}</p>
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
                setSelectedIds(selectedIds.filter((id) => id !== p.player_id))
              }
              className="text-zinc-500 hover:text-rose-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="relative">
        <div className="relative">
          <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              atCap ? `Max ${maxItems} reached` : "Search players to add"
            }
            disabled={atCap}
            className="block w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        {filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
            {filtered.map((p) => (
              <button
                key={p.player_id}
                type="button"
                onClick={() => {
                  setSelectedIds([...selectedIds, p.player_id]);
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
    </fieldset>
  );
}
