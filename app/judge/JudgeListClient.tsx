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
  | { kind: "trade"; created_at: string; data: TradeCardData }
  | { kind: "verdict"; created_at: string; data: VerdictCardData };

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

export default function JudgeListClient({ cases }: { cases: CourtCase[] }) {
  const [votedIds, setVotedIds] = useState<Set<string>>(() => new Set());
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("all");
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
    if (voteFilter === "all") return cases;
    return cases.filter((c) =>
      voteFilter === "voted"
        ? votedIds.has(c.data.id)
        : !votedIds.has(c.data.id),
    );
  }, [cases, voteFilter, votedIds]);

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
      {/* Voted filter */}
      <div className="mb-3 flex items-center gap-1.5 text-xs">
        {VOTE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setVoteFilter(f.value)}
            className={`rounded-full px-3 py-1 font-medium transition ${
              voteFilter === f.value
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-500/40"
                : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-zinc-600">{visibleCases.length}</span>
      </div>

      {visibleCases.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-400">
          {voteFilter === "voted"
            ? "You haven't voted on any of these yet."
            : voteFilter === "unvoted"
              ? "You've weighed in on all of these. Nice."
              : "No cases."}
        </div>
      ) : (
        <div className="space-y-3">
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
