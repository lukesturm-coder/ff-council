"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TradeListCardButton,
  TradeModal,
  type TradeCardData,
} from "../trades/TradeListClient";
import {
  VerdictCardButton,
  VerdictModal,
  type VerdictCardData,
} from "../verdict/VerdictListClient";

// =====================================================================
// JudgeListClient — the unified case docket for /judge.
//
// Renders trade + verdict cards interleaved by created_at desc as a
// single chronological feed. Each card type uses its existing component
// (TradeListCardButton / VerdictCardButton) so the visual treatment
// stays untouched — the only new code is the dispatch + modal switcher.
//
// Modal state is a single index into the unified list. Advancing
// ("next case") cycles through trades AND verdicts in the same order
// the user sees them on the page.
//
// This is the restored CourtListClient (deleted in the Cases revert,
// commit 5836212) re-homed under /judge with relative imports adjusted.
// =====================================================================

const VOTED_STORAGE_KEY = "ffc-verdict-voted-scenarios";

export type CourtCase =
  | { kind: "trade"; created_at: string; closed: boolean; data: TradeCardData }
  | {
      kind: "verdict";
      created_at: string;
      closed: boolean;
      data: VerdictCardData;
    };

function readVotedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VOTED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function persistVoted(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      VOTED_STORAGE_KEY,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    // ignore quota / privacy-mode failures
  }
}

type VoteFilter = "all" | "unvoted" | "voted";
const VOTE_FILTERS: Array<{ value: VoteFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unvoted", label: "To vote" },
  { value: "voted", label: "Voted" },
];

type StatusFilter = "all" | "open" | "closed";
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Any" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Resolved" },
];

type TypeFilter = "all" | "trade" | "verdict";
const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "trade", label: "Trades" },
  { value: "verdict", label: "Tough calls" },
];

export default function JudgeListClient({ cases }: { cases: CourtCase[] }) {
  const [votedIds, setVotedIds] = useState<Set<string>>(() => new Set());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // A frozen nav snapshot for the open modal: voting can move a card out of the
  // active filter, so we freeze the list + index when a card opens. That keeps
  // "Next" walking a stable sequence (and keeps the just-voted card on screen
  // for its reveal) instead of shifting underfoot.
  const [session, setSession] = useState<{
    list: CourtCase[];
    index: number;
  } | null>(null);

  // Hydrate the voted-id localStorage set after mount so SSR + client markup
  // match. Holds both trade and verdict ids (unique uuids, no collision).
  useEffect(() => {
    setVotedIds(readVotedSet());
  }, []);

  function markVoted(id: string) {
    setVotedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      persistVoted(next);
      return next;
    });
  }

  const visibleCases = useMemo(() => {
    return cases.filter((c) => {
      if (typeFilter !== "all" && c.kind !== typeFilter) return false;
      if (statusFilter === "open" && c.closed) return false;
      if (statusFilter === "closed" && !c.closed) return false;
      if (voteFilter === "voted" && !votedIds.has(c.data.id)) return false;
      if (voteFilter === "unvoted" && votedIds.has(c.data.id)) return false;
      return true;
    });
  }, [cases, typeFilter, voteFilter, statusFilter, votedIds]);

  function openByCase(c: CourtCase) {
    const idx = visibleCases.findIndex(
      (x) => x.kind === c.kind && x.data.id === c.data.id,
    );
    if (idx >= 0) setSession({ list: visibleCases, index: idx });
  }

  const openCase = session ? session.list[session.index] ?? null : null;
  const hasNext = session != null && session.index + 1 < session.list.length;
  const advance = () =>
    setSession((s) =>
      s && s.index + 1 < s.list.length ? { ...s, index: s.index + 1 } : s,
    );

  return (
    <>
      {/* Controls — one prominent type segmented control, then a single
          compact line for vote-state + status so the cases stay the hero. */}
      <div className="mb-4 space-y-2">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-sm">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={`rounded-md px-3.5 py-1.5 font-medium transition ${
                typeFilter === f.value
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
          {VOTE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setVoteFilter(f.value)}
              className={`rounded-full px-2.5 py-0.5 transition ${
                voteFilter === f.value
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-zinc-700">·</span>
          {STATUS_FILTERS.filter((f) => f.value !== "all").map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() =>
                setStatusFilter(statusFilter === f.value ? "all" : f.value)
              }
              className={`rounded-full px-2.5 py-0.5 transition ${
                statusFilter === f.value
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-zinc-600">
            {visibleCases.length}
          </span>
        </div>
      </div>

      {visibleCases.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-400">
          {statusFilter === "closed"
            ? "No resolved cases match yet."
            : voteFilter === "voted"
              ? "You haven't voted on any of these yet."
              : voteFilter === "unvoted"
                ? "You've weighed in on all of these. Nice."
                : "No cases."}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleCases.map((c) =>
            c.kind === "trade" ? (
              <TradeListCardButton
                key={`t-${c.data.id}`}
                trade={c.data}
                voted={votedIds.has(c.data.id)}
                onOpen={() => openByCase(c)}
              />
            ) : (
              <VerdictCardButton
                key={`v-${c.data.id}`}
                scenario={c.data}
                voted={votedIds.has(c.data.id)}
                onOpen={() => openByCase(c)}
              />
            ),
          )}
        </div>
      )}

      {openCase && session && openCase.kind === "trade" && (
        <TradeModal
          key={`t-${openCase.data.id}`}
          trade={openCase.data}
          position={session.index + 1}
          total={session.list.length}
          onVoted={() => markVoted(openCase.data.id)}
          onClose={() => setSession(null)}
          onNext={hasNext ? () => advance() : null}
        />
      )}

      {openCase && session && openCase.kind === "verdict" && (
        <VerdictModal
          key={`v-${openCase.data.id}`}
          scenario={openCase.data}
          alreadyVoted={votedIds.has(openCase.data.id)}
          position={session.index + 1}
          total={session.list.length}
          onVoted={() => markVoted(openCase.data.id)}
          onClose={() => setSession(null)}
          onNext={hasNext ? () => advance() : null}
        />
      )}
    </>
  );
}
