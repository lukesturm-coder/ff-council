import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/relative-time";

// =====================================================================
// /leaderboard — public, no-auth leaderboard of council members.
//
// Three views (?view=most_voted|agreement|controversial):
//   1. Most voted (default) — top 50 by total votes cast across both
//      trade_votes + verdict_votes.
//   2. Best agreement — top 50 by agreement % with council top pick,
//      min 20 votes to qualify.
//   3. Controversial — bottom 50 by agreement % (the dissenters),
//      min 20 votes to qualify.
//
// Aggregates from RAW trade_votes / verdict_votes (NOT trade_vote_summary
// view, which has known anon-count bugs). v1 does naive in-memory
// aggregation: fetch everything, group, score. At current scale this is
// trivially fast — revisit if vote rows balloon past ~100k.
// =====================================================================

export const metadata: Metadata = {
  title: "Leaderboard · FF Council",
  description:
    "Who shows up, and who calls it right. Top FF Council members ranked by activity, agreement with the council, and controversial takes.",
};

type LeaderboardView = "most_voted" | "agreement" | "controversial";

const MIN_VOTES_FOR_AGREEMENT = 20;
const ROW_LIMIT = 50;

type MemberRow = {
  user_id: string;
  display_name: string;
  joined_at: string;
};

type TradeVoteRow = {
  trade_id: string;
  voter_id: string | null;
  winner: "A" | "B" | "EVEN";
};

type VerdictVoteRow = {
  scenario_id: string;
  voter_id: string | null;
  pick_player_id: number;
};

type MemberStats = {
  userId: string;
  displayName: string;
  joinedAt: string;
  totalVotes: number;
  agreementMatched: number;
  agreementDenom: number;
  scenariosSubmitted: number;
};

function parseView(raw: string | string[] | undefined): LeaderboardView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "agreement" || v === "controversial") return v;
  return "most_voted";
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const view = parseView((await searchParams).view);
  const supabase = await createClient();

  // ----- Pull council members + raw vote rows + scenario submissions -----
  // All four queries are independent — fire in parallel.
  const [
    { data: membersRaw },
    { data: tradeVotesRaw },
    { data: verdictVotesRaw },
    { data: tradesRaw },
    { data: scenariosRaw },
  ] = await Promise.all([
    supabase
      .from("council_members")
      .select("user_id, display_name, joined_at")
      .eq("status", "approved"),
    supabase
      .from("trade_votes")
      .select("trade_id, voter_id, winner")
      .not("voter_id", "is", null),
    supabase
      .from("verdict_votes")
      .select("scenario_id, voter_id, pick_player_id")
      .not("voter_id", "is", null),
    supabase.from("trade_submissions").select("id, submitter_id"),
    supabase.from("verdict_scenarios").select("id, asker_id"),
  ]);

  const members = (membersRaw ?? []) as MemberRow[];
  const tradeVotes = (tradeVotesRaw ?? []) as TradeVoteRow[];
  const verdictVotes = (verdictVotesRaw ?? []) as VerdictVoteRow[];
  const trades = (tradesRaw ?? []) as { id: string; submitter_id: string | null }[];
  const scenarios = (scenariosRaw ?? []) as { id: string; asker_id: string | null }[];

  // ----- Build council consensus per trade -----
  // For each trade_id, find the winner with the most votes (top pick).
  // Skip trades with no votes (cannot happen here since trade has at least
  // the iterated row, but be defensive).
  const tradeCounts = new Map<string, { A: number; B: number; EVEN: number }>();
  for (const v of tradeVotes) {
    const c = tradeCounts.get(v.trade_id) ?? { A: 0, B: 0, EVEN: 0 };
    c[v.winner] += 1;
    tradeCounts.set(v.trade_id, c);
  }
  const tradeTopWinner = new Map<string, "A" | "B" | "EVEN">();
  tradeCounts.forEach((c, tid) => {
    let top: "A" | "B" | "EVEN" = "A";
    let topN = -1;
    for (const w of ["A", "B", "EVEN"] as const) {
      if (c[w] > topN) {
        topN = c[w];
        top = w;
      }
    }
    tradeTopWinner.set(tid, top);
  });

  // ----- Build council consensus per verdict scenario -----
  const verdictCounts = new Map<string, Map<number, number>>();
  for (const v of verdictVotes) {
    let inner = verdictCounts.get(v.scenario_id);
    if (!inner) {
      inner = new Map<number, number>();
      verdictCounts.set(v.scenario_id, inner);
    }
    inner.set(v.pick_player_id, (inner.get(v.pick_player_id) ?? 0) + 1);
  }
  const verdictTopPick = new Map<string, number>();
  verdictCounts.forEach((inner, sid) => {
    let topPid = -1;
    let topN = -1;
    inner.forEach((n, pid) => {
      if (n > topN) {
        topN = n;
        topPid = pid;
      }
    });
    if (topPid !== -1) verdictTopPick.set(sid, topPid);
  });

  // ----- Per-member aggregation -----
  // Seed only with members that have at least one vote OR one scenario.
  const statsMap = new Map<string, MemberStats>();
  const memberMeta = new Map<string, MemberRow>();
  for (const m of members) memberMeta.set(m.user_id, m);

  function ensure(userId: string): MemberStats | null {
    const meta = memberMeta.get(userId);
    if (!meta) return null; // Vote from a user that's not an approved member — skip.
    let s = statsMap.get(userId);
    if (!s) {
      s = {
        userId,
        displayName: meta.display_name,
        joinedAt: meta.joined_at,
        totalVotes: 0,
        agreementMatched: 0,
        agreementDenom: 0,
        scenariosSubmitted: 0,
      };
      statsMap.set(userId, s);
    }
    return s;
  }

  for (const v of tradeVotes) {
    if (!v.voter_id) continue;
    const s = ensure(v.voter_id);
    if (!s) continue;
    s.totalVotes += 1;
    const top = tradeTopWinner.get(v.trade_id);
    if (top) {
      s.agreementDenom += 1;
      if (top === v.winner) s.agreementMatched += 1;
    }
  }
  for (const v of verdictVotes) {
    if (!v.voter_id) continue;
    const s = ensure(v.voter_id);
    if (!s) continue;
    s.totalVotes += 1;
    const top = verdictTopPick.get(v.scenario_id);
    if (top != null) {
      s.agreementDenom += 1;
      if (top === v.pick_player_id) s.agreementMatched += 1;
    }
  }
  for (const t of trades) {
    if (!t.submitter_id) continue;
    const s = ensure(t.submitter_id);
    if (s) s.scenariosSubmitted += 1;
  }
  for (const sc of scenarios) {
    if (!sc.asker_id) continue;
    const s = ensure(sc.asker_id);
    if (s) s.scenariosSubmitted += 1;
  }

  // ----- Drop zero-vote members so the leaderboard isn't padded -----
  const all = Array.from(statsMap.values()).filter((s) => s.totalVotes > 0);

  // ----- Sort for the active view -----
  type RankedRow = MemberStats & { agreementPct: number | null };
  const ranked: RankedRow[] = all.map((s) => ({
    ...s,
    agreementPct:
      s.agreementDenom > 0
        ? Math.round((s.agreementMatched / s.agreementDenom) * 100)
        : null,
  }));

  let rows: RankedRow[];
  if (view === "most_voted") {
    rows = ranked
      .slice()
      .sort((a, b) => {
        if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
        // Tiebreak: scenarios submitted, then earlier-joined wins.
        if (b.scenariosSubmitted !== a.scenariosSubmitted)
          return b.scenariosSubmitted - a.scenariosSubmitted;
        return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
      })
      .slice(0, ROW_LIMIT);
  } else if (view === "agreement") {
    rows = ranked
      .filter(
        (r) =>
          r.agreementDenom >= MIN_VOTES_FOR_AGREEMENT && r.agreementPct != null,
      )
      .sort((a, b) => {
        const pa = a.agreementPct ?? 0;
        const pb = b.agreementPct ?? 0;
        if (pb !== pa) return pb - pa;
        // Tiebreak: more votes = more signal.
        return b.totalVotes - a.totalVotes;
      })
      .slice(0, ROW_LIMIT);
  } else {
    rows = ranked
      .filter(
        (r) =>
          r.agreementDenom >= MIN_VOTES_FOR_AGREEMENT && r.agreementPct != null,
      )
      .sort((a, b) => {
        const pa = a.agreementPct ?? 0;
        const pb = b.agreementPct ?? 0;
        if (pa !== pb) return pa - pb;
        return b.totalVotes - a.totalVotes;
      })
      .slice(0, ROW_LIMIT);
  }

  // ----- Render -----
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        {/* Header */}
        <div className="mb-5 border-b border-zinc-800 pb-4">
          <h1 className="text-xl font-semibold sm:text-2xl">
            FF Council leaderboard
          </h1>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            Who shows up. Who calls it right.
          </p>
        </div>

        {/* Tabs */}
        <nav className="mb-5 flex flex-wrap gap-2 text-xs sm:text-sm">
          <TabLink
            href="/leaderboard?view=most_voted"
            label="Most voted"
            active={view === "most_voted"}
          />
          <TabLink
            href="/leaderboard?view=agreement"
            label="Best agreement"
            active={view === "agreement"}
          />
          <TabLink
            href="/leaderboard?view=controversial"
            label="Controversial takes"
            active={view === "controversial"}
          />
        </nav>

        {/* Table */}
        {rows.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-400">
            {view === "most_voted"
              ? "No votes recorded yet. Be the first."
              : `Not enough votes yet — members need at least ${MIN_VOTES_FOR_AGREEMENT} votes to qualify for this ranking.`}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500 sm:text-xs">
                <tr>
                  <th className="px-3 py-2 sm:px-4">#</th>
                  <th className="px-3 py-2 sm:px-4">Member</th>
                  <th className="px-2 py-2 text-right sm:px-4">Votes</th>
                  <th className="px-2 py-2 text-right sm:px-4">Agreement</th>
                  <th className="hidden px-2 py-2 text-right sm:table-cell sm:px-4">
                    Scenarios
                  </th>
                  <th className="hidden px-2 py-2 text-right sm:table-cell sm:px-4">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {rows.map((r, i) => {
                  const rank = i + 1;
                  const topThree = rank <= 3;
                  const tone =
                    view === "most_voted"
                      ? "emerald"
                      : view === "agreement"
                        ? "amber"
                        : "rose";
                  const glow = topThree
                    ? tone === "emerald"
                      ? "bg-emerald-500/[0.06]"
                      : tone === "amber"
                        ? "bg-amber-500/[0.06]"
                        : "bg-rose-500/[0.06]"
                    : "";
                  const rankColor = topThree
                    ? tone === "emerald"
                      ? "text-emerald-300"
                      : tone === "amber"
                        ? "text-amber-300"
                        : "text-rose-300"
                    : "text-zinc-500";
                  return (
                    <tr key={r.userId} className={glow}>
                      <td
                        className={`px-3 py-2 font-mono text-xs font-semibold sm:px-4 ${rankColor}`}
                      >
                        {rank}
                      </td>
                      <td className="px-3 py-2 sm:px-4">
                        <span className="font-medium text-zinc-100">
                          {r.displayName}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-200 sm:px-4">
                        {r.totalVotes.toLocaleString()}
                      </td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums sm:px-4 ${
                          view === "agreement"
                            ? "font-semibold text-amber-300"
                            : view === "controversial"
                              ? "font-semibold text-rose-300"
                              : "text-zinc-300"
                        }`}
                      >
                        {r.agreementPct == null ? (
                          <span className="text-zinc-600">—</span>
                        ) : (
                          `${r.agreementPct}%`
                        )}
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums text-zinc-400 sm:table-cell sm:px-4">
                        {r.scenariosSubmitted}
                      </td>
                      <td className="hidden px-2 py-2 text-right text-zinc-500 sm:table-cell sm:px-4">
                        {relativeTime(r.joinedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer note */}
        <p className="mt-4 text-[11px] text-zinc-500 sm:text-xs">
          Stats refresh on each page load. Min {MIN_VOTES_FOR_AGREEMENT} votes
          to qualify for agreement / controversial rankings.
        </p>
      </div>
    </main>
  );
}

function TabLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 ring-1 transition ${
        active
          ? "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40"
          : "bg-zinc-900 text-zinc-400 ring-zinc-800 hover:text-zinc-200"
      }`}
    >
      {label}
    </Link>
  );
}
