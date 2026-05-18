"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FantasyPosition, ScoringSystem } from "@/lib/types";
import { castComparison, fetchPairBatch, type Pair } from "./actions";

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
const BATCH_SIZE = 20;
const REFILL_THRESHOLD = 5;
const ANON_DAILY_LIMIT = 100;
const FLASH_MS = 300;
const K_FACTOR = 32;
const STORAGE_KEY = "ffc-rank-comparisons-today";

// Mirrors the position color map used across the app so the chip looks
// identical to what people see on /rankings.
const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

type AnonCounter = { day: string; count: number };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readAnonCounter(): AnonCounter {
  if (typeof window === "undefined") return { day: todayKey(), count: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { day: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as AnonCounter;
    if (parsed.day !== todayKey()) return { day: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { day: todayKey(), count: 0 };
  }
}

function writeAnonCounter(c: AnonCounter) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // localStorage can throw in private mode / quota — silently ignore.
  }
}

/**
 * Predicted Elo delta for the winner under the K=32 chess convention. We
 * don't know the actual current Elos client-side (the trigger holds them),
 * so we render the assumed-equal case: ±16. Close enough to feel honest
 * for a 300ms flash, and we trust the server math for the real ladder.
 */
const FLASH_DELTA = K_FACTOR / 2;

export default function RankClient({
  initialPairs,
  initialScoring,
}: {
  initialPairs: Pair[];
  initialScoring: ScoringSystem;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL-stateful scoring selector: read on mount, write on change.
  const urlScoring = (searchParams.get("scoring") as ScoringSystem | null) ?? null;
  const [scoring, setScoring] = useState<ScoringSystem>(
    urlScoring && SCORING_OPTIONS.includes(urlScoring) ? urlScoring : initialScoring,
  );
  const [queue, setQueue] = useState<Pair[]>(initialPairs);
  const [todayCount, setTodayCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [anonLimited, setAnonLimited] = useState(false);
  const [flash, setFlash] = useState<null | {
    winnerSide: "a" | "b";
    pairId: string;
  }>(null);
  const [, startTransition] = useTransition();

  // Track refills in flight so we don't double-fire when the queue drops past
  // the threshold during a render burst.
  const refillingRef = useRef(false);

  // Sync today's count from localStorage on mount.
  useEffect(() => {
    const c = readAnonCounter();
    setTodayCount(c.count);
    if (c.count >= ANON_DAILY_LIMIT) setAnonLimited(true);
  }, []);

  // Keep URL in sync with scoring selector (replace, not push, so back-button
  // still escapes the page in one step).
  useEffect(() => {
    const current = searchParams.get("scoring");
    if (current === scoring) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("scoring", scoring);
    router.replace(`/rank?${params.toString()}`, { scroll: false });
  }, [scoring, router, searchParams]);

  // When scoring changes, throw out the old queue (it was sampled against the
  // PPR Elo distribution) and fetch a fresh batch for the new system.
  const lastScoringRef = useRef<ScoringSystem>(scoring);
  useEffect(() => {
    if (lastScoringRef.current === scoring) return;
    lastScoringRef.current = scoring;
    setQueue([]);
    refillingRef.current = true;
    fetchPairBatch({ scoringSystem: scoring, batchSize: BATCH_SIZE })
      .then((next) => setQueue(next))
      .finally(() => {
        refillingRef.current = false;
      });
  }, [scoring]);

  // Top up the queue when it gets low. Fire-and-forget; the user keeps voting
  // out of the current queue while the network roundtrip completes.
  useEffect(() => {
    if (refillingRef.current) return;
    if (queue.length > REFILL_THRESHOLD) return;
    if (anonLimited) return;
    refillingRef.current = true;
    fetchPairBatch({ scoringSystem: scoring, batchSize: BATCH_SIZE })
      .then((next) => setQueue((q) => [...q, ...next]))
      .finally(() => {
        refillingRef.current = false;
      });
  }, [queue.length, scoring, anonLimited]);

  const current = queue[0];
  const pairId = current
    ? `${current.a.playerId}-${current.b.playerId}`
    : "empty";

  const handlePick = useCallback(
    (side: "a" | "b") => {
      if (!current) return;
      const winner = side === "a" ? current.a : current.b;
      const loser = side === "a" ? current.b : current.a;

      // Anon rate limit. Check BEFORE optimistic advance so the soft block
      // shows immediately rather than after one final vote leaks through.
      const counter = readAnonCounter();
      if (counter.count >= ANON_DAILY_LIMIT) {
        setAnonLimited(true);
        return;
      }
      const nextCounter = { day: todayKey(), count: counter.count + 1 };
      writeAnonCounter(nextCounter);
      setTodayCount(nextCounter.count);
      setSessionCount((s) => s + 1);

      // Flash the predicted delta, then advance. We swap pairs at the end of
      // the flash window so the user sees the +/- before the cards change.
      setFlash({ winnerSide: side, pairId });
      window.setTimeout(() => {
        setQueue((q) => q.slice(1));
        setFlash(null);
      }, FLASH_MS);

      // Fire-and-forget DB write inside a transition so React doesn't block
      // the UI on the network call. We don't surface server errors to the
      // user — a dropped vote is a non-event at this scale.
      startTransition(() => {
        void castComparison({
          winnerId: winner.playerId,
          loserId: loser.playerId,
          scoringSystem: scoring,
        });
      });
    },
    [current, pairId, scoring],
  );

  // Keyboard shortcuts: ← / → pick the left or right card. Ignored when the
  // user is typing into any input (none on this page today, but cheap insurance).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (anonLimited) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePick("a");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handlePick("b");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlePick, anonLimited]);

  return (
    <div className="space-y-6">
      <Header
        scoring={scoring}
        onScoringChange={setScoring}
        todayCount={todayCount}
        sessionCount={sessionCount}
      />

      {anonLimited ? (
        <LimitNotice />
      ) : current ? (
        <PairBoard pair={current} pairId={pairId} flash={flash} onPick={handlePick} scoring={scoring} />
      ) : (
        <EmptyState />
      )}

      <FooterHint />
    </div>
  );
}

function Header({
  scoring,
  onScoringChange,
  todayCount,
  sessionCount,
}: {
  scoring: ScoringSystem;
  onScoringChange: (s: ScoringSystem) => void;
  todayCount: number;
  sessionCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Who would you rather have?
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Pick one. The next pair appears instantly. The council&rsquo;s Elo
          ladder updates in real time.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
            Scoring
          </span>
          {SCORING_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onScoringChange(opt)}
              className={`whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition ${
                scoring === opt
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <div className="text-xs text-zinc-500">
          You this session:{" "}
          <span className="font-mono text-zinc-300">{sessionCount}</span>
          <span className="mx-2 text-zinc-700">·</span>
          Today:{" "}
          <span className="font-mono text-zinc-300">{todayCount}</span>
        </div>
      </div>
    </div>
  );
}

function PairBoard({
  pair,
  pairId,
  flash,
  onPick,
  scoring,
}: {
  pair: Pair;
  pairId: string;
  flash: null | { winnerSide: "a" | "b"; pairId: string };
  onPick: (side: "a" | "b") => void;
  scoring: ScoringSystem;
}) {
  const showFlash = flash && flash.pairId === pairId;
  return (
    <div className="relative">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6">
        <PlayerCard
          player={pair.a}
          scoring={scoring}
          onClick={() => onPick("a")}
          delta={showFlash ? (flash.winnerSide === "a" ? +FLASH_DELTA : -FLASH_DELTA) : null}
          shortcut="←"
        />
        <PlayerCard
          player={pair.b}
          scoring={scoring}
          onClick={() => onPick("b")}
          delta={showFlash ? (flash.winnerSide === "b" ? +FLASH_DELTA : -FLASH_DELTA) : null}
          shortcut="→"
        />
      </div>

      {/* Desktop divider: a subtle VS in the gap between the two cards. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 items-center sm:flex"
      >
        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          vs
        </span>
      </div>

      {/* Mobile divider: stacked layout gets "or" between the two cards. */}
      <div
        aria-hidden
        className="my-2 flex items-center justify-center sm:hidden"
      >
        <span className="font-mono text-xs uppercase tracking-widest text-zinc-600">
          or
        </span>
      </div>
    </div>
  );
}

function PlayerCard({
  player,
  scoring,
  onClick,
  delta,
  shortcut,
}: {
  player: Pair["a"];
  scoring: ScoringSystem;
  onClick: () => void;
  delta: number | null;
  shortcut: string;
}) {
  const fpts = player.fantasyPoints[scoring];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[16rem] flex-col items-start justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-left transition hover:border-emerald-500/40 hover:bg-zinc-900/80 hover:shadow-[0_0_40px_-12px_rgba(16,185,129,0.35)] focus:outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500/40 sm:min-h-[22rem] sm:p-8"
    >
      <div className="flex w-full items-center justify-between">
        <span
          className={`inline-flex items-center rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ring-inset ${POSITION_STYLES[player.position]}`}
        >
          {player.position}
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400 sm:inline">
          {shortcut}
        </span>
      </div>

      <div className="mt-4 w-full">
        <div className="text-2xl font-bold leading-tight text-zinc-100 sm:text-3xl">
          {player.name}
        </div>
        <div className="mt-2 font-mono text-sm text-zinc-500">
          {player.team}
        </div>
      </div>

      <div className="mt-6 flex w-full items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Vegas FPts ({scoring})
        </span>
        <span className="font-mono text-base font-semibold tabular-nums text-zinc-200">
          {fpts.toFixed(1)}
        </span>
      </div>

      {delta != null && (
        <span
          aria-hidden
          className={`pointer-events-none absolute right-4 top-4 font-mono text-lg font-bold tabular-nums sm:text-2xl ${
            delta > 0 ? "text-emerald-300" : "text-rose-400"
          }`}
        >
          {delta > 0 ? "+" : ""}
          {Math.round(delta)}
        </span>
      )}
    </button>
  );
}

function LimitNotice() {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
      <div className="text-lg font-semibold text-zinc-100">
        You&rsquo;ve hit today&rsquo;s anonymous limit.
      </div>
      <p className="mt-2 text-sm text-zinc-400">
        That&rsquo;s {ANON_DAILY_LIMIT} comparisons logged — nice. Sign in to
        keep ranking and get credit for your contributions on the leaderboard.
      </p>
      <a
        href="/login"
        className="mt-4 inline-flex rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30"
      >
        Sign in to keep ranking
      </a>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-400">
      Loading the next pair&hellip;
    </div>
  );
}

function FooterHint() {
  return (
    <p className="text-center text-xs text-zinc-600">
      Use{" "}
      <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
        ←
      </kbd>{" "}
      and{" "}
      <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
        →
      </kbd>{" "}
      to vote without lifting your hands off the keyboard.
    </p>
  );
}
