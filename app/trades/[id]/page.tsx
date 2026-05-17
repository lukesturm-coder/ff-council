import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Header from "@/app/_components/Header";
import ShareButton from "./ShareButton";
import VotingPanel from "./VotingPanel";

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

  const [{ data: trade }, { data: summary }, authResult] = await Promise.all([
    supabase
      .from("trade_submissions")
      .select(
        "id, submitter_id, league_type, scoring, team_count, context_note, league_note, side_a, side_b, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("trade_vote_summary").select("*").eq("trade_id", id).maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!trade) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          <Header />
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center sm:p-6">
            <p className="text-sm text-zinc-400">Trade not found.</p>
            <Link
              href="/trades"
              className="mt-3 inline-block text-xs text-emerald-300 underline-offset-4 hover:underline"
            >
              ← Browse other trades
            </Link>
          </div>
        </div>
      </main>
    );
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

  const total = (summary?.total_votes as number | undefined) ?? 0;
  const aPct = total > 0 ? Math.round(((summary?.votes_a ?? 0) / total) * 100) : 0;
  const bPct = total > 0 ? Math.round(((summary?.votes_b ?? 0) / total) * 100) : 0;
  const evenPct = total > 0 ? 100 - aPct - bPct : 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <Header />

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

        {/* Crowd consensus */}
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            FF Council Verdict
          </h3>

          {total === 0 ? (
            <p className="text-sm text-zinc-500">
              No votes yet. Be the first to weigh in below.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <ConsensusBar
                  label="Team A wins"
                  count={summary?.votes_a ?? 0}
                  pct={aPct}
                  color="bg-rose-500/40"
                />
                <ConsensusBar
                  label="Even trade"
                  count={summary?.votes_even ?? 0}
                  pct={evenPct}
                  color="bg-zinc-500/40"
                />
                <ConsensusBar
                  label="Team B wins"
                  count={summary?.votes_b ?? 0}
                  pct={bPct}
                  color="bg-sky-500/40"
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
}: {
  label: string;
  count: number;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-400">
          {count} ({pct}%)
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
