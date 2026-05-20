"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { savePersonalRank, type TierLetter } from "./rank/actions";
import type { ExistingRankings } from "./rankings/TierBoardEditor";

// Simplest of the three builders: your current ranking as one top-to-bottom
// list. Drag any player up or down to fine-tune the order. Order is the
// canonical artefact that feeds the council consensus; each player's tier
// letter (set on the Tier Board / Quick Rank) is carried through untouched.
//
// We only list players you've already ranked — the List view is for ordering,
// not discovery. Add players via Quick Rank or the Tier Board, then fine-tune
// here. Saves are debounced and computed from a ref mirror of state so we never
// fire the save transition from inside a setState updater.

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const SAVE_DEBOUNCE_MS = 700;

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

const TIER_HEX: Record<TierLetter, string> = {
  S: "#ff7f7f",
  A: "#ffbf7f",
  B: "#ffdf7f",
  C: "#ffff7f",
  D: "#bfff7f",
  E: "#7fff7f",
  F: "#7fffff",
  G: "#7fbfff",
  H: "#7f7fff",
};

// Per-scoring ordered ids + the tier of each player (preserved on save).
type ListState = { ordered: number[]; tierOf: Map<number, TierLetter> };

export default function RankListEditor({
  projections,
  existingRankings,
}: {
  projections: PlayerProjection[];
  existingRankings: ExistingRankings;
}) {
  const playerMap = useMemo(() => {
    const m = new Map<number, PlayerProjection>();
    for (const p of projections) m.set(p.playerId, p);
    return m;
  }, [projections]);

  const [states, setStates] = useState<Record<ScoringSystem, ListState>>(() => {
    const out = {
      PPR: { ordered: [], tierOf: new Map() },
      Half: { ordered: [], tierOf: new Map() },
      Standard: { ordered: [], tierOf: new Map() },
    } as Record<ScoringSystem, ListState>;
    for (const s of SCORING_OPTIONS) {
      const saved = existingRankings[s] ?? {};
      const rows = Object.entries(saved)
        .map(([pid, e]) => ({ pid: Number(pid), rank: e.rank, tier: e.tier }))
        .filter((r) => playerMap.has(r.pid))
        .sort((a, b) => a.rank - b.rank);
      const tierOf = new Map<number, TierLetter>();
      for (const r of rows) if (r.tier) tierOf.set(r.pid, r.tier);
      out[s] = { ordered: rows.map((r) => r.pid), tierOf };
    }
    return out;
  });

  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [, startSave] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statesRef = useRef(states);
  statesRef.current = states;

  const list = states[scoring];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const persist = useCallback(
    (next: ListState, scoringSys: ScoringSystem) => {
      const ranks = next.ordered.map((pid, idx) => ({
        playerId: pid,
        rank: idx + 1,
        tier: next.tierOf.get(pid) ?? null,
      }));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveMsg("Saving…");
      saveTimer.current = setTimeout(() => {
        startSave(async () => {
          if (ranks.length === 0) {
            setSaveMsg(null);
            return;
          }
          const res = await savePersonalRank({ scoring: scoringSys, ranks });
          setSaveMsg(res.ok ? "Saved" : `Save failed: ${res.error}`);
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [],
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const cur = statesRef.current[scoring];
      const oldIdx = cur.ordered.indexOf(Number(active.id));
      const newIdx = cur.ordered.indexOf(Number(over.id));
      if (oldIdx < 0 || newIdx < 0) return;
      const next: ListState = {
        ordered: arrayMove(cur.ordered, oldIdx, newIdx),
        tierOf: cur.tierOf,
      };
      setStates((prev) => ({ ...prev, [scoring]: next }));
      persist(next, scoring);
    },
    [scoring, persist],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
            Scoring
          </span>
          {SCORING_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setScoring(s);
                setSaveMsg(null);
              }}
              className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
                scoring === s
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          <span className="font-mono text-zinc-300">{list.ordered.length}</span>{" "}
          ranked
          {saveMsg && (
            <>
              <span className="mx-1.5 text-zinc-700">·</span>
              <span
                className={
                  saveMsg.startsWith("Save failed")
                    ? "text-rose-400"
                    : "text-emerald-400/80"
                }
              >
                {saveMsg}
              </span>
            </>
          )}
        </span>
      </div>

      {list.ordered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No players ranked for {scoring} yet. Add players with Quick Rank or
            the Tier Board, then drag to fine-tune their order here.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={list.ordered}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-1.5">
              {list.ordered.map((pid, idx) => {
                const p = playerMap.get(pid);
                if (!p) return null;
                return (
                  <SortableRow
                    key={pid}
                    rank={idx + 1}
                    player={p}
                    tier={list.tierOf.get(pid) ?? null}
                  />
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Drag any player up or down to reorder your ranking. The order is what
        feeds the Council consensus; tier letters carry over from the Tier
        Board. Auto-saves after each move.
      </p>
    </div>
  );
}

function SortableRow({
  rank,
  player,
  tier,
}: {
  rank: number;
  player: PlayerProjection;
  tier: TierLetter | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: player.playerId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex touch-none select-none items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 transition active:cursor-grabbing hover:border-zinc-600 sm:gap-3 sm:px-3"
    >
      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-zinc-600" />
      <span className="w-7 shrink-0 text-right font-mono text-sm text-zinc-500 sm:w-8">
        {rank}
      </span>
      {tier ? (
        <span
          style={{ backgroundColor: TIER_HEX[tier] }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-xs font-bold text-zinc-900"
        >
          {tier}
        </span>
      ) : (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700 font-mono text-xs text-zinc-600">
          —
        </span>
      )}
      <span
        className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
      >
        {player.position}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
        {player.name}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-zinc-500">
        {player.team}
      </span>
    </li>
  );
}
