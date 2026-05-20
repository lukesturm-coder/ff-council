"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Search, X } from "lucide-react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { savePersonalRank, type TierLetter } from "../rank/actions";

// ---------------------------------------------------------------------------
// Tiermaker-style board. The member drags player chips from a filterable
// "unranked pool" into 9 global tier rows (S…H, best→worst across ALL
// positions). Order within a row matters (left→right = better).
//
// The canonical persisted artefact is the global rank order: concatenate the
// tiers S→H, preserving within-tier order, and number 1..N. That order feeds
// council_consensus exactly like the Beli tap-flow does. We additionally
// persist the tier letter (migration 018) so the board reloads players back
// into their rows.
//
// Placement happens once on drop (onDragEnd) — we intentionally do NOT shuffle
// chips between containers during onDragOver, because the pool only renders a
// filtered subset and moving the active chip out of it mid-drag unmounts its
// node, making dnd-kit cancel the drop. The hovered row still highlights via
// useDroppable's isOver.
//
// Save: debounced after each drag-end via savePersonalRank.
//   - We compute the next ordering purely (from a ref mirror of state) and
//     persist it outside the setState updater (never fire a transition from
//     inside a state updater).
//   - The action never revalidates /council (the route every editor lives on)
//     — doing so wedges the client transition queue and froze the flow.
// ---------------------------------------------------------------------------

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const TIERS: TierLetter[] = ["S", "A", "B", "C", "D", "E", "F", "G", "H"];
const POOL_ID = "pool";
const SAVE_DEBOUNCE_MS = 700;

// TierMaker-standard color ramp: solid fills, dark text. S red → H blue.
const TIER_META: Record<TierLetter, { label: string; hex: string }> = {
  S: { label: "League Winner", hex: "#ff7f7f" },
  A: { label: "Every-Week Starter", hex: "#ffbf7f" },
  B: { label: "Strong Flex", hex: "#ffdf7f" },
  C: { label: "Flex", hex: "#ffff7f" },
  D: { label: "Bench", hex: "#bfff7f" },
  E: { label: "Deep Bench", hex: "#7fff7f" },
  F: { label: "Bye-Week Fill", hex: "#7fffff" },
  G: { label: "Stash", hex: "#7fbfff" },
  H: { label: "Drop", hex: "#7f7fff" },
};

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

const POSITION_FILTERS: Array<"ALL" | FantasyPosition> = [
  "ALL",
  "QB",
  "RB",
  "WR",
  "TE",
];

// A container is either a tier letter or the pool.
type ContainerId = TierLetter | typeof POOL_ID;

// Board state for one scoring system: ordered player ids per container.
type Board = Record<ContainerId, number[]>;

function emptyBoard(): Board {
  const b = {} as Board;
  b[POOL_ID] = [];
  for (const t of TIERS) b[t] = [];
  return b;
}

// Existing data shape from the server: {playerId: {rank, tier}} per scoring.
export type ExistingEntry = { rank: number; tier: TierLetter | null };
export type ExistingRankings = Partial<
  Record<ScoringSystem, Record<number, ExistingEntry>>
>;

export default function TierBoardEditor({
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

  // Auto pool order per scoring (vegas fpts desc, alpha fallback). Drives the
  // initial unranked-pool ordering for players without a saved entry.
  const poolOrderByScoring = useMemo(() => {
    const out: Record<ScoringSystem, number[]> = {
      PPR: [],
      Half: [],
      Standard: [],
    };
    for (const s of SCORING_OPTIONS) {
      out[s] = [...projections]
        .sort((a, b) => {
          const fa = a.fantasyPoints[s] ?? 0;
          const fb = b.fantasyPoints[s] ?? 0;
          if (fb !== fa) return fb - fa;
          return a.name.localeCompare(b.name);
        })
        .map((p) => p.playerId);
    }
    return out;
  }, [projections]);

  // Seed one Board per scoring system from saved entries:
  //   - players with a saved tier go into that tier in rank order
  //   - players with a saved rank but NO tier are re-clustered: they keep
  //     their relative rank order and drop into the pool (graceful degrade
  //     before migration 018, and for entries written by the Beli flow).
  //   - players with no entry at all fall into the pool in auto order.
  const [boards, setBoards] = useState<Record<ScoringSystem, Board>>(() => {
    const out = {
      PPR: emptyBoard(),
      Half: emptyBoard(),
      Standard: emptyBoard(),
    } as Record<ScoringSystem, Board>;
    for (const s of SCORING_OPTIONS) {
      const board = emptyBoard();
      const saved = existingRankings[s] ?? {};
      const placed = new Set<number>();
      // Sort saved player ids by rank so within-tier order is preserved.
      const savedSorted = Object.entries(saved)
        .map(([pid, e]) => ({ pid: Number(pid), ...e }))
        .sort((a, b) => a.rank - b.rank);
      for (const e of savedSorted) {
        if (!playerMap.has(e.pid)) continue;
        if (e.tier) {
          board[e.tier].push(e.pid);
        } else {
          board[POOL_ID].push(e.pid);
        }
        placed.add(e.pid);
      }
      // Everyone not placed → pool in auto order, appended after re-clustered.
      for (const pid of poolOrderByScoring[s]) {
        if (!placed.has(pid)) board[POOL_ID].push(pid);
      }
      out[s] = board;
    }
    return out;
  });

  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [posFilter, setPosFilter] = useState<"ALL" | FantasyPosition>("ALL");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [, startSave] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always-fresh mirror of `boards` so drag handlers can read the latest state
  // synchronously (without the fragile "capture via setState side-effect" hack)
  // and compute the next board purely before saving.
  const boardsRef = useRef(boards);
  boardsRef.current = boards;

  const board = boards[scoring];

  const sensors = useSensors(
    // Pointer (mouse/trackpad): tiny activation distance so chips are easy to
    // pick up without blocking taps.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Touch: short press-delay + tolerance so a scroll gesture isn't hijacked
    // as a drag, but a deliberate press-and-move lifts the chip. This is what
    // makes drag usable on a 390px phone.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  // ---- persistence ---------------------------------------------------------
  // Derive the global ordered list (with tiers) from a board: concatenate
  // S→H, then number 1..N. Pool players are NOT ranked.
  const persistBoard = useCallback(
    (nextBoard: Board, scoringSys: ScoringSystem) => {
      const ranks: Array<{
        playerId: number;
        rank: number;
        tier: TierLetter;
      }> = [];
      let rank = 1;
      for (const t of TIERS) {
        for (const pid of nextBoard[t]) {
          ranks.push({ playerId: pid, rank, tier: t });
          rank += 1;
        }
      }
      // Compute OUTSIDE any setState updater, then fire the transition.
      startSave(async () => {
        if (ranks.length === 0) {
          // Nothing in any tier — nothing to persist. (We don't wipe the
          // existing submission here; the user just hasn't placed anyone yet.)
          setSaveMsg("Drop players into tiers to build your ranking.");
          return;
        }
        const res = await savePersonalRank({
          scoring: scoringSys,
          ranks,
        });
        setSaveMsg(res.ok ? "Saved" : `Save failed: ${res.error}`);
      });
    },
    [],
  );

  const scheduleSave = useCallback(
    (nextBoard: Board, scoringSys: ScoringSystem) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveMsg("Saving…");
      saveTimer.current = setTimeout(() => {
        persistBoard(nextBoard, scoringSys);
      }, SAVE_DEBOUNCE_MS);
    },
    [persistBoard],
  );

  // ---- drag handlers -------------------------------------------------------
  // Placement happens ONCE on drop (not live during drag). We deliberately do
  // NOT move chips between containers in onDragOver: the pool only renders a
  // filtered subset, so moving the active chip out of the pool mid-drag would
  // unmount its node and remount it under a different SortableContext —
  // dnd-kit then loses the active node and cancels the drop ("lifts but won't
  // drop / snaps back"). Keeping the chip put until drop avoids that entirely.
  // The hovered tier still highlights via useDroppable's `isOver`.
  function handleDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activePid = Number(active.id);
    if (active.id === over.id) return; // dropped on itself — no-op

    // Read the freshest board from the ref and compute the next board purely.
    const cur = boardsRef.current[scoring];

    // Source container (where the active chip currently lives).
    let from: ContainerId | null = null;
    for (const c of [POOL_ID, ...TIERS] as ContainerId[]) {
      if (cur[c].includes(activePid)) {
        from = c;
        break;
      }
    }
    if (!from) return;

    // Target container + the over-chip (if dropped onto a sibling chip rather
    // than empty container space). `over.id` is a container id (string) when
    // dropped on empty space, or a player id (number) when dropped on a chip.
    const overId = over.id;
    let to: ContainerId;
    let overPid = Number(overId);
    if (overId === POOL_ID || TIERS.includes(overId as TierLetter)) {
      to = overId as ContainerId;
      overPid = NaN;
    } else {
      let holder: ContainerId | null = null;
      for (const c of [POOL_ID, ...TIERS] as ContainerId[]) {
        if (cur[c].includes(overPid)) {
          holder = c;
          break;
        }
      }
      if (!holder) return;
      to = holder;
    }

    // Build the next board: pull the active chip out of its source, then insert
    // it into the target — before the over-chip, or at the end for empty space.
    const fromArr = cur[from].filter((p) => p !== activePid);
    const toArr = to === from ? fromArr : [...cur[to]];
    const insertAt = Number.isNaN(overPid) ? toArr.length : toArr.indexOf(overPid);
    if (insertAt >= 0) toArr.splice(insertAt, 0, activePid);
    else toArr.push(activePid);

    const next: Board =
      from === to
        ? { ...cur, [to]: toArr }
        : { ...cur, [from]: fromArr, [to]: toArr };

    setBoards((prev) => ({ ...prev, [scoring]: next }));
    scheduleSave(next, scoring);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  // ---- pool filtering ------------------------------------------------------
  const filteredPool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return board[POOL_ID].filter((pid) => {
      const p = playerMap.get(pid);
      if (!p) return false;
      if (posFilter !== "ALL" && p.position !== posFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [board, playerMap, posFilter, query]);

  const activePlayer = activeId != null ? playerMap.get(activeId) : null;
  const rankedCount = TIERS.reduce((n, t) => n + board[t].length, 0);

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
            </button>
          ))}
        </div>

        <Link
          href="/council?view=rank"
          className="text-xs text-zinc-500 transition hover:text-zinc-300"
          title="Beli-style tap-to-rank flow"
        >
          Prefer tapping? Quick-rank →
        </Link>

        <span className="ml-auto text-xs text-zinc-500">
          <span className="font-mono text-zinc-300">{rankedCount}</span> placed
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Tier rows */}
        <div className="space-y-2">
          {TIERS.map((t) => (
            <TierRow
              key={t}
              tier={t}
              playerIds={board[t]}
              playerMap={playerMap}
              activeId={activeId}
            />
          ))}
        </div>

        {/* Unranked pool */}
        <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Unranked pool
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              {POSITION_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setPosFilter(f)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                    posFilter === f
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative ml-auto flex min-w-[140px] flex-1 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 sm:max-w-[220px] sm:flex-initial">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pool…"
                className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="text-zinc-500 transition hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <PoolZone
            visibleIds={filteredPool}
            allIds={board[POOL_ID]}
            playerMap={playerMap}
            activeId={activeId}
            filtered={posFilter !== "ALL" || query.trim().length > 0}
          />
        </div>

        <DragOverlay>
          {activePlayer ? (
            <Chip player={activePlayer} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Drag players from the pool into tier rows — S is your best across every
        position, H is droppable. Order within a row matters (left = better).
        Your ranking auto-saves after each drop and feeds the Council column.
      </p>
    </div>
  );
}

// ===========================================================================
// Tier row
// ===========================================================================

function TierRow({
  tier,
  playerIds,
  playerMap,
  activeId,
}: {
  tier: TierLetter;
  playerIds: number[];
  playerMap: Map<number, PlayerProjection>;
  activeId: number | null;
}) {
  const meta = TIER_META[tier];
  const { setNodeRef, isOver } = useDroppable({ id: tier });

  return (
    <div
      style={isOver ? { boxShadow: `inset 0 0 0 2px ${meta.hex}` } : undefined}
      className="flex overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 transition"
    >
      {/* Label cell */}
      <div
        style={{ backgroundColor: meta.hex }}
        className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-zinc-900 sm:w-24"
      >
        <span className="text-xl font-bold leading-none sm:text-2xl">
          {tier}
        </span>
        <span className="hidden text-[10px] font-medium leading-tight opacity-75 sm:block">
          {meta.label}
        </span>
      </div>

      {/* Drop zone */}
      <SortableContext items={playerIds} strategy={rectSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-[52px] flex-1 flex-wrap content-start gap-1.5 p-1.5 sm:gap-2 sm:p-2"
        >
          {playerIds.length === 0 ? (
            <span className="self-center px-1 text-[11px] text-zinc-600">
              Drop players here
            </span>
          ) : (
            playerIds.map((pid) => {
              const p = playerMap.get(pid);
              if (!p) return null;
              return (
                <SortableChip
                  key={pid}
                  player={p}
                  hidden={activeId === pid}
                />
              );
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ===========================================================================
// Pool zone
// ===========================================================================

function PoolZone({
  visibleIds,
  allIds,
  playerMap,
  activeId,
  filtered,
}: {
  visibleIds: number[];
  allIds: number[];
  playerMap: Map<number, PlayerProjection>;
  activeId: number | null;
  filtered: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ID });

  return (
    // The SortableContext still spans ALL pool ids so dnd-kit's sortable
    // bookkeeping is consistent; we only RENDER the filtered subset.
    <SortableContext items={allIds} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`flex max-h-[46vh] flex-wrap content-start gap-1.5 overflow-y-auto p-2 transition sm:gap-2 ${
          isOver ? "bg-zinc-800/40" : ""
        }`}
      >
        {visibleIds.length === 0 ? (
          <span className="px-1 py-4 text-xs text-zinc-600">
            {filtered
              ? "No matching players in the pool."
              : "Pool is empty — every player is in a tier."}
          </span>
        ) : (
          visibleIds.map((pid) => {
            const p = playerMap.get(pid);
            if (!p) return null;
            return (
              <SortableChip key={pid} player={p} hidden={activeId === pid} />
            );
          })
        )}
      </div>
    </SortableContext>
  );
}

// ===========================================================================
// Chips
// ===========================================================================

function SortableChip({
  player,
  hidden,
}: {
  player: PlayerProjection;
  hidden: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: player.playerId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: hidden || isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Chip player={player} />
    </div>
  );
}

function Chip({
  player,
  overlay = false,
}: {
  player: PlayerProjection;
  overlay?: boolean;
}) {
  return (
    <div
      className={`flex max-w-[150px] cursor-grab touch-none select-none items-center gap-1.5 rounded-md border bg-zinc-800 px-1.5 py-1 text-xs transition active:cursor-grabbing sm:px-2 ${
        overlay
          ? "border-emerald-500/50 shadow-2xl"
          : "border-zinc-700 hover:border-zinc-500"
      }`}
    >
      <span
        className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] font-bold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
      >
        {player.position}
      </span>
      <span className="min-w-0 truncate font-medium text-zinc-100">
        {lastFirst(player.name)}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
        {player.team}
      </span>
    </div>
  );
}

// "Justin Jefferson" → "J. Jefferson" to keep chips compact (~3-4 per phone
// row) while staying unambiguous.
function lastFirst(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts.slice(1).join(" ");
  return `${parts[0][0]}. ${last}`;
}
