"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { SleeperLeague, SleeperUser } from "@/lib/sleeper";
import { linkSleeperLeague, lookupSleeperUser } from "./actions";

export type ConnectedLeagueSummary = {
  leagueId: string;
  leagueName: string;
  season: string;
  totalRosters: number;
  rosterPositions: string[];
  scoringSummary: string;
  playerCount: number;
  sleeperUsername: string | null;
};

type Step =
  | { kind: "username" }
  | { kind: "pick-league"; user: SleeperUser; leagues: SleeperLeague[] }
  | { kind: "connected"; summary: ConnectedLeagueSummary };

export default function LeagueConnectClient({
  season,
  initialConnected,
}: {
  season: string;
  initialConnected: ConnectedLeagueSummary | null;
}) {
  const [step, setStep] = useState<Step>(
    initialConnected
      ? { kind: "connected", summary: initialConnected }
      : { kind: "username" },
  );
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const value = username.trim();
    if (!value) {
      setError("Enter your Sleeper username.");
      return;
    }
    startTransition(async () => {
      const result = await lookupSleeperUser(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.leagues.length === 0) {
        setError(
          `Found "${result.user.display_name}" on Sleeper, but they aren't in any ${season} NFL leagues yet.`,
        );
        return;
      }
      setStep({ kind: "pick-league", user: result.user, leagues: result.leagues });
    });
  }

  function handlePick(league: SleeperLeague, user: SleeperUser) {
    setError(null);
    startTransition(async () => {
      const result = await linkSleeperLeague(user.user_id, league.league_id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep({
        kind: "connected",
        summary: {
          leagueId: league.league_id,
          leagueName: league.name,
          season: league.season,
          totalRosters: league.total_rosters,
          rosterPositions: league.roster_positions,
          scoringSummary: summarizeScoring(league.scoring_settings),
          playerCount: 0, // we don't have rosters in-hand here; Step 3 reload will fill it
          sleeperUsername: user.username ?? user.display_name ?? null,
        },
      });
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold sm:text-3xl">
            Connect your Sleeper account
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Link your league once and FF Council can ground every trade,
            verdict, and ranking in your actual roster — instead of asking you
            to type names by hand.
          </p>
        </div>

        <StepHeader current={step.kind} />

        {step.kind === "username" && (
          <UsernameForm
            username={username}
            onChange={setUsername}
            onSubmit={handleLookup}
            isPending={isPending}
            error={error}
            season={season}
          />
        )}

        {step.kind === "pick-league" && (
          <LeaguePicker
            user={step.user}
            leagues={step.leagues}
            onBack={() => {
              setError(null);
              setStep({ kind: "username" });
            }}
            onPick={handlePick}
            isPending={isPending}
            error={error}
          />
        )}

        {step.kind === "connected" && (
          <ConnectedView
            summary={step.summary}
            onChangeLeague={() => {
              setError(null);
              setStep({ kind: "username" });
            }}
          />
        )}
      </div>
    </main>
  );
}

// ---------- step header ----------

function StepHeader({ current }: { current: Step["kind"] }) {
  const labels: Array<{ key: Step["kind"]; label: string }> = [
    { key: "username", label: "1. Sleeper username" },
    { key: "pick-league", label: "2. Pick league" },
    { key: "connected", label: "3. Connected" },
  ];
  const activeIdx = labels.findIndex((l) => l.key === current);
  return (
    <ol className="mb-5 flex flex-wrap gap-2 text-xs">
      {labels.map((l, i) => {
        const active = i === activeIdx;
        const done = i < activeIdx;
        return (
          <li
            key={l.key}
            className={`rounded-md px-2 py-1 ring-1 ${
              active
                ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/40"
                : done
                  ? "bg-zinc-800 text-zinc-300 ring-zinc-700"
                  : "bg-zinc-900 text-zinc-500 ring-zinc-800"
            }`}
          >
            {l.label}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- step 1 ----------

function UsernameForm({
  username,
  onChange,
  onSubmit,
  isPending,
  error,
  season,
}: {
  username: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
  error: string | null;
  season: string;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-6"
    >
      <div className="space-y-1">
        <label
          htmlFor="sleeper-username"
          className="block text-xs uppercase tracking-wider text-zinc-500"
        >
          Sleeper username
        </label>
        <input
          id="sleeper-username"
          name="username"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={username}
          onChange={(e) => onChange(e.target.value)}
          placeholder="your_sleeper_handle"
          className="block w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
        />
        <p className="text-xs text-zinc-500">
          Same handle you use to sign into the Sleeper app. We&apos;ll show
          your {season} NFL leagues next.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Looking up…" : "Find my leagues"}
      </button>
    </form>
  );
}

// ---------- step 2 ----------

function LeaguePicker({
  user,
  leagues,
  onBack,
  onPick,
  isPending,
  error,
}: {
  user: SleeperUser;
  leagues: SleeperLeague[];
  onBack: () => void;
  onPick: (league: SleeperLeague, user: SleeperUser) => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
        <p className="text-xs text-zinc-500">Signed in as</p>
        <p className="text-sm font-medium text-zinc-100">
          {user.display_name}
          {user.username ? (
            <span className="ml-2 font-mono text-xs text-zinc-500">
              @{user.username}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
        >
          ← Use a different username
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {leagues.map((league) => {
          const scoring = summarizeScoring(league.scoring_settings);
          return (
            <li key={league.league_id}>
              <button
                type="button"
                onClick={() => onPick(league, user)}
                disabled={isPending}
                className="block w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left transition hover:border-emerald-500/40 hover:bg-zinc-900/70 disabled:cursor-not-allowed disabled:opacity-50 sm:p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-zinc-100 sm:text-base">
                    {league.name}
                  </p>
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                    {scoring}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {league.total_rosters} teams · {league.season} ·{" "}
                  {league.status}
                </p>
                <p className="mt-2 truncate font-mono text-[11px] text-zinc-500">
                  {summarizePositions(league.roster_positions)}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- step 3 ----------

function ConnectedView({
  summary,
  onChangeLeague,
}: {
  summary: ConnectedLeagueSummary;
  onChangeLeague: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-6">
        <p className="text-xs uppercase tracking-wider text-emerald-300">
          You&apos;re connected
        </p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-100 sm:text-xl">
          {summary.leagueName}
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          {summary.totalRosters} teams · {summary.season} ·{" "}
          {summary.scoringSummary}
          {summary.sleeperUsername ? (
            <>
              {" "}· signed in as{" "}
              <span className="font-mono text-zinc-300">
                @{summary.sleeperUsername}
              </span>
            </>
          ) : null}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="Your roster"
          value={
            summary.playerCount > 0
              ? `${summary.playerCount} players`
              : "Reload to see roster size"
          }
        />
        <Stat label="Scoring" value={summary.scoringSummary} />
        <Stat
          label="Lineup slots"
          value={summarizePositions(summary.rosterPositions)}
        />
        <Stat label="League size" value={`${summary.totalRosters} teams`} />
      </dl>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-zinc-200">What&apos;s next</h3>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          <li>
            <Link
              href="/trades/new"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Submit a trade →
            </Link>
            <span className="ml-2 text-xs text-zinc-500">
              Get the council&apos;s verdict on a deal.
            </span>
          </li>
          <li>
            <Link
              href="/verdict/new"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Post a tough call →
            </Link>
            <span className="ml-2 text-xs text-zinc-500">
              Start/sit, draft pick, waiver claim.
            </span>
          </li>
          <li>
            <Link
              href={`/league/${summary.leagueId}`}
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Analyze this league →
            </Link>
            <span className="ml-2 text-xs text-zinc-500">
              Roster strengths and council-derived trade targets.
            </span>
          </li>
        </ul>
      </div>

      <button
        type="button"
        onClick={onChangeLeague}
        className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
      >
        Connect a different league
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-zinc-100">
        {value}
      </dd>
    </div>
  );
}

// ---------- helpers ----------

function summarizeScoring(settings: Record<string, number> | undefined): string {
  const rec = settings?.rec ?? 0;
  if (rec >= 0.9) return "PPR";
  if (rec >= 0.4) return "Half-PPR";
  return "Standard";
}

/**
 * Compress something like ["QB","RB","RB","WR","WR","TE","FLEX","BN","BN"]
 * to "QB, 2RB, 2WR, TE, FLEX + 2BN" for a quick visual.
 */
function summarizePositions(positions: string[]): string {
  if (!positions || positions.length === 0) return "—";
  const counts = new Map<string, number>();
  for (const p of positions) counts.set(p, (counts.get(p) ?? 0) + 1);
  const STARTER_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF"];
  const starters: string[] = [];
  for (const slot of STARTER_ORDER) {
    const n = counts.get(slot);
    if (!n) continue;
    starters.push(n > 1 ? `${n}${slot}` : slot);
    counts.delete(slot);
  }
  // Any other starter-ish slots we didn't enumerate.
  for (const [slot, n] of Array.from(counts.entries())) {
    if (slot === "BN" || slot === "IR" || slot === "TAXI") continue;
    starters.push(n > 1 ? `${n}${slot}` : slot);
    counts.delete(slot);
  }
  const tail: string[] = [];
  for (const slot of ["BN", "IR", "TAXI"]) {
    const n = counts.get(slot);
    if (n) tail.push(`${n}${slot}`);
  }
  return tail.length
    ? `${starters.join(", ")} + ${tail.join(", ")}`
    : starters.join(", ");
}
