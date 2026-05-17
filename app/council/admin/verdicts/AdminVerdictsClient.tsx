"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "@/app/verdict/types";
import { relativeTimeShort } from "@/lib/relative-time";
import { resolveScenario, unresolveScenario } from "./actions";

// =====================================================================
// Admin verdicts grader — client component.
//
// Per-row form state lives in plain useState maps keyed by scenarioId,
// so navigating between rows doesn't clobber an in-progress selection.
// All mutations route through server actions in ./actions.ts which
// re-check is_admin before touching the DB.
// =====================================================================

export type AdminVerdictRow = {
  id: string;
  scenarioType: VerdictScenarioType;
  candidates: VerdictPlayer[];
  context: VerdictContext;
  notes: string | null;
  createdAt: string;
  actualWinnerPlayerId: number | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function scenarioSummary(type: VerdictScenarioType, ctx: VerdictContext): string {
  if (type === "draft") {
    const round = ctx.round ? `Round ${ctx.round}` : "Draft pick";
    const need = ctx.position_needed ? ` — ${ctx.position_needed} needed` : "";
    return `${round}${need}`;
  }
  const week = ctx.week ? `Week ${ctx.week}` : "Start/Sit";
  const slot = ctx.slot_type ? ` ${ctx.slot_type}` : "";
  return `Start/Sit — ${week}${slot}`.replace(/\s+/g, " ").trim();
}

export default function AdminVerdictsClient({
  unresolved,
  resolved,
  page,
  totalPages,
  totalUnresolved,
}: {
  unresolved: AdminVerdictRow[];
  resolved: AdminVerdictRow[];
  page: number;
  totalPages: number;
  totalUnresolved: number;
}) {
  // Per-row pick + note. Map<scenarioId, ...>.
  const [picks, setPicks] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [, startTransition] = useTransition();

  function withBusy(
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setBusyId(id);
    setErrorMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setErrorMsg(res.error);
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-6">
      {errorMsg && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">
          {errorMsg}
        </p>
      )}

      {/* Unresolved scenarios */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Unresolved ({totalUnresolved})
          </h3>
          {totalPages > 1 && (
            <p className="text-xs text-zinc-500">
              Page {page} of {totalPages}
            </p>
          )}
        </div>

        {unresolved.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-400">
            Nothing to grade right now.
          </div>
        ) : (
          <ul className="space-y-3">
            {unresolved.map((s) => {
              const pick = picks[s.id] ?? null;
              const note = notes[s.id] ?? "";
              const isBusy = busyId === s.id;
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5"
                >
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">
                        {scenarioSummary(s.scenarioType, s.context)}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Posted {relativeTimeShort(s.createdAt)} ·{" "}
                        <Link
                          href={`/verdict/${s.id}`}
                          className="text-zinc-400 underline-offset-4 hover:text-emerald-300 hover:underline"
                        >
                          View scenario
                        </Link>
                      </p>
                    </div>
                  </div>

                  {s.notes && (
                    <p className="mb-3 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/40 p-2 text-xs text-zinc-300">
                      {s.notes}
                    </p>
                  )}

                  <fieldset className="space-y-1.5">
                    <legend className="mb-1 text-xs uppercase tracking-wider text-zinc-500">
                      Actual winner
                    </legend>
                    {s.candidates.map((c) => {
                      const checked = pick === c.player_id;
                      return (
                        <label
                          key={c.player_id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition ${
                            checked
                              ? "border-emerald-500/40 bg-emerald-500/10"
                              : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`winner-${s.id}`}
                            value={c.player_id}
                            checked={checked}
                            onChange={() =>
                              setPicks((prev) => ({
                                ...prev,
                                [s.id]: c.player_id,
                              }))
                            }
                            className="accent-emerald-500"
                          />
                          <span
                            className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                              POSITION_STYLES[c.position] ??
                              "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
                            }`}
                          >
                            {c.position}
                          </span>
                          <span className="flex-1 truncate text-zinc-100">
                            {c.name}
                          </span>
                          <span className="font-mono text-xs text-zinc-500">
                            {c.team}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  <label className="mt-3 block">
                    <span className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
                      Resolution note (optional)
                    </span>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                      placeholder="e.g. CMC went off for 32 pts, Bijan benched"
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none"
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={isBusy || pick == null}
                      onClick={() =>
                        pick != null &&
                        withBusy(s.id, () =>
                          resolveScenario(s.id, pick, note),
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Mark resolved
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Paginator */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between gap-2 text-xs">
            {page > 1 ? (
              <Link
                href={`/council/admin/verdicts?page=${page - 1}`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link
                href={`/council/admin/verdicts?page=${page + 1}`}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
              >
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </section>

      {/* Resolved (collapsible) */}
      <section>
        <button
          type="button"
          onClick={() => setResolvedOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm font-semibold text-zinc-200 hover:bg-zinc-800/60"
        >
          {resolvedOpen ? (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          )}
          <span>Resolved ({resolved.length})</span>
          <span className="ml-auto text-xs font-normal text-zinc-500">
            {resolvedOpen ? "Hide" : "Show"}
          </span>
        </button>

        {resolvedOpen && (
          <ul className="mt-3 space-y-2">
            {resolved.length === 0 ? (
              <li className="rounded-md border border-zinc-800 bg-zinc-900 p-4 text-center text-sm text-zinc-500">
                No scenarios resolved yet.
              </li>
            ) : (
              resolved.map((s) => {
                const winner = s.candidates.find(
                  (c) => c.player_id === s.actualWinnerPlayerId,
                );
                const isBusy = busyId === s.id;
                return (
                  <li
                    key={s.id}
                    className="rounded-md border border-emerald-500/20 bg-zinc-900 p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-100">
                          {scenarioSummary(s.scenarioType, s.context)}
                          {" · "}
                          <span className="text-emerald-300">
                            {winner?.name ?? `#${s.actualWinnerPlayerId}`}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Resolved{" "}
                          {s.resolvedAt
                            ? relativeTimeShort(s.resolvedAt)
                            : "—"}{" "}
                          ·{" "}
                          <Link
                            href={`/verdict/${s.id}`}
                            className="text-zinc-400 underline-offset-4 hover:text-emerald-300 hover:underline"
                          >
                            View
                          </Link>
                        </p>
                        {s.resolutionNote && (
                          <p className="mt-1 text-xs text-zinc-400">
                            {s.resolutionNote}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          withBusy(s.id, () => unresolveScenario(s.id))
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-50"
                        title="Clear the resolution and put this back in the queue"
                      >
                        <RotateCcw className="h-3 w-3" /> Unresolve
                      </button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
