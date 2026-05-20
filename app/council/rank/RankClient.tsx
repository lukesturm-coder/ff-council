"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { Search, X, ArrowRight, Check } from "lucide-react";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { recordComparison, savePersonalRank } from "./actions";

// ---------------------------------------------------------------------------
// Beli-style tier + pairwise ranking client.
//
// State machine (one round per player):
//   1. "tier"     — show the next un-ranked player, ask which tier (S/A/B/C/D)
//   2. "compare"  — binary-search the player into their tier-slice via pairwise
//                   "who would you rather have" taps. ~ceil(log2(N)) taps.
//   3. "confirm"  — 1.2s flash: "Player slots in at #4 of your A-tier", then
//                   loop back to step 1 with the next un-ranked player.
//
// Persistence:
//   - Global ordered list is rewritten via savePersonalRank() after every
//     finalize. Uses useTransition so the UI keeps advancing while the
//     network write happens.
//   - Each pairwise tap also fires a player_comparisons insert so the
//     /rank Elo system gets signal from this flow.
// ---------------------------------------------------------------------------

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const CONFIRM_MS = 1200;

type TierLetter = "S" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
const TIERS: TierLetter[] = ["S", "A", "B", "C", "D", "E", "F", "G", "H"];
const TIER_RANK: Record<TierLetter, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
};

// TierMaker-standard color ramp: solid fills, dark text. S red → H blue.
const TIER_META: Record<
  TierLetter,
  { label: string; hex: string }
> = {
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

type ExistingRanks = Partial<
  Record<ScoringSystem, Record<number, { rank: number; tier: string | null }>>
>;

function asTierLetter(t: string | null): TierLetter | null {
  return t != null && (TIERS as string[]).includes(t) ? (t as TierLetter) : null;
}

// One scoring system's working state. `ordered` is the canonical global rank
// list (rank 1..N = ordered[0..N-1]). `tierOf` is the in-session tier letter
// map; legacy players hydrated from supabase have no tier letter.
type ScoringState = {
  ordered: number[];
  tierOf: Map<number, TierLetter>;
};

type FlowState =
  | { kind: "tier"; playerId: number }
  | {
      kind: "compare";
      playerId: number;
      tier: TierLetter;
      low: number;
      high: number;
      tierSlice: number[]; // playerIds in the chosen tier at flow-start
    }
  | {
      kind: "confirm";
      playerId: number;
      tier: TierLetter;
      tierPosition: number; // 1-indexed within tier
      tierSize: number;
    };

export default function RankClient({
  projections,
  existingRanks,
}: {
  projections: PlayerProjection[];
  existingRanks: ExistingRanks;
}) {
  // Indexed lookups.
  const playerMap = useMemo(() => {
    const m = new Map<number, PlayerProjection>();
    for (const p of projections) m.set(p.playerId, p);
    return m;
  }, [projections]);

  // Auto-pool order: by PPR vegas fpts desc (most-relevant scoring), with
  // alphabetical fallback for players without vegas data. We compute this
  // per-scoring system so the auto-served order matches the active scoring.
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

  // Initialize working state from supabase data — one ScoringState per scoring
  // system. Existing ranks come in as {playerId: {rank, tier}}; we sort by rank
  // to recover the ordered array and rebuild the tier map so newly-ranked
  // players compare against existing tier members. Legacy rows (pre-migration
  // 018) carry tier=null and simply hydrate without a tier.
  const [states, setStates] = useState<Record<ScoringSystem, ScoringState>>(
    () => {
      const out: Record<ScoringSystem, ScoringState> = {
        PPR: { ordered: [], tierOf: new Map() },
        Half: { ordered: [], tierOf: new Map() },
        Standard: { ordered: [], tierOf: new Map() },
      };
      for (const s of SCORING_OPTIONS) {
        const dict = existingRanks[s] ?? {};
        const entries = Object.entries(dict)
          .map(([pid, e]) => ({
            playerId: Number(pid),
            rank: e.rank,
            tier: asTierLetter(e.tier),
          }))
          .sort((a, b) => a.rank - b.rank);
        const tierOf = new Map<number, TierLetter>();
        for (const e of entries) {
          if (e.tier) tierOf.set(e.playerId, e.tier);
        }
        out[s] = {
          ordered: entries.map((e) => e.playerId),
          tierOf,
        };
      }
      return out;
    },
  );

  const [scoring, setScoring] = useState<ScoringSystem>("PPR");
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [, startSaveTransition] = useTransition();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const currentState = states[scoring];
  const totalPlayers = projections.length;
  const rankedCount = currentState.ordered.length;
  const remaining = totalPlayers - rankedCount;

  // Auto-pick the next un-ranked player (used to seed/refresh State 1).
  const pickNextPlayerId = useCallback(
    (state: ScoringState, scoringSys: ScoringSystem): number | null => {
      const rankedSet = new Set(state.ordered);
      for (const pid of poolOrderByScoring[scoringSys]) {
        if (!rankedSet.has(pid)) return pid;
      }
      return null;
    },
    [poolOrderByScoring],
  );

  // On mount AND whenever scoring changes, ensure the flow is in State 1
  // showing the next un-ranked player for that scoring system.
  // (We deliberately don't preserve in-flight compare state across scoring
  // swaps — the tier-slice is per-scoring, so resuming would be confusing.)
  useEffect(() => {
    const next = pickNextPlayerId(states[scoring], scoring);
    if (next == null) {
      setFlow(null);
    } else {
      setFlow({ kind: "tier", playerId: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring]);

  // Persist the user's ordered list (with tier letters). Fire-and-forget.
  const persistOrder = useCallback(
    (
      nextOrdered: number[],
      scoringSys: ScoringSystem,
      tierOf: Map<number, TierLetter>,
    ) => {
      const ranks = nextOrdered.map((playerId, idx) => ({
        playerId,
        rank: idx + 1,
        tier: tierOf.get(playerId) ?? null,
      }));
      startSaveTransition(async () => {
        const res = await savePersonalRank({ scoring: scoringSys, ranks });
        if (!res.ok) {
          setSavedMsg(`Save failed: ${res.error}`);
        } else {
          // Soft "saved" indicator — clears itself shortly.
          setSavedMsg(null);
        }
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // State 1 → State 2 transition: user picks a tier.
  // -------------------------------------------------------------------------
  const handleTierPick = useCallback(
    (tier: TierLetter) => {
      if (!flow || flow.kind !== "tier") return;
      const playerId = flow.playerId;
      const tierSlice = currentState.ordered.filter(
        (pid) => currentState.tierOf.get(pid) === tier,
      );

      if (tierSlice.length === 0) {
        // Empty tier — skip State 2 entirely. The player goes straight in.
        finalizePlayer(playerId, tier, /* sliceLocalIndex */ 0, []);
        return;
      }

      // Binary-search insert window: [0, tierSlice.length].
      setFlow({
        kind: "compare",
        playerId,
        tier,
        low: 0,
        high: tierSlice.length,
        tierSlice,
      });
    },
    // finalizePlayer is defined below; declared as a useCallback with the
    // same closure inputs so the dep array would create a cycle. We use a
    // ref-style indirection via the function-hoist trick below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow, currentState],
  );

  // -------------------------------------------------------------------------
  // Finalize: insert the new player into the global ordered list at the
  // correct global index based on its tier letter and tier-local position.
  // -------------------------------------------------------------------------
  const finalizePlayer = useCallback(
    (
      playerId: number,
      tier: TierLetter,
      sliceLocalIndex: number,
      tierSlice: number[],
    ) => {
      // Compute the next ordering from the latest committed state (closure),
      // NOT inside the setStates updater — firing persistOrder (a transition)
      // from within an updater runs a state update during render, which can
      // wedge the transition queue and freeze the flow.
      const cur = currentState;
      const nextTierOf = new Map(cur.tierOf);
      nextTierOf.set(playerId, tier);

      const globalIndex = computeGlobalInsertIndex(
        cur.ordered,
        cur.tierOf,
        tier,
        sliceLocalIndex,
        tierSlice,
      );
      const nextOrdered = [
        ...cur.ordered.slice(0, globalIndex),
        playerId,
        ...cur.ordered.slice(globalIndex),
      ];

      setStates((prev) => ({
        ...prev,
        [scoring]: { ordered: nextOrdered, tierOf: nextTierOf },
      }));
      // Persist AFTER the state update is queued, outside the updater.
      persistOrder(nextOrdered, scoring, nextTierOf);

      // Tier-local position (1-indexed) for the confirm flash.
      const tierPosition = sliceLocalIndex + 1;
      const tierSize = tierSlice.length + 1;
      setFlow({ kind: "confirm", playerId, tier, tierPosition, tierSize });
    },
    [scoring, persistOrder, currentState],
  );

  // -------------------------------------------------------------------------
  // State 2 tap: binary-search step.
  // -------------------------------------------------------------------------
  const handleCompareTap = useCallback(
    (winnerSide: "new" | "opponent") => {
      if (!flow || flow.kind !== "compare") return;
      const { playerId, tier, low, high, tierSlice } = flow;
      const mid = Math.floor((low + high) / 2);
      const opponentId = tierSlice[mid];
      if (opponentId == null) return;

      // Fire the comparison off to supabase for the Elo system.
      const winnerId = winnerSide === "new" ? playerId : opponentId;
      const loserId = winnerSide === "new" ? opponentId : playerId;
      startSaveTransition(async () => {
        await recordComparison({
          winnerId,
          loserId,
          scoring,
        });
      });

      // Narrow the window. If the new player wins, it sits at or before mid
      // (higher in the order = better rank); if it loses, it sits after mid.
      let nextLow = low;
      let nextHigh = high;
      if (winnerSide === "new") {
        nextHigh = mid;
      } else {
        nextLow = mid + 1;
      }

      if (nextLow >= nextHigh) {
        // Window collapsed — insertion position found.
        finalizePlayer(playerId, tier, nextLow, tierSlice);
      } else {
        setFlow({
          kind: "compare",
          playerId,
          tier,
          low: nextLow,
          high: nextHigh,
          tierSlice,
        });
      }
    },
    [flow, scoring, finalizePlayer],
  );

  // -------------------------------------------------------------------------
  // State 3 timer: advance to State 1 with the next un-ranked player.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!flow || flow.kind !== "confirm") return;
    const t = window.setTimeout(() => {
      // Pick next un-ranked. NB: states already includes the just-finalized
      // player, so this lookup naturally skips it.
      const nextId = pickNextPlayerId(states[scoring], scoring);
      if (nextId == null) {
        setFlow(null);
      } else {
        setFlow({ kind: "tier", playerId: nextId });
      }
    }, CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [flow, states, scoring, pickNextPlayerId]);

  // -------------------------------------------------------------------------
  // Skip: move the current un-ranked player to the bottom of the queue
  // (so the next call to pickNextPlayerId returns a different player).
  // We do this by adding the player to a "skipped" set we walk past.
  // For Phase 1 we just compute the next-after-this player.
  // -------------------------------------------------------------------------
  const [skippedInSession, setSkippedInSession] = useState<Set<number>>(
    new Set(),
  );
  const handleSkip = useCallback(() => {
    if (!flow || flow.kind !== "tier") return;
    const skippedNext = new Set(skippedInSession);
    skippedNext.add(flow.playerId);
    setSkippedInSession(skippedNext);

    // Pick a different un-ranked player respecting the skip set.
    const rankedSet = new Set(currentState.ordered);
    for (const pid of poolOrderByScoring[scoring]) {
      if (rankedSet.has(pid)) continue;
      if (skippedNext.has(pid)) continue;
      setFlow({ kind: "tier", playerId: pid });
      return;
    }
    // All remaining un-ranked players are skipped — clear the set and re-pick.
    setSkippedInSession(new Set());
    const next = pickNextPlayerId(currentState, scoring);
    setFlow(next == null ? null : { kind: "tier", playerId: next });
  }, [
    flow,
    skippedInSession,
    currentState,
    poolOrderByScoring,
    scoring,
    pickNextPlayerId,
  ]);

  // -------------------------------------------------------------------------
  // Search: jump to a specific player. Allowed only from State 1 (and the
  // user can also open search from State 2 to bail out — but Phase 1 keeps
  // it simple: search button is visible from State 1 only).
  // -------------------------------------------------------------------------
  const handlePickSpecificPlayer = useCallback(
    (playerId: number) => {
      setSearchOpen(false);
      setSearchQuery("");
      // If the player is already ranked, we still let the user re-rank — we
      // remove them from the ordered list (and their tier letter) first.
      const cur = currentState;
      if (cur.ordered.includes(playerId)) {
        const nextOrdered = cur.ordered.filter((p) => p !== playerId);
        const nextTierOf = new Map(cur.tierOf);
        nextTierOf.delete(playerId);
        setStates((prev) => ({
          ...prev,
          [scoring]: { ordered: nextOrdered, tierOf: nextTierOf },
        }));
        persistOrder(nextOrdered, scoring, nextTierOf);
      }
      setFlow({ kind: "tier", playerId });
    },
    [scoring, persistOrder, currentState],
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return projections
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, projections]);

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Scoring toggle + progress bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
            Scoring
          </span>
          {SCORING_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setScoring(s)}
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
          href="/council?view=board"
          className="text-xs text-zinc-500 transition hover:text-zinc-300"
          title="Drag players into tier rows"
        >
          Prefer dragging? Tier board →
        </Link>

        {savedMsg && (
          <span className="ml-auto text-xs text-rose-400">{savedMsg}</span>
        )}
      </div>

      <ProgressBar ranked={rankedCount} total={totalPlayers} />

      {/* Search */}
      <SearchBar
        open={searchOpen}
        query={searchQuery}
        results={searchResults}
        onOpen={() => setSearchOpen(true)}
        onClose={() => {
          setSearchOpen(false);
          setSearchQuery("");
        }}
        onQueryChange={setSearchQuery}
        onPick={handlePickSpecificPlayer}
      />

      {/* Main flow */}
      {flow == null ? (
        <DoneState totalRanked={rankedCount} />
      ) : flow.kind === "tier" ? (
        <TierStateView
          player={playerMap.get(flow.playerId)!}
          scoring={scoring}
          onTierPick={handleTierPick}
          onSkip={handleSkip}
        />
      ) : flow.kind === "compare" ? (
        <CompareStateView
          player={playerMap.get(flow.playerId)!}
          opponent={
            playerMap.get(flow.tierSlice[Math.floor((flow.low + flow.high) / 2)])!
          }
          tier={flow.tier}
          tierMid={Math.floor((flow.low + flow.high) / 2)}
          tierSize={flow.tierSlice.length}
          onPick={handleCompareTap}
          scoring={scoring}
        />
      ) : (
        <ConfirmStateView
          player={playerMap.get(flow.playerId)!}
          tier={flow.tier}
          tierPosition={flow.tierPosition}
          tierSize={flow.tierSize}
        />
      )}

      <p className="text-[11px] text-zinc-600">
        {remaining === 0
          ? "All players ranked. Switch scoring or revisit your list any time."
          : "Your ranking auto-saves after every player."}
      </p>
    </div>
  );
}

// ===========================================================================
// Sub-components
// ===========================================================================

function ProgressBar({ ranked, total }: { ranked: number; total: number }) {
  const pct = total === 0 ? 0 : Math.min(100, (ranked / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs text-zinc-400">
        <span>
          <span className="font-mono text-zinc-200">{ranked}</span> players
          ranked
          <span className="mx-2 text-zinc-700">·</span>
          <span className="font-mono text-zinc-200">
            {Math.max(0, total - ranked)}
          </span>{" "}
          to go
        </span>
        <span className="font-mono text-zinc-500">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full bg-emerald-500/70 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SearchBar({
  open,
  query,
  results,
  onOpen,
  onClose,
  onQueryChange,
  onPick,
}: {
  open: boolean;
  query: string;
  results: PlayerProjection[];
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (q: string) => void;
  onPick: (playerId: number) => void;
}) {
  return (
    <div className="relative">
      {!open ? (
        <button
          onClick={onOpen}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
        >
          <Search className="h-4 w-4" />
          <span>Jump to specific player…</span>
        </button>
      ) : (
        <div className="rounded-lg border border-emerald-500/40 bg-zinc-900 ring-1 ring-emerald-500/20">
          <div className="flex items-center gap-2 px-3 py-2">
            <Search className="h-4 w-4 text-emerald-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search by name…"
              className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
            <button
              onClick={onClose}
              className="text-zinc-500 transition hover:text-zinc-300"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {results.length > 0 && (
            <ul className="border-t border-zinc-800">
              {results.map((p) => (
                <li key={p.playerId}>
                  <button
                    onClick={() => onPick(p.playerId)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-zinc-800"
                  >
                    <span className="flex-1 truncate text-zinc-100">
                      {p.name}
                    </span>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                    >
                      {p.position}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      {p.team}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TierStateView({
  player,
  scoring,
  onTierPick,
  onSkip,
}: {
  player: PlayerProjection;
  scoring: ScoringSystem;
  onTierPick: (t: TierLetter) => void;
  onSkip: () => void;
}) {
  const fpts = player.fantasyPoints[scoring];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <HeadshotPlaceholder position={player.position} />
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Where does this player slot?
            </div>
            <h3 className="mt-0.5 truncate text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
              {player.name}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
              >
                {player.position}
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {player.team}
              </span>
              <span className="text-zinc-700">·</span>
              <span className="text-xs text-zinc-400">
                Vegas FPts:{" "}
                <span className="font-mono text-zinc-200">
                  {fpts > 0 ? fpts.toFixed(1) : "—"}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((t) => {
          const meta = TIER_META[t];
          return (
            <button
              key={t}
              onClick={() => onTierPick(t)}
              style={{ backgroundColor: meta.hex }}
              className="flex flex-col items-stretch justify-center gap-0.5 rounded-xl px-3 py-3 text-center text-zinc-900 ring-1 ring-inset ring-black/10 transition hover:brightness-105"
            >
              <span className="text-lg font-bold sm:text-xl">{t}</span>
              <span className="text-[11px] font-medium leading-tight opacity-75">
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-center">
        <button
          onClick={onSkip}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 transition hover:text-zinc-300"
        >
          Skip for now <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function CompareStateView({
  player,
  opponent,
  tier,
  tierMid,
  tierSize,
  onPick,
  scoring,
}: {
  player: PlayerProjection;
  opponent: PlayerProjection;
  tier: TierLetter;
  tierMid: number;
  tierSize: number;
  onPick: (s: "new" | "opponent") => void;
  scoring: ScoringSystem;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h3 className="text-xl font-semibold text-zinc-100 sm:text-2xl">
          Who would you rather have?
        </h3>
        <p className="text-xs text-zinc-500">
          Comparing against{" "}
          <span className="text-zinc-300">{opponent.name}</span>
          <span className="mx-1.5 text-zinc-700">·</span>#{tierMid + 1} of{" "}
          {tierSize} in your{" "}
          <span className="text-zinc-300">{tier}-tier</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <CompareCard
          player={player}
          scoring={scoring}
          label="New"
          onClick={() => onPick("new")}
        />
        <CompareCard
          player={opponent}
          scoring={scoring}
          label={`${tier}-tier #${tierMid + 1}`}
          onClick={() => onPick("opponent")}
        />
      </div>
    </div>
  );
}

function CompareCard({
  player,
  scoring,
  label,
  onClick,
}: {
  player: PlayerProjection;
  scoring: ScoringSystem;
  label: string;
  onClick: () => void;
}) {
  const fpts = player.fantasyPoints[scoring];
  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-emerald-500/40 hover:bg-zinc-800/40 active:scale-[0.99] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <HeadshotPlaceholder position={player.position} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">
            {label}
          </div>
          <div className="mt-0.5 truncate text-lg font-semibold text-zinc-100 group-hover:text-emerald-200 sm:text-xl">
            {player.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
            >
              {player.position}
            </span>
            <span className="font-mono text-zinc-400">{player.team}</span>
          </div>
        </div>
      </div>
      <div className="text-xs text-zinc-500">
        Vegas FPts:{" "}
        <span className="font-mono text-zinc-300">
          {fpts > 0 ? fpts.toFixed(1) : "—"}
        </span>
      </div>
    </button>
  );
}

function ConfirmStateView({
  player,
  tier,
  tierPosition,
  tierSize,
}: {
  player: PlayerProjection;
  tier: TierLetter;
  tierPosition: number;
  tierSize: number;
}) {
  const meta = TIER_META[tier];
  return (
    <div
      style={{ borderColor: meta.hex }}
      className="flex flex-col items-center gap-3 rounded-2xl border-2 bg-zinc-900 px-6 py-10"
    >
      <Check className="h-10 w-10 text-emerald-400" />
      <div className="text-center">
        <div className="text-lg font-semibold text-zinc-100 sm:text-xl">
          {firstName(player.name)} slots in at #{tierPosition} of your{" "}
          <span style={{ color: meta.hex }} className="font-bold">
            {tier}-tier
          </span>
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {tierPosition} of {tierSize}
        </div>
      </div>
    </div>
  );
}

function DoneState({ totalRanked }: { totalRanked: number }) {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-6 py-10 text-center">
      <Check className="mx-auto h-10 w-10 text-emerald-400" />
      <div className="mt-3 text-lg font-semibold text-zinc-100">
        You ranked all {totalRanked} players for this scoring system.
      </div>
      <div className="mt-1 text-xs text-zinc-400">
        Switch scoring above to rank another, or pull up the{" "}
        <Link
          href="/council?view=board"
          className="text-emerald-300 underline-offset-4 hover:underline"
        >
          tier board
        </Link>{" "}
        to make tweaks.
      </div>
    </div>
  );
}

function HeadshotPlaceholder({ position }: { position: FantasyPosition }) {
  return (
    <div
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 ring-inset sm:h-16 sm:w-16 sm:text-base ${POSITION_STYLES[position]}`}
    >
      {position}
    </div>
  );
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/**
 * Compute the global index at which to splice the new player into the ordered
 * list.
 *
 *   - If `tierSlice` is non-empty, the global index is the position in
 *     `ordered` of `tierSlice[sliceLocalIndex]`, or (one past the last slice
 *     member in `ordered`) when sliceLocalIndex == tierSlice.length.
 *   - If `tierSlice` is empty (no prior in-session player in this tier),
 *     insert at the boundary defined by neighbouring tier letters:
 *       - After the LAST in-session player whose tier letter ranks ABOVE this
 *         tier (S=0 < A=1 < B=2 < C=3 < D=4 — smaller rank number = better
 *         tier = appears earlier in `ordered`).
 *       - If no such player exists, at position 0.
 *
 * Legacy null-tier players don't influence the insertion logic; they shift
 * passively when their slot index moves.
 */
function computeGlobalInsertIndex(
  ordered: number[],
  tierOf: Map<number, TierLetter>,
  tier: TierLetter,
  sliceLocalIndex: number,
  tierSlice: number[],
): number {
  if (tierSlice.length > 0) {
    if (sliceLocalIndex < tierSlice.length) {
      const anchorPid = tierSlice[sliceLocalIndex];
      const idx = ordered.indexOf(anchorPid);
      return idx >= 0 ? idx : ordered.length;
    } else {
      const lastPid = tierSlice[tierSlice.length - 1];
      const idx = ordered.indexOf(lastPid);
      return idx >= 0 ? idx + 1 : ordered.length;
    }
  }

  // Empty tier slice: find boundary via tier-letter precedence.
  const thisRank = TIER_RANK[tier];
  let lastBetterIdx = -1;
  for (let i = 0; i < ordered.length; i++) {
    const t = tierOf.get(ordered[i]);
    if (t && TIER_RANK[t] <= thisRank) {
      lastBetterIdx = i;
    }
  }
  return lastBetterIdx + 1;
}

function firstName(fullName: string): string {
  const parts = fullName.split(" ");
  return parts[0] ?? fullName;
}
