import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ShareButton from "./ShareButton";
import SourceVerdictsPanel from "./SourceVerdictsPanel";
import VotingPanel from "./VotingPanel";
import type { ScoringSystem } from "@/lib/types";

const SITE_URL = "https://www.ffcouncil.com";

// Build SEO/OG metadata from the trade vote summary. Title shows the
// council split when votes exist ("Team A 73% vs Team B 27%"), otherwise
// falls back to the open-call copy.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  // Aggregate raw vote rows directly — trade_vote_summary undercounts
  // anonymous votes because count(voter_id) drops NULLs (migration 012
  // fixed the view but the deploy isn't guaranteed to have run it yet).
  const { data: voteRows } = await supabase
    .from("trade_votes")
    .select("winner")
    .eq("trade_id", id);
  const counts = { A: 0, B: 0, EVEN: 0 };
  for (const v of voteRows ?? []) {
    const w = v.winner as "A" | "B" | "EVEN";
    if (w === "A" || w === "B" || w === "EVEN") counts[w] += 1;
  }
  const total = counts.A + counts.B + counts.EVEN;

  let title: string;
  let description: string;
  if (total > 0) {
    const aPct = Math.round((counts.A / total) * 100);
    const bPct = Math.round((counts.B / total) * 100);
    title = `Team A ${aPct}% vs Team B ${bPct}% · FF Council`;
    description = `Crowdsourced trade verdict from ${total} council vote${
      total === 1 ? "" : "s"
    }.`;
  } else {
    title = "Open trade · FF Council";
    description = "Cast your verdict on this trade — the council is open.";
  }

  const url = `${SITE_URL}/trades/${id}`;
  return {
    title,
    description,
    openGraph: { title, description, url },
  };
}

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

type TradeSubmission = {
  id: string;
  submitter_id: string;
  league_type: string;
  scoring: string;
  team_count: number;
  context_note: string | null;
  league_note: string | null;
  side_a: Side;
  side_b: Side;
  created_at: string;
};

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: trade }, { data: voteRows }, authResult] = await Promise.all([
    supabase
      .from("trade_submissions")
      .select(
        "id, submitter_id, league_type, scoring, team_count, context_note, league_note, side_a, side_b, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    // Aggregate raw votes directly so anon votes count (the trade_vote_summary
    // view undercounts NULL voter_ids; we also need tier/lean fields below).
    supabase
      .from("trade_votes")
      .select("winner, fairness_tier, fairness_lean")
      .eq("trade_id", id),
    supabase.auth.getUser(),
  ]);

  if (!trade) {
    notFound();
  }

  const t = trade as TradeSubmission;
  const user = authResult.data?.user;

  // User's existing vote (if any) so we can pre-select their buttons
  let myVote: {
    winner: "A" | "B" | "EVEN";
    fairness_tier: string;
    fairness_lean: string | null;
  } | null = null;
  if (user) {
    const { data: myVoteRow } = await supabase
      .from("trade_votes")
      .select("winner, fairness_tier, fairness_lean")
      .eq("trade_id", id)
      .eq("voter_id", user.id)
      .maybeSingle();
    myVote = myVoteRow as typeof myVote;
  }

  // Build the same summary shape the JSX downstream expects from the view.
  type SummaryShape = {
    total_votes: number;
    votes_a: number;
    votes_b: number;
    votes_even: number;
    tier_balanced: number;
    tier_slight_edge: number;
    tier_clear_advantage: number;
    tier_major_advantage: number;
    tier_extreme_imbalance: number;
    lean_a: number;
    lean_b: number;
  };
  const summary: SummaryShape = {
    total_votes: 0,
    votes_a: 0,
    votes_b: 0,
    votes_even: 0,
    tier_balanced: 0,
    tier_slight_edge: 0,
    tier_clear_advantage: 0,
    tier_major_advantage: 0,
    tier_extreme_imbalance: 0,
    lean_a: 0,
    lean_b: 0,
  };
  for (const v of (voteRows ?? []) as Array<{
    winner: string;
    fairness_tier: string | null;
    fairness_lean: string | null;
  }>) {
    summary.total_votes += 1;
    if (v.winner === "A") summary.votes_a += 1;
    else if (v.winner === "B") summary.votes_b += 1;
    else if (v.winner === "EVEN") summary.votes_even += 1;
    if (v.fairness_tier === "balanced") summary.tier_balanced += 1;
    else if (v.fairness_tier === "slight_edge") summary.tier_slight_edge += 1;
    else if (v.fairness_tier === "clear_advantage") summary.tier_clear_advantage += 1;
    else if (v.fairness_tier === "major_advantage") summary.tier_major_advantage += 1;
    else if (v.fairness_tier === "extreme_imbalance") summary.tier_extreme_imbalance += 1;
    if (v.fairness_lean === "A") summary.lean_a += 1;
    else if (v.fairness_lean === "B") summary.lean_b += 1;
  }

  const total = summary.total_votes;
  const aPct = total > 0 ? Math.round((summary.votes_a / total) * 100) : 0;
  const bPct = total > 0 ? Math.round((summary.votes_b / total) * 100) : 0;
  const evenPct = total > 0 ? 100 - aPct - bPct : 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">

        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Trade Review</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {t.league_type} · {t.scoring} · {t.team_count} teams ·{" "}
              {new Date(t.created_at).toLocaleDateString()}
              {t.context_note ? ` · "${t.context_note}"` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ShareButton tradeId={id} />
            <Link
              href="/trades"
              className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              ← All trades
            </Link>
          </div>
        </div>

        {/* The two sides */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TradeSide label="Team A receives" side={t.side_a} accent="rose" />
          <TradeSide label="Team B receives" side={t.side_b} accent="sky" />
        </div>

        {/* Crowd consensus — anchor block of the page when votes exist.
            Gradient frame, oversized headline percentage, and the winning
            side called out by name so it reads at a single glance. */}
        {(() => {
          type Winner = "A" | "B" | "EVEN" | null;
          const winner: Winner =
            total === 0
              ? null
              : aPct >= bPct && aPct >= evenPct
                ? "A"
                : bPct >= aPct && bPct >= evenPct
                  ? "B"
                  : "EVEN";
          const winnerPct =
            winner === "A"
              ? aPct
              : winner === "B"
                ? bPct
                : winner === "EVEN"
                  ? evenPct
                  : 0;
          const winnerLabel =
            winner === "A"
              ? "favor Team A"
              : winner === "B"
                ? "favor Team B"
                : winner === "EVEN"
                  ? "called it even"
                  : "";
          const winnerColor =
            winner === "A"
              ? "text-rose-300"
              : winner === "B"
                ? "text-sky-300"
                : "text-emerald-300";
          return (
            <div
              className={`mb-6 overflow-hidden rounded-lg border p-4 sm:p-5 ${
                total === 0
                  ? "border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900"
                  : "border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-zinc-900"
              }`}
            >
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300/90">
                FF Council Verdict
              </h3>
              {total === 0 ? (
                <div>
                  <p className="text-lg font-bold text-zinc-100">
                    Awaiting the council&apos;s ruling.
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    No votes yet — be the first to weigh in below.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className={`font-mono text-4xl font-bold leading-none tabular-nums sm:text-5xl ${winnerColor}`}
                    >
                      {winnerPct}%
                    </span>
                    <p className="text-sm text-zinc-300 sm:text-base">
                      {winnerLabel}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <ConsensusBar
                      label="Team A wins"
                      count={summary?.votes_a ?? 0}
                      pct={aPct}
                      color="bg-rose-500/40"
                      highlight={winner === "A"}
                    />
                    <ConsensusBar
                      label="Even trade"
                      count={summary?.votes_even ?? 0}
                      pct={evenPct}
                      color="bg-emerald-500/40"
                      highlight={winner === "EVEN"}
                    />
                    <ConsensusBar
                      label="Team B wins"
                      count={summary?.votes_b ?? 0}
                      pct={bPct}
                      color="bg-sky-500/40"
                      highlight={winner === "B"}
                    />
                  </div>
                  <p className="mt-4 text-xs text-zinc-500">
                    {total} vote{total === 1 ? "" : "s"} · fairness mix:{" "}
                    {summary?.tier_balanced ?? 0} balanced ·{" "}
                    {(summary?.tier_slight_edge ?? 0) +
                      (summary?.tier_clear_advantage ?? 0)}{" "}
                    edge ·{" "}
                    {(summary?.tier_major_advantage ?? 0) +
                      (summary?.tier_extreme_imbalance ?? 0)}{" "}
                    imbalanced
                  </p>
                </>
              )}
            </div>
          );
        })()}

        {/* Source Verdicts — what every ranking source thinks about the trade,
            rendered above the council vote so a reader sees the model output
            before they cast their own vote. */}
        {(() => {
          const allowed: ScoringSystem[] = ["PPR", "Half", "Standard"];
          const scoring: ScoringSystem = (allowed as string[]).includes(t.scoring)
            ? (t.scoring as ScoringSystem)
            : "PPR";
          const hasPicks =
            (t.side_a.picks?.length ?? 0) > 0 ||
            (t.side_b.picks?.length ?? 0) > 0;
          return (
            <SourceVerdictsPanel
              sideA={{
                players: t.side_a.players.map((p) => ({
                  player_id: p.player_id,
                  name: p.name,
                  team: p.team,
                })),
                picks: t.side_a.picks,
              }}
              sideB={{
                players: t.side_b.players.map((p) => ({
                  player_id: p.player_id,
                  name: p.name,
                  team: p.team,
                })),
                picks: t.side_b.picks,
              }}
              scoring={scoring}
              hasPicks={hasPicks}
            />
          );
        })()}

        {/* Voting */}
        {user ? (
          <VotingPanel tradeId={id} myVote={myVote} />
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-200">
            <Link
              href={`/login?error=${encodeURIComponent("Sign in to vote on this trade")}`}
              className="underline underline-offset-4"
            >
              Sign in
            </Link>{" "}
            to cast your verdict.
          </div>
        )}

        {t.league_note && (
          <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              League notes
            </p>
            <p className="mt-1 text-zinc-300">{t.league_note}</p>
          </div>
        )}

        <p className="mt-8 text-xs text-zinc-500">
          Discussion / comment threads coming soon. For now, the council speaks
          through votes.
        </p>
      </div>
    </main>
  );
}

function TradeSide({
  label,
  side,
  accent,
}: {
  label: string;
  side: Side;
  accent: "rose" | "sky";
}) {
  const color = accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
      <p className={`text-xs uppercase tracking-wider ${color}`}>{label}</p>
      <div className="mt-3 space-y-2">
        {side.players.map((p, idx) => (
          <div
            key={`p-${idx}`}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-sm sm:px-3"
          >
            <span className="flex-1 truncate font-medium text-zinc-100">{p.name}</span>
            {p.position && POSITION_STYLES[p.position] && (
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
              >
                {p.position}
              </span>
            )}
            <span className="w-10 font-mono text-xs text-zinc-400">
              {p.team}
            </span>
          </div>
        ))}
        {side.picks.map((pk, idx) => (
          <div
            key={`pk-${idx}`}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-sm sm:px-3"
          >
            <span className="flex-1 font-mono text-zinc-100">
              {pk.year} {pk.round}
              {pk.slot != null ? `.${String(pk.slot).padStart(2, "0")}` : ""}
            </span>
            <span className="text-xs text-zinc-500">pick</span>
          </div>
        ))}
        {side.players.length === 0 && side.picks.length === 0 && (
          <p className="text-xs text-zinc-600">Nothing on this side</p>
        )}
      </div>
    </div>
  );
}

function ConsensusBar({
  label,
  count,
  pct,
  color,
  highlight,
}: {
  label: string;
  count: number;
  pct: number;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span
          className={
            highlight ? "font-semibold text-zinc-100" : "text-zinc-300"
          }
        >
          {label}
        </span>
        <span
          className={`font-mono tabular-nums ${
            highlight ? "font-semibold text-zinc-100" : "text-zinc-400"
          }`}
        >
          {count} ({pct}%)
        </span>
      </div>
      <div
        className={`mt-1 h-2.5 overflow-hidden rounded-full ${
          highlight ? "bg-zinc-800/60 ring-1 ring-inset ring-zinc-700" : "bg-zinc-800"
        }`}
      >
        <div
          className={`h-full ${color} animate-bar-grow`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
