"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";
import type { CourtCase, CourtPlayer, CourtWeek } from "@/lib/court";
import {
  addCourtCase,
  createCourtWeek,
  deleteCourtCase,
  deleteCourtWeek,
  gradeCourtCase,
  setCourtWeekStatus,
} from "./actions";

export type PickablePlayer = CourtPlayer;

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function Badge({ position }: { position: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
        POSITION_STYLES[position] ?? "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
      }`}
    >
      {position}
    </span>
  );
}

function PlayerCombo({
  players,
  value,
  onChange,
  placeholder,
}: {
  players: PickablePlayer[];
  value: PickablePlayer | null;
  onChange: (p: PickablePlayer | null) => void;
  placeholder: string;
}) {
  const [search, setSearch] = useState("");
  const matches = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    return players
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, players]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/[0.07] px-2.5 py-2">
        <Badge position={value.position} />
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
          {value.name}
        </span>
        <span className="font-mono text-[11px] text-zinc-500">{value.team}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
          aria-label="Clear"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
      />
      {matches.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl">
          {matches.map((p) => (
            <button
              key={p.player_id}
              type="button"
              onClick={() => {
                onChange(p);
                setSearch("");
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-zinc-800"
            >
              <Badge position={p.position} />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                {p.name}
              </span>
              <span className="font-mono text-[11px] text-zinc-500">{p.team}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local wants YYYY-MM-DDTHH:mm in local time.
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export default function AdminCourtClient({
  weeks,
  selectedId,
  cases,
  players,
}: {
  weeks: CourtWeek[];
  selectedId: string | null;
  cases: CourtCase[];
  players: PickablePlayer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Create-week form
  const now = new Date();
  const [season, setSeason] = useState(now.getFullYear());
  const [weekNo, setWeekNo] = useState(1);
  const [title, setTitle] = useState("");
  const [createLock, setCreateLock] = useState("");

  // Add-case form
  const [playerA, setPlayerA] = useState<PickablePlayer | null>(null);
  const [playerB, setPlayerB] = useState<PickablePlayer | null>(null);

  const selectedWeek = weeks.find((w) => w.id === selectedId) ?? null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        after?.();
        router.refresh();
      } else {
        setMsg(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {msg && (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {msg}
        </p>
      )}

      {/* Create week */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          New week
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs text-zinc-500">
            Season
            <input
              type="number"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Week
            <input
              type="number"
              value={weekNo}
              onChange={(e) => setWeekNo(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="col-span-2 text-xs text-zinc-500">
            Title (optional)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Week ${weekNo}`}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600"
            />
          </label>
          <label className="col-span-2 text-xs text-zinc-500 sm:col-span-4">
            Locks at (optional)
            <input
              type="datetime-local"
              value={createLock}
              onChange={(e) => setCreateLock(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                createCourtWeek({
                  season,
                  week: weekNo,
                  title,
                  locksAt: createLock ? new Date(createLock).toISOString() : null,
                }),
              () => {
                setTitle("");
                setCreateLock("");
              },
            )
          }
          className="mt-3 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
        >
          Create week
        </button>
      </section>

      {/* Week selector */}
      {weeks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {weeks.map((w) => (
            <a
              key={w.id}
              href={`/council/admin/court?week=${w.id}`}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                w.id === selectedId
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              {w.title?.trim() || `Week ${w.week}`} · {w.status}
            </a>
          ))}
        </div>
      )}

      {/* Selected week */}
      {selectedWeek && (
        <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-100">
              {selectedWeek.title?.trim() || `Week ${selectedWeek.week}`}{" "}
              <span className="text-xs font-normal text-zinc-500">
                {selectedWeek.season} · {cases.length} cases
              </span>
            </h2>
            <div className="flex items-center gap-1.5">
              {(["draft", "open", "closed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setCourtWeekStatus({ weekId: selectedWeek.id, status: s }),
                    )
                  }
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                    selectedWeek.status === s
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Lock time */}
          <label className="block text-xs text-zinc-500">
            Locks at
            <input
              type="datetime-local"
              defaultValue={toLocalInput(selectedWeek.locks_at)}
              onBlur={(e) =>
                run(() =>
                  setCourtWeekStatus({
                    weekId: selectedWeek.id,
                    status: selectedWeek.status,
                    locksAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  }),
                )
              }
              className="mt-1 w-full max-w-xs rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>

          {/* Add case */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Add head-to-head
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="flex-1">
                <PlayerCombo
                  players={players}
                  value={playerA}
                  onChange={setPlayerA}
                  placeholder="Search player A…"
                />
              </div>
              <span className="self-center text-xs text-zinc-600">vs</span>
              <div className="flex-1">
                <PlayerCombo
                  players={players}
                  value={playerB}
                  onChange={setPlayerB}
                  placeholder="Search player B…"
                />
              </div>
              <button
                type="button"
                disabled={pending || !playerA || !playerB}
                onClick={() =>
                  playerA &&
                  playerB &&
                  run(
                    () =>
                      addCourtCase({
                        weekId: selectedWeek.id,
                        playerA,
                        playerB,
                      }),
                    () => {
                      setPlayerA(null);
                      setPlayerB(null);
                    },
                  )
                }
                className="rounded-md bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Cases */}
          <div className="space-y-2">
            {cases.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-2.5"
              >
                <span className="font-mono text-[11px] text-zinc-600">
                  {c.order_index}
                </span>
                <GradeButton
                  case={c}
                  player={c.player_a}
                  pending={pending}
                  onGrade={(id) =>
                    run(() =>
                      gradeCourtCase({ caseId: c.id, winnerPlayerId: id }),
                    )
                  }
                />
                <span className="text-xs text-zinc-600">vs</span>
                <GradeButton
                  case={c}
                  player={c.player_b}
                  pending={pending}
                  onGrade={(id) =>
                    run(() =>
                      gradeCourtCase({ caseId: c.id, winnerPlayerId: id }),
                    )
                  }
                />
                <div className="ml-auto flex items-center gap-2">
                  {c.winner_player_id != null && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          gradeCourtCase({ caseId: c.id, winnerPlayerId: null }),
                        )
                      }
                      className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      clear
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteCourtCase(c.id))}
                    className="rounded p-1 text-zinc-600 hover:text-rose-400"
                    aria-label="Delete case"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {cases.length === 0 && (
              <p className="text-sm text-zinc-500">
                No cases yet — add head-to-heads above.
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  "Delete this entire week and all its cases + picks? This cannot be undone.",
                )
              ) {
                run(() => deleteCourtWeek(selectedWeek.id), () =>
                  router.push("/council/admin/court"),
                );
              }
            }}
            className="text-xs text-rose-400/80 underline-offset-4 hover:text-rose-300 hover:underline"
          >
            Delete week
          </button>
        </section>
      )}
    </div>
  );
}

function GradeButton({
  case: c,
  player,
  pending,
  onGrade,
}: {
  case: CourtCase;
  player: CourtPlayer;
  pending: boolean;
  onGrade: (playerId: number) => void;
}) {
  const isWinner = c.winner_player_id === player.player_id;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onGrade(player.player_id)}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition disabled:opacity-50 ${
        isWinner
          ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
          : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"
      }`}
      title="Mark as winner"
    >
      <Badge position={player.position} />
      <span className="max-w-[8rem] truncate">{player.name}</span>
      {isWinner && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}
