"use client";

import { useEffect, useState } from "react";
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

export default function JudgeListClient({ cases }: { cases: CourtCase[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(() => new Set());

  // Hydrate the verdict-vote localStorage set after mount so SSR + client
  // markup match. Trade votes are tracked DB-side only.
  useEffect(() => {
    setVotedIds(readVotedSet());
  }, []);

  function markVerdictVoted(scenarioId: string) {
    setVotedIds((prev) => {
      if (prev.has(scenarioId)) return prev;
      const next = new Set(prev);
      next.add(scenarioId);
      persistVoted(next);
      return next;
    });
  }

  function openByCase(c: CourtCase) {
    const idx = cases.findIndex(
      (x) => x.kind === c.kind && x.data.id === c.data.id,
    );
    if (idx >= 0) setOpenIndex(idx);
  }

  const openCase = openIndex != null ? cases[openIndex] : null;
  const hasNext = openIndex != null && openIndex + 1 < cases.length;
  const advance = () =>
    hasNext ? setOpenIndex((openIndex ?? 0) + 1) : undefined;

  return (
    <>
      <div className="space-y-3">
        {cases.map((c) =>
          c.kind === "trade" ? (
            <TradeListCardButton
              key={`t-${c.data.id}`}
              trade={c.data}
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

      {openCase && openCase.kind === "trade" && (
        <TradeModal
          key={`t-${openCase.data.id}`}
          trade={openCase.data}
          position={(openIndex ?? 0) + 1}
          total={cases.length}
          onClose={() => setOpenIndex(null)}
          onNext={hasNext ? () => advance() : null}
        />
      )}

      {openCase && openCase.kind === "verdict" && (
        <VerdictModal
          key={`v-${openCase.data.id}`}
          scenario={openCase.data}
          alreadyVoted={votedIds.has(openCase.data.id)}
          position={(openIndex ?? 0) + 1}
          total={cases.length}
          onVoted={() => markVerdictVoted(openCase.data.id)}
          onClose={() => setOpenIndex(null)}
          onNext={hasNext ? () => advance() : null}
        />
      )}
    </>
  );
}
