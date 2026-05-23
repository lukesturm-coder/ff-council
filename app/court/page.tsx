import type { Metadata } from "next";
import Link from "next/link";
import { Check, Gavel, Lock, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  computeStandings,
  isLocked,
  loadCurrentWeek,
  loadMyPicks,
  type CourtCase,
  type CourtPlayer,
} from "@/lib/court";
import CourtPicker from "./CourtPicker";
import Standings from "./Standings";

export const metadata: Metadata = {
  title: "Order in the Court · FF Council",
  description:
    "The weekly start/sit accuracy contest. Make your 10 calls, then see who tops The Standings when the cases close.",
};

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function Badge({ position }: { position: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
        POSITION_STYLES[position] ?? "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
      }`}
    >
      {position}
    </span>
  );
}

// One side of a graded case: emerald + check if it's the winner, rose + X if
// it's the member's wrong pick, muted otherwise.
function ResultSide({
  player,
  isWinner,
  isMyPick,
}: {
  player: CourtPlayer;
  isWinner: boolean;
  isMyPick: boolean;
}) {
  return (
    <div
      className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 ${
        isWinner
          ? "border-emerald-400/60 bg-emerald-500/10"
          : isMyPick
            ? "border-rose-500/50 bg-rose-500/[0.07]"
            : "border-zinc-800 bg-zinc-950/60"
      }`}
    >
      <Badge position={player.position} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-100">
          {player.name}
        </span>
        <span className="font-mono text-[11px] text-zinc-500">{player.team}</span>
      </span>
      {isWinner && <Check className="h-4 w-4 shrink-0 text-emerald-300" strokeWidth={3} />}
      {!isWinner && isMyPick && <X className="h-4 w-4 shrink-0 text-rose-400" strokeWidth={3} />}
    </div>
  );
}

function ClosedCase({
  c,
  myPick,
}: {
  c: CourtCase;
  myPick: number | undefined;
}) {
  const graded = c.winner_player_id != null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span className="font-mono">Case {c.order_index}</span>
        {graded ? (
          myPick == null ? (
            <span className="text-zinc-600">No pick</span>
          ) : myPick === c.winner_player_id ? (
            <span className="text-emerald-400">You nailed it</span>
          ) : (
            <span className="text-rose-400">Missed</span>
          )
        ) : (
          <span className="text-zinc-600">Not graded</span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <ResultSide
          player={c.player_a}
          isWinner={c.winner_player_id === c.player_a.player_id}
          isMyPick={myPick === c.player_a.player_id}
        />
        <div className="flex items-center justify-center text-xs font-semibold uppercase tracking-wider text-zinc-600">
          vs
        </div>
        <ResultSide
          player={c.player_b}
          isWinner={c.winner_player_id === c.player_b.player_id}
          isMyPick={myPick === c.player_b.player_id}
        />
      </div>
    </div>
  );
}

export default async function CourtPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const week = await loadCurrentWeek();

  if (!week) {
    return (
      <Shell>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
          <Gavel className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
          <p className="text-lg font-semibold text-zinc-200">
            Court is adjourned.
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            No session is open right now. Check back when the next week&apos;s
            cases are filed.
          </p>
        </div>
      </Shell>
    );
  }

  const myPicks = await loadMyPicks(
    week.cases.map((c) => c.id),
    user?.id ?? null,
  );
  const locked = isLocked(week);
  const closed = week.status === "closed";
  const standings = closed ? await computeStandings(week) : [];

  const weekLabel = week.title?.trim() || `Week ${week.week}`;
  const graded = week.cases.filter((c) => c.winner_player_id != null);
  const myCorrect = graded.filter(
    (c) => myPicks[c.id] === c.winner_player_id,
  ).length;

  return (
    <Shell>
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-emerald-300" aria-hidden />
          <h1 className="text-xl font-bold text-zinc-100 sm:text-2xl">
            Order in the Court
          </h1>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          {closed
            ? "Case closed. See how your calls held up and where you land in The Standings."
            : locked
              ? "Picks are locked. Results post once the games settle."
              : "Make your call on each head-to-head — who scores more this week? Lock them in before kickoff."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-400">
            {week.season} · {weekLabel}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              closed
                ? "bg-zinc-800 text-zinc-300"
                : locked
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-emerald-500/15 text-emerald-300"
            }`}
          >
            {closed ? "Case closed" : locked ? "Locked" : "Open"}
          </span>
          {closed && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
              You went {myCorrect}/{graded.length}
            </span>
          )}
        </div>
      </header>

      {/* OPEN + UNLOCKED */}
      {!closed && !locked && (
        <>
          {user ? (
            <CourtPicker cases={week.cases} initialPicks={myPicks} />
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2.5">
                <span className="text-sm text-emerald-100">
                  Sign in to lock your picks and join The Standings.
                </span>
                <Link
                  href="/login"
                  className="shrink-0 rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/30"
                >
                  Sign in
                </Link>
              </div>
              <div className="space-y-2 opacity-70">
                {week.cases.map((c) => (
                  <ClosedCase key={c.id} c={c} myPick={undefined} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* OPEN BUT LOCKED (awaiting grading) */}
      {!closed && locked && (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 text-sm text-amber-100">
            <Lock className="h-4 w-4 shrink-0" />
            Picks are locked. Hang tight — The Standings post once the cases are
            graded.
          </div>
          <div className="space-y-2">
            {week.cases.map((c) => (
              <ClosedCase key={c.id} c={c} myPick={myPicks[c.id]} />
            ))}
          </div>
        </>
      )}

      {/* CLOSED — results + standings */}
      {closed && (
        <div className="space-y-6">
          <div className="space-y-2">
            {week.cases.map((c) => (
              <ClosedCase key={c.id} c={c} myPick={myPicks[c.id]} />
            ))}
          </div>
          <div>
            <h2 className="mb-3 text-lg font-semibold text-zinc-100">
              The Standings
            </h2>
            <Standings rows={standings} meId={user?.id ?? null} />
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">{children}</div>
    </main>
  );
}
