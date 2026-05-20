import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/relative-time";
import type { VerdictPlayer, VerdictScenarioType } from "@/app/verdict/types";

// =====================================================================
// /me — signed-in user's personal stats page.
//
// Shows total votes cast, agreement rate vs. council consensus, scenarios
// posted, and recent activity. Aggregates from raw vote tables (not the
// trade_vote_summary view, which has known count bugs for anon votes).
// =====================================================================

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

type TradeVoteRow = {
  trade_id: string;
  winner: "A" | "B" | "EVEN";
  created_at: string;
};

type VerdictVoteRow = {
  scenario_id: string;
  pick_player_id: number;
  created_at: string;
};

type TradeConsensus = {
  total: number;
  topWinner: "A" | "B" | "EVEN" | null;
  topPct: number;
};

type VerdictConsensus = {
  total: number;
  topPlayerId: number | null;
  topPct: number;
};

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function formatJoinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function sideLabel(side: Side): string {
  const names = side.players
    .map((p) => p.name)
    .filter(Boolean)
    .slice(0, 2);
  const picks = side.picks.length;
  const parts: string[] = [];
  if (names.length > 0) parts.push(names.join(" + "));
  if (side.players.length > names.length)
    parts.push(`+${side.players.length - names.length} more`);
  if (picks > 0) parts.push(`+${picks} pick${picks === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/me");

  // ----- Member profile + display name -----
  const { data: member } = await supabase
    .from("council_members")
    .select("display_name, sleeper_username, sleeper_league_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const displayName =
    (member?.display_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Member";
  const sleeperUsername =
    (member?.sleeper_username as string | null | undefined) ?? null;
  const sleeperLeagueId =
    (member?.sleeper_league_id as string | null | undefined) ?? null;

  // ----- All of the user's votes (we need them for agreement calc anyway) -----
  // Capped server-side; if a user ever gets to thousands we'd revisit, but the
  // current Trade Court / Verdict scale makes a full scan trivial.
  const [
    { data: myTradeVotesRaw },
    { data: myVerdictVotesRaw },
    { data: myTradesRaw },
    { data: myVerdictsRaw },
  ] = await Promise.all([
    supabase
      .from("trade_votes")
      .select("trade_id, winner, created_at")
      .eq("voter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("verdict_votes")
      .select("scenario_id, pick_player_id, created_at")
      .eq("voter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("trade_submissions")
      .select("id, league_type, scoring, side_a, side_b, created_at")
      .eq("submitter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("verdict_scenarios")
      .select(
        "id, scenario_type, candidates, notes, created_at, actual_winner_player_id, resolved_at",
      )
      .eq("asker_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const myTradeVotes = (myTradeVotesRaw ?? []) as TradeVoteRow[];
  const myVerdictVotes = (myVerdictVotesRaw ?? []) as VerdictVoteRow[];
  const myTrades = (myTradesRaw ?? []) as {
    id: string;
    league_type: string;
    scoring: string;
    side_a: Side;
    side_b: Side;
    created_at: string;
  }[];
  const myVerdicts = (myVerdictsRaw ?? []) as {
    id: string;
    scenario_type: VerdictScenarioType;
    candidates: VerdictPlayer[];
    notes: string | null;
    created_at: string;
  }[];

  // ----- Consensus per trade the user voted on -----
  // Aggregate from raw trade_votes (NOT trade_vote_summary — known anon bug).
  const tradeIds = Array.from(new Set(myTradeVotes.map((v) => v.trade_id)));
  const tradeConsensus = new Map<string, TradeConsensus>();
  if (tradeIds.length > 0) {
    const { data: allTradeVotes } = await supabase
      .from("trade_votes")
      .select("trade_id, winner")
      .in("trade_id", tradeIds);
    const countsByTrade = new Map<string, { A: number; B: number; EVEN: number }>();
    for (const v of allTradeVotes ?? []) {
      const tid = v.trade_id as string;
      const w = v.winner as "A" | "B" | "EVEN";
      const c = countsByTrade.get(tid) ?? { A: 0, B: 0, EVEN: 0 };
      if (w === "A" || w === "B" || w === "EVEN") c[w] += 1;
      countsByTrade.set(tid, c);
    }
    countsByTrade.forEach((c, tid) => {
      const total = c.A + c.B + c.EVEN;
      let topWinner: "A" | "B" | "EVEN" | null = null;
      let topCount = -1;
      for (const w of ["A", "B", "EVEN"] as const) {
        if (c[w] > topCount) {
          topCount = c[w];
          topWinner = w;
        }
      }
      tradeConsensus.set(tid, {
        total,
        topWinner,
        topPct: total > 0 ? Math.round((topCount / total) * 100) : 0,
      });
    });
  }

  // ----- Consensus per verdict scenario the user voted on -----
  const scenarioIds = Array.from(
    new Set(myVerdictVotes.map((v) => v.scenario_id)),
  );
  const verdictConsensus = new Map<string, VerdictConsensus>();
  // Also need candidates so we can show player names in the activity feed.
  const verdictCandidates = new Map<string, VerdictPlayer[]>();
  if (scenarioIds.length > 0) {
    const [{ data: allVerdictVotes }, { data: scenarioMeta }] = await Promise.all([
      supabase
        .from("verdict_votes")
        .select("scenario_id, pick_player_id")
        .in("scenario_id", scenarioIds),
      supabase
        .from("verdict_scenarios")
        .select("id, candidates")
        .in("id", scenarioIds),
    ]);
    const countsByScenario = new Map<string, Record<number, number>>();
    for (const v of allVerdictVotes ?? []) {
      const sid = v.scenario_id as string;
      const pid = v.pick_player_id as number;
      const c = countsByScenario.get(sid) ?? {};
      c[pid] = (c[pid] ?? 0) + 1;
      countsByScenario.set(sid, c);
    }
    countsByScenario.forEach((c, sid) => {
      let total = 0;
      let topPlayerId: number | null = null;
      let topCount = -1;
      for (const pidStr of Object.keys(c)) {
        const n = c[Number(pidStr)] ?? 0;
        total += n;
        if (n > topCount) {
          topCount = n;
          topPlayerId = Number(pidStr);
        }
      }
      verdictConsensus.set(sid, {
        total,
        topPlayerId,
        topPct: total > 0 ? Math.round((topCount / total) * 100) : 0,
      });
    });
    for (const s of scenarioMeta ?? []) {
      verdictCandidates.set(
        s.id as string,
        (s.candidates as VerdictPlayer[]) ?? [],
      );
    }
  }

  // ----- Vote totals for the user's own scenarios (for "Your scenarios" list) -----
  const myTradeIds = myTrades.map((t) => t.id);
  const myScenarioIds = myVerdicts.map((s) => s.id);
  const myTradeTotals = new Map<string, number>();
  const myVerdictTotals = new Map<string, number>();
  if (myTradeIds.length > 0) {
    const { data } = await supabase
      .from("trade_votes")
      .select("trade_id")
      .in("trade_id", myTradeIds);
    for (const r of data ?? []) {
      const tid = r.trade_id as string;
      myTradeTotals.set(tid, (myTradeTotals.get(tid) ?? 0) + 1);
    }
  }
  if (myScenarioIds.length > 0) {
    const { data } = await supabase
      .from("verdict_votes")
      .select("scenario_id")
      .in("scenario_id", myScenarioIds);
    for (const r of data ?? []) {
      const sid = r.scenario_id as string;
      myVerdictTotals.set(sid, (myVerdictTotals.get(sid) ?? 0) + 1);
    }
  }

  // ----- Council accuracy (global, across all resolved verdicts) -----
  // Pulled separately from user-specific data because it's a site-wide stat:
  // "of every scenario an admin has graded, how often did the council's
  // top pick match the actual winner?". Skipped silently when there are
  // zero resolved scenarios so the card just doesn't render.
  let councilAccuracyPct: number | null = null;
  let resolvedCount = 0;
  let councilCorrect = 0;
  {
    const { data: resolvedScenarios } = await supabase
      .from("verdict_scenarios")
      .select("id, actual_winner_player_id")
      .not("actual_winner_player_id", "is", null)
      .limit(500);
    const resolvedRows = (resolvedScenarios ?? []) as {
      id: string;
      actual_winner_player_id: number;
    }[];
    if (resolvedRows.length > 0) {
      const resolvedIds = resolvedRows.map((r) => r.id);
      const { data: allVotes } = await supabase
        .from("verdict_votes")
        .select("scenario_id, pick_player_id")
        .in("scenario_id", resolvedIds);
      const tallies = new Map<string, Map<number, number>>();
      for (const v of allVotes ?? []) {
        const sid = v.scenario_id as string;
        const pid = v.pick_player_id as number;
        const t = tallies.get(sid) ?? new Map<number, number>();
        t.set(pid, (t.get(pid) ?? 0) + 1);
        tallies.set(sid, t);
      }
      for (const r of resolvedRows) {
        const t = tallies.get(r.id);
        if (!t || t.size === 0) continue;
        // Only count scenarios where the council actually voted (otherwise
        // "did the council's top pick match reality?" is undefined).
        let topPid: number | null = null;
        let topCount = -1;
        t.forEach((c, pid) => {
          if (c > topCount) {
            topCount = c;
            topPid = pid;
          }
        });
        if (topPid == null) continue;
        resolvedCount += 1;
        if (topPid === r.actual_winner_player_id) councilCorrect += 1;
      }
      if (resolvedCount > 0) {
        councilAccuracyPct = Math.round(
          (councilCorrect / resolvedCount) * 100,
        );
      }
    }
  }

  // ----- Aggregate stats -----
  const totalVotes = myTradeVotes.length + myVerdictVotes.length;
  const totalScenarios = myTrades.length + myVerdicts.length;

  let agreed = 0;
  let agreementDenom = 0;
  for (const v of myTradeVotes) {
    const c = tradeConsensus.get(v.trade_id);
    if (!c || c.total === 0 || c.topWinner == null) continue;
    agreementDenom += 1;
    if (c.topWinner === v.winner) agreed += 1;
  }
  for (const v of myVerdictVotes) {
    const c = verdictConsensus.get(v.scenario_id);
    if (!c || c.total === 0 || c.topPlayerId == null) continue;
    agreementDenom += 1;
    if (c.topPlayerId === v.pick_player_id) agreed += 1;
  }
  const agreementPct =
    agreementDenom > 0 ? Math.round((agreed / agreementDenom) * 100) : null;

  // ----- Trade side breakdown: where the user sided -----
  const tradeSideCounts = { A: 0, B: 0, EVEN: 0 };
  for (const v of myTradeVotes) {
    tradeSideCounts[v.winner] += 1;
  }
  const tradeSideTotal =
    tradeSideCounts.A + tradeSideCounts.B + tradeSideCounts.EVEN;

  // ----- Verdict position breakdown — count by candidate position -----
  // Need candidate positions for ALL scenarios the user voted on.
  // We already fetched the ones for scenarios with votes; we have everything
  // we need in verdictCandidates.
  const positionCounts: Record<string, number> = {};
  for (const v of myVerdictVotes) {
    const cands = verdictCandidates.get(v.scenario_id);
    if (!cands) continue;
    const picked = cands.find((c) => c.player_id === v.pick_player_id);
    if (!picked) continue;
    positionCounts[picked.position] = (positionCounts[picked.position] ?? 0) + 1;
  }
  const positionRows = Object.entries(positionCounts).sort(
    (a, b) => b[1] - a[1],
  );

  // ----- Recent activity (merge trade + verdict votes, sort by time, cap at 10) -----
  // Two query streams arrive sorted independently; pre-merging here means the
  // feed reads as one chronological list instead of "all trades, then all
  // verdicts" with a broken boundary in the middle.
  type ActivityItem =
    | { kind: "trade"; trade_id: string; winner: "A" | "B" | "EVEN"; created_at: string }
    | { kind: "verdict"; scenario_id: string; pick_player_id: number; created_at: string };

  const recentActivity: ActivityItem[] = [
    ...myTradeVotes.map<ActivityItem>((v) => ({
      kind: "trade",
      trade_id: v.trade_id,
      winner: v.winner,
      created_at: v.created_at,
    })),
    ...myVerdictVotes.map<ActivityItem>((v) => ({
      kind: "verdict",
      scenario_id: v.scenario_id,
      pick_player_id: v.pick_player_id,
      created_at: v.created_at,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 10);

  // Fetch trade meta for activity (side names so we can say "you said Saquon+...")
  const recentTradeIds = recentActivity
    .filter((a): a is Extract<ActivityItem, { kind: "trade" }> => a.kind === "trade")
    .map((a) => a.trade_id);
  const tradeMeta = new Map<string, { side_a: Side; side_b: Side }>();
  if (recentTradeIds.length > 0) {
    const { data } = await supabase
      .from("trade_submissions")
      .select("id, side_a, side_b")
      .in("id", recentTradeIds);
    for (const r of data ?? []) {
      tradeMeta.set(r.id as string, {
        side_a: r.side_a as Side,
        side_b: r.side_b as Side,
      });
    }
  }

  // ----- Member-since: use auth.created_at (available on getUser) -----
  const joinedAt = user.created_at ?? null;

  // =====================================================================
  // Render
  // =====================================================================
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
        {/* Header */}
        <div className="mb-5 border-b border-zinc-800 pb-4">
          <h1 className="text-xl font-semibold sm:text-2xl">{displayName}</h1>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            {user.email}
            {joinedAt ? ` · Joined ${formatJoinedDate(joinedAt)}` : ""}
          </p>
        </div>

        {/* Hero stats — 4 cards always, with an optional 5th "Council
           accuracy" card once we have resolved verdicts. The accuracy
           stat is the retention moat: vote vs. consensus is the daily
           hook, vote vs. reality is the long-term trust. */}
        <section
          className={`mb-6 grid grid-cols-2 gap-2 sm:gap-3 ${
            councilAccuracyPct != null
              ? "sm:grid-cols-3 lg:grid-cols-5"
              : "sm:grid-cols-4"
          }`}
        >
          <StatCard
            label="Votes cast"
            value={totalVotes.toLocaleString()}
            sub={
              totalVotes > 0
                ? `${myTradeVotes.length} trade · ${myVerdictVotes.length} verdict`
                : "Cast your first vote"
            }
          />
          <StatCard
            label="Agreement rate"
            value={agreementPct == null ? "—" : `${agreementPct}%`}
            sub={
              agreementDenom > 0
                ? `${agreed}/${agreementDenom} matched the council`
                : "Vote on a few to see this"
            }
          />
          {councilAccuracyPct != null && (
            <StatCard
              label="Council accuracy"
              value={`${councilAccuracyPct}%`}
              sub={`${councilCorrect}/${resolvedCount} resolved calls correct`}
            />
          )}
          <StatCard
            label="Scenarios posted"
            value={totalScenarios.toLocaleString()}
            sub={
              totalScenarios > 0
                ? `${myTrades.length} trade · ${myVerdicts.length} verdict`
                : "Post one to get the council's take"
            }
          />
          <StatCard
            label="Member since"
            value={joinedAt ? formatJoinedDate(joinedAt) : "—"}
            sub="Welcome to the Council"
          />
        </section>

        {/* Two-column-on-desktop body */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Left: breakdown + recent activity */}
          <div className="space-y-5 lg:col-span-2">
            {/* Vote breakdown */}
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
              <h2 className="text-sm font-semibold text-zinc-200 sm:text-base">
                How you vote
              </h2>
              <div className="mt-3 space-y-4 text-xs sm:text-sm">
                {tradeSideTotal > 0 ? (
                  <div>
                    <p className="text-zinc-400">
                      On {tradeSideTotal} trade
                      {tradeSideTotal === 1 ? "" : "s"}, you sided with:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <SideChip
                        label="Side A"
                        n={tradeSideCounts.A}
                        total={tradeSideTotal}
                        tone="emerald"
                      />
                      <SideChip
                        label="Side B"
                        n={tradeSideCounts.B}
                        total={tradeSideTotal}
                        tone="sky"
                      />
                      <SideChip
                        label="Even"
                        n={tradeSideCounts.EVEN}
                        total={tradeSideTotal}
                        tone="zinc"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-500">
                    No trade votes yet —{" "}
                    <Link
                      href="/judge"
                      className="text-emerald-300 underline-offset-4 hover:underline"
                    >
                      weigh in
                    </Link>
                    .
                  </p>
                )}

                {positionRows.length > 0 ? (
                  <div>
                    <p className="text-zinc-400">
                      On {myVerdictVotes.length} verdict
                      {myVerdictVotes.length === 1 ? "" : "s"}, your most-picked
                      positions:
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {positionRows.map(([pos, n]) => (
                        <span
                          key={pos}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ${
                            POSITION_STYLES[pos] ??
                            "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
                          }`}
                        >
                          {pos}
                          <span className="text-zinc-300/90">{n}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : myVerdictVotes.length === 0 ? (
                  <p className="text-zinc-500">
                    No verdict votes yet —{" "}
                    <Link
                      href="/judge"
                      className="text-emerald-300 underline-offset-4 hover:underline"
                    >
                      weigh in
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            </section>

            {/* Recent activity */}
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
              <h2 className="text-sm font-semibold text-zinc-200 sm:text-base">
                Recent activity
              </h2>
              {recentActivity.length === 0 ? (
                <p className="mt-3 text-xs text-zinc-500 sm:text-sm">
                  Vote on a trade or verdict to start building your activity
                  feed.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-800/70 text-xs sm:text-sm">
                  {recentActivity.map((a) => {
                    if (a.kind === "trade") {
                      const c = tradeConsensus.get(a.trade_id);
                      const meta = tradeMeta.get(a.trade_id);
                      const yourSide =
                        a.winner === "EVEN"
                          ? "Even"
                          : a.winner === "A"
                            ? meta
                              ? sideLabel(meta.side_a)
                              : "Side A"
                            : meta
                              ? sideLabel(meta.side_b)
                              : "Side B";
                      const councilSide =
                        c?.topWinner === "EVEN"
                          ? "Even"
                          : c?.topWinner === "A"
                            ? meta
                              ? sideLabel(meta.side_a)
                              : "Side A"
                            : c?.topWinner === "B"
                              ? meta
                                ? sideLabel(meta.side_b)
                                : "Side B"
                              : null;
                      const matches = c?.topWinner === a.winner;
                      return (
                        <li key={`t-${a.trade_id}`} className="py-2">
                          <Link
                            href={`/trades/${a.trade_id}`}
                            className="group flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                          >
                            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ring-1 ${
                                  matches
                                    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                                    : "bg-rose-500/10 text-rose-300 ring-rose-500/30"
                                }`}
                              >
                                Trade
                              </span>
                              <span className="truncate text-zinc-200 group-hover:text-emerald-300">
                                You said {yourSide}
                              </span>
                              {councilSide && c && c.total > 0 ? (
                                <span className="truncate text-zinc-500">
                                  · Council {c.topPct}% favor {councilSide}
                                </span>
                              ) : (
                                <span className="text-zinc-500">
                                  · No council consensus yet
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 text-[11px] text-zinc-500">
                              {relativeTime(a.created_at)}
                            </span>
                          </Link>
                        </li>
                      );
                    }
                    const c = verdictConsensus.get(a.scenario_id);
                    const cands = verdictCandidates.get(a.scenario_id) ?? [];
                    const picked = cands.find(
                      (p) => p.player_id === a.pick_player_id,
                    );
                    const councilPick =
                      c?.topPlayerId != null
                        ? cands.find((p) => p.player_id === c.topPlayerId)
                        : null;
                    const matches =
                      c?.topPlayerId === a.pick_player_id &&
                      c?.topPlayerId != null;
                    return (
                      <li key={`v-${a.scenario_id}`} className="py-2">
                        <Link
                          href={`/verdict/${a.scenario_id}`}
                          className="group flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                        >
                          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ring-1 ${
                                matches
                                  ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                                  : "bg-rose-500/10 text-rose-300 ring-rose-500/30"
                              }`}
                            >
                              Verdict
                            </span>
                            <span className="truncate text-zinc-200 group-hover:text-emerald-300">
                              You picked {picked?.name ?? "—"}
                            </span>
                            {councilPick && c && c.total > 0 ? (
                              <span className="truncate text-zinc-500">
                                · Council {c.topPct}% {councilPick.name}
                              </span>
                            ) : (
                              <span className="text-zinc-500">
                                · No council consensus yet
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 text-[11px] text-zinc-500">
                            {relativeTime(a.created_at)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* Right: your scenarios */}
          <aside className="space-y-3">
            {/* Sleeper connection card */}
            {sleeperLeagueId ? (
              <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-5">
                <h2 className="text-sm font-semibold text-emerald-200 sm:text-base">
                  Sleeper connected
                </h2>
                <p className="mt-1 text-xs text-zinc-300 sm:text-sm">
                  {sleeperUsername ? (
                    <>
                      Linked as{" "}
                      <span className="font-mono text-zinc-100">
                        @{sleeperUsername}
                      </span>
                      .
                    </>
                  ) : (
                    "Linked to a Sleeper league."
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Link
                    href={`/league/${sleeperLeagueId}`}
                    className="text-emerald-300 underline-offset-4 hover:underline"
                  >
                    View league →
                  </Link>
                  <Link
                    href="/league/connect"
                    className="text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
                  >
                    Change league
                  </Link>
                </div>
              </section>
            ) : (
              <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
                <h2 className="text-sm font-semibold text-zinc-200 sm:text-base">
                  Connect Sleeper
                </h2>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  Link your Sleeper account so trades and verdicts already
                  know your roster.
                </p>
                <Link
                  href="/league/connect"
                  className="mt-3 inline-block rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/30"
                >
                  Connect Sleeper →
                </Link>
              </section>
            )}

            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
              <h2 className="text-sm font-semibold text-zinc-200 sm:text-base">
                Your scenarios
              </h2>
              {totalScenarios === 0 ? (
                <p className="mt-3 text-xs text-zinc-500 sm:text-sm">
                  You haven&apos;t posted anything yet. Drop a{" "}
                  <Link
                    href="/trades/new"
                    className="text-emerald-300 underline-offset-4 hover:underline"
                  >
                    trade
                  </Link>{" "}
                  or{" "}
                  <Link
                    href="/verdict/new"
                    className="text-emerald-300 underline-offset-4 hover:underline"
                  >
                    tough call
                  </Link>{" "}
                  for the council.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-xs sm:text-sm">
                  {myTrades.map((t) => {
                    const n = myTradeTotals.get(t.id) ?? 0;
                    return (
                      <li key={`mt-${t.id}`}>
                        <Link
                          href={`/trades/${t.id}`}
                          className="group block rounded-md border border-zinc-800 bg-zinc-950/40 p-2 transition hover:border-emerald-500/40"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-wider text-emerald-300">
                              Trade · {t.scoring}
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {relativeTime(t.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-zinc-200 group-hover:text-emerald-300">
                            {sideLabel(t.side_a)}{" "}
                            <span className="text-zinc-500">for</span>{" "}
                            {sideLabel(t.side_b)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-500">
                            {n} vote{n === 1 ? "" : "s"}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                  {myVerdicts.map((s) => {
                    const n = myVerdictTotals.get(s.id) ?? 0;
                    const names = s.candidates
                      .map((c) => c.name)
                      .slice(0, 3)
                      .join(" vs ");
                    return (
                      <li key={`mv-${s.id}`}>
                        <Link
                          href={`/verdict/${s.id}`}
                          className="group block rounded-md border border-zinc-800 bg-zinc-950/40 p-2 transition hover:border-emerald-500/40"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-wider text-emerald-300">
                              Verdict ·{" "}
                              {s.scenario_type === "draft" ? "Draft" : "Start/Sit"}
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {relativeTime(s.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-zinc-200 group-hover:text-emerald-300">
                            {names || "—"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-500">
                            {n} vote{n === 1 ? "" : "s"}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>

        <div className="mt-10 flex justify-end border-t border-zinc-800 pt-6">
          <form action="/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 sm:text-xs">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-emerald-300 sm:text-2xl">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 text-[11px] text-zinc-500 sm:text-xs">{sub}</p>
      ) : null}
    </div>
  );
}

function SideChip({
  label,
  n,
  total,
  tone,
}: {
  label: string;
  n: number;
  total: number;
  tone: "emerald" | "sky" | "zinc";
}) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
      : tone === "sky"
        ? "bg-sky-500/10 text-sky-300 ring-sky-500/30"
        : "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ${toneClass}`}
    >
      {label}
      <span className="text-zinc-200/90">
        {n} ({pct}%)
      </span>
    </span>
  );
}
