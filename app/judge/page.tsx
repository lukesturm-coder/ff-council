import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import JudgeFeed, { type JudgeItem } from "./JudgeFeed";

// /judge — single-card full-screen feed of unvoted scenarios. Mixed feed
// of trade-court trades + verdict scenarios, ordered by recency. Optimised
// for high-throughput one-tap voting.

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

type TradeRow = {
  id: string;
  league_type: string;
  scoring: string;
  team_count: number;
  side_a: Side;
  side_b: Side;
  created_at: string;
};

type VerdictRow = {
  id: string;
  scenario_type: "draft" | "start_sit";
  candidates: { player_id: number; name: string; team: string; position: string }[];
  roster:
    | { player_id: number; name: string; team: string; position: string }[]
    | null;
  context: Record<string, unknown>;
  notes: string | null;
  image_url: string | null;
  created_at: string;
};

export default async function JudgePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pull the most recent ~50 of each. Authed users also get their existing
  // votes so we can hide ones they've already weighed in on; anon users
  // rely on the client localStorage dedup pattern already used elsewhere.
  const [tradeRes, verdictRes, myTradeVotesRes, myVerdictVotesRes] =
    await Promise.all([
      supabase
        .from("trade_submissions")
        .select(
          "id, league_type, scoring, team_count, side_a, side_b, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("verdict_scenarios")
        .select(
          "id, scenario_type, candidates, roster, context, notes, image_url, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      user
        ? supabase
            .from("trade_votes")
            .select("trade_id")
            .eq("voter_id", user.id)
        : Promise.resolve({ data: [] as { trade_id: string }[] }),
      user
        ? supabase
            .from("verdict_votes")
            .select("scenario_id")
            .eq("voter_id", user.id)
        : Promise.resolve({ data: [] as { scenario_id: string }[] }),
    ]);

  const myTradeIds = new Set(
    ((myTradeVotesRes.data ?? []) as { trade_id: string }[]).map(
      (r) => r.trade_id,
    ),
  );
  const myVerdictIds = new Set(
    ((myVerdictVotesRes.data ?? []) as { scenario_id: string }[]).map(
      (r) => r.scenario_id,
    ),
  );

  const trades = ((tradeRes.data ?? []) as TradeRow[]).filter(
    (t) => !myTradeIds.has(t.id),
  );
  const verdicts = ((verdictRes.data ?? []) as VerdictRow[]).filter(
    (v) => !myVerdictIds.has(v.id),
  );

  const feed: JudgeItem[] = [
    ...trades.map(
      (t): JudgeItem => ({
        kind: "trade",
        id: t.id,
        league_type: t.league_type,
        scoring: t.scoring,
        side_a: t.side_a,
        side_b: t.side_b,
        created_at: t.created_at,
      }),
    ),
    ...verdicts.map(
      (v): JudgeItem => ({
        kind: "verdict",
        id: v.id,
        scenario_type: v.scenario_type,
        candidates: v.candidates,
        roster: v.roster,
        context: v.context,
        notes: v.notes,
        image_url: v.image_url,
        created_at: v.created_at,
      }),
    ),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold sm:text-xl">Judge mode</h2>
            <p className="text-xs text-zinc-400 sm:text-sm">
              One scenario at a time. Tap your verdict. Next.
            </p>
          </div>
          <Link
            href="/verdict/new"
            className="shrink-0 text-xs text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
          >
            + Post a tough call
          </Link>
        </div>

        {feed.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-400">
            <p className="text-base text-zinc-200">You&apos;re all caught up.</p>
            <p className="mt-1 text-xs text-zinc-500">
              No more unvoted scenarios. Submit a tough call to get the council
              weighing in.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/verdict/new"
                className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30"
              >
                Post a verdict scenario
              </Link>
              <Link
                href="/trades/new"
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Post a trade
              </Link>
            </div>
          </div>
        ) : (
          <JudgeFeed feed={feed} signedIn={Boolean(user)} />
        )}
      </div>
    </main>
  );
}
