"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, Check } from "lucide-react";
import type { FantasyPosition } from "@/lib/types";
import VerdictVotePanel from "./VerdictVotePanel";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "./types";

// =====================================================================
// VerdictListClient — card grid + in-page voting modal.
// Mirrors trades/TradeListClient.tsx: cards open a modal, Escape /
// overlay click / X all close, body scroll locked while open, brief
// "Thanks!" state on successful vote then auto-close ~2.5s.
//
// localStorage dedup: we record which scenarios the current browser
// has voted on so anon users see a "Voted" badge on cards. The DB
// already de-dupes authed users via the unique constraint.
// =====================================================================

const VOTED_STORAGE_KEY = "ffc-verdict-voted-scenarios";

export type VerdictTally = {
  byPlayer: Record<number, number>;
  total: number;
};

export type VerdictCardData = {
  id: string;
  scenario_type: VerdictScenarioType;
  candidates: VerdictPlayer[];
  roster: VerdictPlayer[] | null;
  context: VerdictContext;
  notes: string | null;
  image_url: string | null;
  created_at: string;
  tally: VerdictTally;
};

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function scenarioLabel(type: VerdictScenarioType): string {
  return type === "draft" ? "Draft pick" : "Start/Sit";
}

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

export default function VerdictListClient({
  scenarios,
}: {
  scenarios: VerdictCardData[];
}) {
  const [open, setOpen] = useState<VerdictCardData | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(() => new Set());

  // Hydrate localStorage state once mounted (avoids SSR mismatch).
  useEffect(() => {
    setVotedIds(readVotedSet());
  }, []);

  function markVoted(scenarioId: string) {
    setVotedIds((prev) => {
      if (prev.has(scenarioId)) return prev;
      const next = new Set(prev);
      next.add(scenarioId);
      persistVoted(next);
      return next;
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3">
        {scenarios.map((s) => (
          <VerdictCardButton
            key={s.id}
            scenario={s}
            voted={votedIds.has(s.id)}
            onOpen={setOpen}
          />
        ))}
      </div>

      {open && (
        <VerdictModal
          scenario={open}
          alreadyVoted={votedIds.has(open.id)}
          onVoted={() => markVoted(open.id)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function VerdictCardButton({
  scenario,
  voted,
  onOpen,
}: {
  scenario: VerdictCardData;
  voted: boolean;
  onOpen: (s: VerdictCardData) => void;
}) {
  const total = scenario.tally.total;
  const topPick = useMemo(() => {
    let best: { player: VerdictPlayer; count: number } | null = null;
    for (const c of scenario.candidates) {
      const count = scenario.tally.byPlayer[c.player_id] ?? 0;
      if (!best || count > best.count) best = { player: c, count };
    }
    return best;
  }, [scenario]);

  const topPct =
    topPick && total > 0 ? Math.round((topPick.count / total) * 100) : 0;

  const verdictText =
    total === 0
      ? "No votes yet"
      : topPick
        ? `${topPct}% favor ${topPick.player.name}`
        : "No votes yet";

  const ctx = scenario.context;
  const meta: string[] = [];
  if (ctx.scoring) meta.push(ctx.scoring);
  if (scenario.scenario_type === "start_sit" && ctx.week != null) {
    meta.push(`Week ${ctx.week}`);
  }
  if (scenario.scenario_type === "draft") {
    if (ctx.round != null) meta.push(`Round ${ctx.round}`);
    if (ctx.position_needed) meta.push(`needs ${ctx.position_needed}`);
  }
  meta.push(new Date(scenario.created_at).toLocaleDateString());

  return (
    <button
      type="button"
      onClick={() => onOpen(scenario)}
      className="block w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:p-4"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
              {scenarioLabel(scenario.scenario_type)}
            </span>
            <span className="text-xs text-zinc-500">
              {scenario.candidates.length} options
            </span>
            {voted && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                <Check className="h-3 w-3" />
                Voted
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {scenario.candidates.slice(0, 4).map((c) => (
              <div key={c.player_id} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[c.position]}`}
                >
                  {c.position}
                </span>
                <span className="text-sm font-medium text-zinc-100">
                  {c.name}
                </span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {c.team}
                </span>
              </div>
            ))}
            {scenario.candidates.length > 4 && (
              <span className="text-xs text-zinc-600">
                +{scenario.candidates.length - 4}
              </span>
            )}
          </div>
          {scenario.notes && (
            <p className="mt-2 line-clamp-1 text-xs text-zinc-500">
              {scenario.notes}
            </p>
          )}
        </div>

        <div className="flex flex-row items-center justify-between gap-1 border-t border-zinc-800 pt-2 text-xs sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:pt-0">
          <span className="font-medium text-zinc-200">{verdictText}</span>
          <span className="text-zinc-500">
            {total} vote{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        {meta.map((m, i) => (
          <span key={i} className="flex items-center gap-x-2">
            {i > 0 && <span>·</span>}
            <span>{m}</span>
          </span>
        ))}
      </div>
    </button>
  );
}

function VerdictModal({
  scenario,
  alreadyVoted,
  onVoted,
  onClose,
}: {
  scenario: VerdictCardData;
  alreadyVoted: boolean;
  onVoted: () => void;
  onClose: () => void;
}) {
  const [thanks, setThanks] = useState(false);

  // Body scroll lock + Escape to close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Auto-close ~2.5s after successful vote.
  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(onClose, 2500);
    return () => clearTimeout(t);
  }, [thanks, onClose]);

  const ctx = scenario.context;
  const metaLine: string[] = [scenarioLabel(scenario.scenario_type)];
  if (ctx.scoring) metaLine.push(ctx.scoring);
  if (scenario.scenario_type === "start_sit" && ctx.week != null) {
    metaLine.push(`Week ${ctx.week}`);
  }
  if (scenario.scenario_type === "draft") {
    if (ctx.round != null) metaLine.push(`Round ${ctx.round}`);
    if (ctx.position_needed) metaLine.push(`needs ${ctx.position_needed}`);
    if (ctx.league_size != null) metaLine.push(`${ctx.league_size}-team`);
    if (ctx.slot_type) metaLine.push(ctx.slot_type);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700/60 bg-zinc-900 p-4 shadow-2xl shadow-emerald-900/10 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        {thanks ? (
          <div className="py-10 text-center">
            <h3 className="text-2xl font-bold text-emerald-300">Thanks!</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Your verdict has been recorded.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 pr-8">
              <h3 className="text-xl font-bold text-zinc-100 sm:text-2xl">
                {scenario.scenario_type === "draft"
                  ? "Who would you draft?"
                  : "Who would you start?"}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                {metaLine.join(" · ")}
              </p>
            </div>

            {scenario.image_url && (
              <div className="mb-4 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={scenario.image_url}
                  alt="Scenario screenshot"
                  className="w-full object-contain"
                />
              </div>
            )}

            {scenario.notes && (
              <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
                {scenario.notes}
              </div>
            )}

            {scenario.scenario_type === "draft" &&
              scenario.roster &&
              scenario.roster.length > 0 && (
                <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Current roster
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {scenario.roster.map((p) => (
                      <div
                        key={`r-${p.player_id}`}
                        className="flex items-center gap-1.5"
                      >
                        <span
                          className={`inline-flex shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                        >
                          {p.position}
                        </span>
                        <span className="text-sm text-zinc-200">{p.name}</span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {p.team}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            <VerdictVotePanel
              scenarioId={scenario.id}
              candidates={scenario.candidates}
              voteCounts={scenario.tally.byPlayer}
              totalVotes={scenario.tally.total}
              myPickPlayerId={null}
              onVoted={() => {
                onVoted();
                setThanks(true);
              }}
            />

            {alreadyVoted && (
              <p className="mt-3 text-xs text-zinc-500">
                You&apos;ve already voted in this scenario from this browser —
                tapping again will update your pick.
              </p>
            )}

            <div className="mt-4 flex items-center justify-end text-xs text-zinc-500">
              <Link
                href={`/verdict/${scenario.id}`}
                className="underline-offset-4 hover:text-zinc-300 hover:underline"
                onClick={onClose}
              >
                View full scenario →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
