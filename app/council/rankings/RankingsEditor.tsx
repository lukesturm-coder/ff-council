"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, RotateCcw, Save } from "lucide-react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import Link from "next/link";
import {
  computeTiersByPlayer,
  tierStyle,
  tierDescription,
  tierLetter,
  type TierInfo,
} from "@/lib/tiers";
import { saveRanking } from "./actions";

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

type ExistingRankings = Partial<Record<ScoringSystem, Record<number, number>>>;

export default function RankingsEditor({
  projections,
  existingRankings,
}: {
  projections: PlayerProjection[];
  existingRankings: ExistingRankings;
}) {
  const [scoring, setScoring] = useState<ScoringSystem>("PPR");

  const [orders, setOrders] = useState<Record<ScoringSystem, number[]>>(() =>
    initialOrders(projections, existingRankings),
  );

  const [dirty, setDirty] = useState<Record<ScoringSystem, boolean>>({
    PPR: false,
    Half: false,
    Standard: false,
  });

  const [activeId, setActiveId] = useState<number | null>(null);
  const [saving, startSave] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const playerMap = useMemo(() => {
    const m = new Map<number, PlayerProjection>();
    for (const p of projections) m.set(p.playerId, p);
    return m;
  }, [projections]);

  const tierByPlayer = useMemo(
    () => computeTiersByPlayer(projections, scoring),
    [projections, scoring],
  );

  const currentOrder = orders[scoring];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = currentOrder.indexOf(Number(active.id));
    const newIndex = currentOrder.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(currentOrder, oldIndex, newIndex);
    setOrders({ ...orders, [scoring]: next });
    setDirty({ ...dirty, [scoring]: true });
    setSaveMsg(null);
  }

  function resetToVegas() {
    const baseline = vegasBaseline(projections, scoring);
    setOrders({ ...orders, [scoring]: baseline });
    setDirty({ ...dirty, [scoring]: true });
    setSaveMsg(null);
  }

  function handleSave() {
    const ranks = currentOrder.map((playerId, idx) => ({
      playerId,
      rank: idx + 1,
    }));
    startSave(async () => {
      const res = await saveRanking({ scoring, ranks });
      if (res.ok) {
        setDirty({ ...dirty, [scoring]: false });
        setSaveMsg(`Saved ${scoring} rankings.`);
      } else {
        setSaveMsg(`Error: ${res.error}`);
      }
    });
  }

  const activePlayer = activeId != null ? playerMap.get(activeId) : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
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
              {dirty[s] && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          ))}
        </div>

        <button
          onClick={resetToVegas}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          title="Reset to Vegas Edge baseline for this scoring system"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Reset to Vegas baseline</span>
          <span className="sm:hidden">Reset</span>
        </button>

        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          {saveMsg && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${
                saveMsg.startsWith("Error")
                  ? "text-rose-300"
                  : "text-emerald-300"
              }`}
            >
              {!saveMsg.startsWith("Error") && (
                <Check className="h-3.5 w-3.5" />
              )}
              {saveMsg}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty[scoring]}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-0"
          >
            <Save className="h-3.5 w-3.5" />
            {saving
              ? "Saving…"
              : dirty[scoring]
                ? `Save ${scoring}`
                : "No changes"}
          </button>
        </div>
      </div>

      {/* Draggable list */}
      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={currentOrder}
            strategy={verticalListSortingStrategy}
          >
            <ol className="divide-y divide-zinc-800/60">
              {currentOrder.map((playerId, idx) => {
                const p = playerMap.get(playerId);
                if (!p) return null;
                const vegasRank = vegasRankOf(projections, scoring, playerId);
                const delta = vegasRank - (idx + 1);
                return (
                  <SortableRow
                    key={playerId}
                    playerId={playerId}
                    player={p}
                    rank={idx + 1}
                    delta={delta}
                    tier={tierByPlayer.get(playerId) ?? null}
                    scoring={scoring}
                  />
                );
              })}
            </ol>
          </SortableContext>

          <DragOverlay>
            {activePlayer ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-zinc-800 px-3 py-2 shadow-2xl sm:gap-3 sm:px-4">
                <GripVertical className="h-4 w-4 text-emerald-300" />
                <span className="w-6 text-right font-mono text-sm text-zinc-400 sm:w-8">
                  {currentOrder.indexOf(activePlayer.playerId) + 1}
                </span>
                <span className="truncate font-medium text-zinc-100">
                  {activePlayer.name}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[activePlayer.position]}`}
                >
                  {activePlayer.position}
                </span>
                <span className="hidden font-mono text-xs text-zinc-400 sm:inline">
                  {activePlayer.team}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <p className="text-xs text-zinc-500">
        Drag any player by the <span className="text-zinc-300">grip
        handle</span> on the left to reorder. The{" "}
        <span className="text-emerald-400">+/−</span> column shows how far
        your rank diverges from the Vegas Edge baseline — positive means you
        like the player more than Vegas does.
      </p>
    </div>
  );
}

function SortableRow({
  playerId,
  player,
  rank,
  delta,
  tier,
  scoring,
}: {
  playerId: number;
  player: PlayerProjection;
  rank: number;
  delta: number;
  tier: TierInfo | null;
  scoring: ScoringSystem;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: playerId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1, // hide the original while the overlay is shown
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-zinc-900 px-2 py-1 transition hover:bg-zinc-800/30 sm:gap-3 sm:px-4 sm:py-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="flex h-11 w-11 cursor-grab touch-none items-center justify-center text-zinc-600 transition hover:text-zinc-300 active:cursor-grabbing sm:h-auto sm:w-auto"
        aria-label={`Drag ${player.name}`}
      >
        <GripVertical className="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
      <span className="w-6 text-right font-mono text-sm text-zinc-500 sm:w-8">
        {rank}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">
        {player.name}
      </span>
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
      >
        {player.position}
      </span>
      {tier && (
        <Link
          href={`/tiers?scoring=${scoring}&source=vegas`}
          className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset transition hover:brightness-125 ${tierStyle(tier.tier).badge}`}
          title={tierDescription(tier.tier, tier.position, tier.tierSize)}
        >
          {tierLetter(tier.tier)}
        </Link>
      )}
      <span className="hidden w-10 font-mono text-xs text-zinc-400 sm:inline">
        {player.team}
      </span>
      <span
        className="w-10 text-right font-mono text-xs sm:w-14"
        title={`Vegas rank: ${rank - delta}`}
      >
        {delta === 0 ? (
          <span className="text-zinc-500">—</span>
        ) : delta > 0 ? (
          <span className="text-emerald-400">+{delta}</span>
        ) : (
          <span className="text-rose-400">{delta}</span>
        )}
      </span>
    </li>
  );
}

function vegasBaseline(
  projections: PlayerProjection[],
  scoring: ScoringSystem,
): number[] {
  return [...projections]
    .sort((a, b) => b.vbd[scoring] - a.vbd[scoring])
    .map((p) => p.playerId);
}

function vegasRankOf(
  projections: PlayerProjection[],
  scoring: ScoringSystem,
  playerId: number,
): number {
  const sorted = [...projections].sort(
    (a, b) => b.vbd[scoring] - a.vbd[scoring],
  );
  return sorted.findIndex((p) => p.playerId === playerId) + 1;
}

function initialOrders(
  projections: PlayerProjection[],
  existing: ExistingRankings,
): Record<ScoringSystem, number[]> {
  const result: Record<ScoringSystem, number[]> = {
    PPR: vegasBaseline(projections, "PPR"),
    Half: vegasBaseline(projections, "Half"),
    Standard: vegasBaseline(projections, "Standard"),
  };
  for (const s of SCORING_OPTIONS) {
    const saved = existing[s];
    if (saved && Object.keys(saved).length > 0) {
      const entries = Object.entries(saved)
        .map(([pid, r]) => ({ playerId: Number(pid), rank: Number(r) }))
        .sort((a, b) => a.rank - b.rank)
        .map((e) => e.playerId);
      const known = new Set(entries);
      const missing = projections
        .filter((p) => !known.has(p.playerId))
        .map((p) => p.playerId);
      result[s] = [...entries, ...missing];
    }
  }
  return result;
}
