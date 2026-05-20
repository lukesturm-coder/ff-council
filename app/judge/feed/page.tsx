import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import JudgeFeed, { type JudgeItem } from "../JudgeFeed";
import FilterSheet from "../FilterSheet";

export const metadata: Metadata = {
  title: "Speed vote · FF Council",
  description:
    "Speed-vote on open trades and tough calls — swipe through one tap at a time.",
};

// /judge/feed — single-card full-screen feed of unvoted scenarios. Mixed
// feed of trade-court trades + verdict scenarios, ordered by recency.
// Optimised for high-throughput one-tap voting. Filters (type, league,
// scoring, sort) live in URL search params so they survive refresh. The
// browse + filter list lives at /judge; this is the rapid-fire side door.

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

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "trades", label: "Trades only" },
  { value: "verdicts", label: "Tough calls only" },
] as const;

const LEAGUE_OPTIONS = [
  { value: "all", label: "Any league" },
  { value: "redraft", label: "Redraft" },
  { value: "dynasty", label: "Dynasty" },
  { value: "keeper", label: "Keeper" },
] as const;

const SCORING_OPTIONS = [
  { value: "all", label: "Any scoring" },
  { value: "PPR", label: "PPR" },
  { value: "Half", label: "Half" },
  { value: "Standard", label: "Standard" },
  { value: "Superflex", label: "Superflex" },
  { value: "TEPremium", label: "TE Prem" },
] as const;

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "controversial", label: "Most controversial" },
  { value: "popular", label: "Most voted" },
] as const;

// Minimum vote threshold for an item to qualify for the controversial /
// popular sort. Anything below this falls to the bottom of the list so a
// 2-vote 1-1 split doesn't trump a 200-vote real split.
const MIN_VOTES_FOR_RANKED_SORT = 10;

export default async function JudgeFeedPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    league?: string;
    scoring?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const typeFilter =
    TYPE_OPTIONS.find((o) => o.value === params.type)?.value ?? "all";
  const leagueFilter =
    LEAGUE_OPTIONS.find((o) => o.value === params.league)?.value ?? "all";
  const scoringFilter =
    SCORING_OPTIONS.find((o) => o.value === params.scoring)?.value ?? "all";
  const sortMode =
    SORT_OPTIONS.find((o) => o.value === params.sort)?.value ?? "recent";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Trade query — server-side filters where columns are real columns.
  let tradeQuery = supabase
    .from("trade_submissions")
    .select("id, league_type, scoring, team_count, side_a, side_b, created_at")
    .order("created_at", { ascending: false })
    .limit(80);
  if (leagueFilter !== "all") tradeQuery = tradeQuery.eq("league_type", leagueFilter);
  if (scoringFilter !== "all") tradeQuery = tradeQuery.eq("scoring", scoringFilter);

  // Verdict scoring lives in the context jsonb — filter in memory after fetch.
  // actual_winner_player_id / resolved_at pulled through so downstream
  // surfaces can flag already-graded scenarios; not displayed here yet.
  const verdictQuery = supabase
    .from("verdict_scenarios")
    .select(
      "id, scenario_type, candidates, roster, context, notes, image_url, created_at, actual_winner_player_id, resolved_at",
    )
    .order("created_at", { ascending: false })
    .limit(80);

  // Skip fetches we don't need based on the type filter (saves a round-trip
  // and keeps the data small for the longest possible feed when one type
  // is selected). When sorting by controversial/popular we also need the
  // raw vote rows aggregated in-memory.
  const needsVoteCounts = sortMode !== "recent";

  // Phase 1: feed rows + the signed-in user's votes (used to hide already-
  // voted items from the feed).
  const [tradeRes, verdictRes, myTradeVotesRes, myVerdictVotesRes] =
    await Promise.all([
      typeFilter === "verdicts"
        ? Promise.resolve({ data: [] as TradeRow[] })
        : tradeQuery,
      typeFilter === "trades"
        ? Promise.resolve({ data: [] as VerdictRow[] })
        : verdictQuery,
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

  // Phase 2: vote rows scoped to JUST the IDs in this feed. Previously this
  // selected every vote row in the DB when sort mode wasn't "recent" — fine
  // at 100 votes, catastrophic at 100k.
  const tradeIdsForVotes = ((tradeRes.data ?? []) as TradeRow[]).map(
    (t) => t.id,
  );
  const verdictIdsForVotes = ((verdictRes.data ?? []) as VerdictRow[]).map(
    (v) => v.id,
  );
  const [tradeVotesRes, verdictVotesRes] = await Promise.all([
    needsVoteCounts && typeFilter !== "verdicts" && tradeIdsForVotes.length > 0
      ? supabase
          .from("trade_votes")
          .select("trade_id, winner")
          .in("trade_id", tradeIdsForVotes)
      : Promise.resolve({
          data: [] as { trade_id: string; winner: "A" | "B" | "EVEN" }[],
        }),
    needsVoteCounts && typeFilter !== "trades" && verdictIdsForVotes.length > 0
      ? supabase
          .from("verdict_votes")
          .select("scenario_id, pick_player_id")
          .in("scenario_id", verdictIdsForVotes)
      : Promise.resolve({
          data: [] as { scenario_id: string; pick_player_id: number }[],
        }),
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
  let verdicts = ((verdictRes.data ?? []) as VerdictRow[]).filter(
    (v) => !myVerdictIds.has(v.id),
  );
  // Verdict scoring filter has to happen client-side because scoring lives
  // inside the context jsonb. Skip when "all".
  if (scoringFilter !== "all") {
    verdicts = verdicts.filter(
      (v) => (v.context as { scoring?: string })?.scoring === scoringFilter,
    );
  }

  // Aggregate vote rows in-memory keyed by their scenario id. Only computed
  // when the active sort needs them.
  type TradeTally = { total: number; a: number; b: number; even: number };
  const tradeTallies = new Map<string, TradeTally>();
  if (needsVoteCounts) {
    for (const v of (tradeVotesRes.data ?? []) as {
      trade_id: string;
      winner: "A" | "B" | "EVEN";
    }[]) {
      const t = tradeTallies.get(v.trade_id) ?? {
        total: 0,
        a: 0,
        b: 0,
        even: 0,
      };
      t.total += 1;
      if (v.winner === "A") t.a += 1;
      else if (v.winner === "B") t.b += 1;
      else if (v.winner === "EVEN") t.even += 1;
      tradeTallies.set(v.trade_id, t);
    }
  }
  // For verdicts: tally per-candidate plus total.
  type VerdictTally = { total: number; byPlayer: Map<number, number> };
  const verdictTallies = new Map<string, VerdictTally>();
  if (needsVoteCounts) {
    for (const v of (verdictVotesRes.data ?? []) as {
      scenario_id: string;
      pick_player_id: number;
    }[]) {
      const t = verdictTallies.get(v.scenario_id) ?? {
        total: 0,
        byPlayer: new Map<number, number>(),
      };
      t.total += 1;
      t.byPlayer.set(
        v.pick_player_id,
        (t.byPlayer.get(v.pick_player_id) ?? 0) + 1,
      );
      verdictTallies.set(v.scenario_id, t);
    }
  }

  // Controversy score: HIGHER = more controversial.
  // Trade: 1 - max(share_a, share_b, share_even). Even three-way → 2/3.
  // Verdict: 1 - (gap between top two candidates' shares). Tie → 1.0.
  // Both require >= MIN_VOTES_FOR_RANKED_SORT and (verdict) >= 2 voted-for
  // candidates; ineligible items get -1 so they sort to the bottom.
  function tradeControversy(id: string): number {
    const t = tradeTallies.get(id);
    if (!t || t.total < MIN_VOTES_FOR_RANKED_SORT) return -1;
    const maxShare = Math.max(t.a, t.b, t.even) / t.total;
    return 1 - maxShare;
  }
  function verdictControversy(id: string): number {
    const t = verdictTallies.get(id);
    if (!t || t.total < MIN_VOTES_FOR_RANKED_SORT) return -1;
    const shares = Array.from(t.byPlayer.values())
      .filter((c) => c > 0)
      .map((c) => c / t.total)
      .sort((a, b) => b - a);
    if (shares.length < 2) return -1;
    return 1 - (shares[0] - shares[1]);
  }

  function tradeTotal(id: string): number {
    return tradeTallies.get(id)?.total ?? 0;
  }
  function verdictTotal(id: string): number {
    return verdictTallies.get(id)?.total ?? 0;
  }

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
  ];

  function scoreFor(item: JudgeItem): number {
    if (sortMode === "controversial") {
      return item.kind === "trade"
        ? tradeControversy(item.id)
        : verdictControversy(item.id);
    }
    if (sortMode === "popular") {
      return item.kind === "trade" ? tradeTotal(item.id) : verdictTotal(item.id);
    }
    return 0;
  }

  if (sortMode === "recent") {
    feed.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  } else {
    feed.sort((a, b) => {
      const sb = scoreFor(b);
      const sa = scoreFor(a);
      if (sb !== sa) return sb - sa;
      // Stable tiebreak: newer first
      return a.created_at < b.created_at ? 1 : -1;
    });
  }

  const anyFilterActive =
    typeFilter !== "all" || leagueFilter !== "all" || scoringFilter !== "all";

  // Count of non-default filters currently in effect — drives the
  // "Filter (N)" label on the floating trigger. Sort is excluded; it
  // defaults to "recent" which feels like an empty state.
  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (leagueFilter !== "all" ? 1 : 0) +
    (scoringFilter !== "all" ? 1 : 0) +
    (sortMode !== "recent" ? 1 : 0);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-3 py-3 sm:px-6 sm:py-6">
        {/* Back to the browse hub + the speed-vote label. The nav announces
            "Judge"; this side door is the rapid one-tap feed. */}
        <div className="mb-3 flex items-center justify-between">
          <Link
            href="/judge"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 transition hover:text-zinc-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All cases
          </Link>
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Speed vote
          </p>
        </div>

        {/* Filter chips collapsed into a floating bottom-sheet so the trade
            card lands above the fold on mobile. Each pill is still a Link
            keyed by URL search params — no client state for filter values.
            "+ Post a tough call" lives in the sheet footer so it's still
            reachable without claiming header real estate. */}
        <FilterSheet
          activeCount={activeFilterCount}
          footer={
            <Link
              href="/verdict/new"
              className="block text-center text-xs font-medium text-emerald-300 underline-offset-4 hover:text-emerald-200 hover:underline"
            >
              + Post a tough call
            </Link>
          }
        >
          <FilterRow
            label="Sort"
            options={SORT_OPTIONS}
            current={sortMode}
            paramName="sort"
            otherParams={{
              type: typeFilter,
              league: leagueFilter,
              scoring: scoringFilter,
            }}
          />
          <FilterRow
            label="Type"
            options={TYPE_OPTIONS}
            current={typeFilter}
            paramName="type"
            otherParams={{
              league: leagueFilter,
              scoring: scoringFilter,
              sort: sortMode,
            }}
          />
          {typeFilter !== "verdicts" && (
            <FilterRow
              label="League"
              options={LEAGUE_OPTIONS}
              current={leagueFilter}
              paramName="league"
              otherParams={{
                type: typeFilter,
                scoring: scoringFilter,
                sort: sortMode,
              }}
            />
          )}
          <FilterRow
            label="Scoring"
            options={SCORING_OPTIONS}
            current={scoringFilter}
            paramName="scoring"
            otherParams={{
              type: typeFilter,
              league: leagueFilter,
              sort: sortMode,
            }}
          />
        </FilterSheet>

        {feed.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-10 text-center">
            <p className="text-2xl font-bold text-emerald-300">
              {anyFilterActive ? "Nothing matches." : "All caught up."}
            </p>
            <p className="mt-2 text-sm text-zinc-300">
              {anyFilterActive
                ? "Try widening the filters or posting a new tough call."
                : "You've weighed in on every open scenario."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {anyFilterActive && (
                <Link
                  href="/judge/feed"
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  Clear filters
                </Link>
              )}
              <Link
                href="/judge"
                className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Browse all cases
              </Link>
              <Link
                href="/verdict/new"
                className="rounded-md bg-emerald-500/20 px-4 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30"
              >
                Post a tough call
              </Link>
            </div>
          </div>
        ) : (
          <JudgeFeed feed={feed} />
        )}
      </div>
    </main>
  );
}

function FilterRow({
  label,
  options,
  current,
  paramName,
  otherParams,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  current: string;
  paramName: string;
  otherParams: Record<string, string>;
}) {
  // Build a URL with this pill's value applied + other filters preserved.
  // Default values ("all", "recent") are omitted to keep URLs short and clean.
  function hrefFor(value: string): string {
    const params: Record<string, string> = { ...otherParams, [paramName]: value };
    const entries = Object.entries(params).filter(
      ([, v]) => v && v !== "all" && v !== "recent",
    );
    if (entries.length === 0) return "/judge/feed";
    const qs = new URLSearchParams(entries).toString();
    return `/judge/feed?${qs}`;
  }

  return (
    <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="shrink-0 pr-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {options.map((opt) => {
        const isActive = opt.value === current;
        return (
          <Link
            key={opt.value}
            href={hrefFor(opt.value)}
            className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 transition ${
              isActive
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
