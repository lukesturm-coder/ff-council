import { Suspense } from "react";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FuturesResponse,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { withMockPlatformRankings } from "@/lib/mock-platform-rankings";
import type { PlatformRankingsMap } from "@/app/_components/RankingsTable";
import TradeCalculator, {
  type TradePlayer,
} from "./_components/TradeCalculator";
import TradeListClient, { type TradeCardData } from "./TradeListClient";

export const metadata: Metadata = {
  title: "Trade Court · FF Council",
  description:
    "Build a trade, see the math, then submit it to the council. Consensus emerges from the crowd.",
};

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

// Summary fields used by the list page. Tier counts are fetched for potential
// future use but the list only needs vote counts for sorting / verdict copy.
type Summary = {
  total_votes: number;
  votes_a: number;
  votes_b: number;
  votes_even: number;
};

type SortMode = "recent" | "controversial" | "lopsided" | "popular";
const SORT_OPTIONS: { value: SortMode; label: string; description: string }[] = [
  { value: "recent", label: "Recent", description: "Newest first" },
  {
    value: "popular",
    label: "Most voted",
    description: "Trades with the most council weigh-in",
  },
  {
    value: "controversial",
    label: "Most controversial",
    description: "Split decisions, no clear consensus",
  },
  {
    value: "lopsided",
    label: "Most lopsided",
    description: "Trades the council overwhelmingly favors one side on",
  },
];

// Minimum vote threshold for an item to qualify for the controversial /
// lopsided sort. Anything below this falls to the bottom so a 2-vote 1-1
// split doesn't trump a real split with 200 votes.
const MIN_VOTES_FOR_RANKED_SORT = 10;

const SCORING_FILTERS = ["all", "PPR", "Half", "Standard", "Superflex", "TEPremium"] as const;
const LEAGUE_FILTERS = ["all", "redraft", "dynasty", "keeper"] as const;

// =====================================================================
// Calculator data load — pulled in from the old /trade page so the
// calculator can render at the top of /trades. Combines mock Vegas
// projections with Supabase platform rankings + council consensus.
// =====================================================================

async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  return projectionsFromFutures(futures, roster);
}

type PlatformRow = {
  player_id: number;
  source: string;
  ranking_type: "editorial" | "adp";
  scoring_system: ScoringSystem;
  rank_value: number;
};

async function loadCalculatorPlayers(): Promise<TradePlayer[]> {
  const supabase = await createClient();
  const projections = await loadProjections();

  const [platformResult, councilResult] = await Promise.all([
    supabase
      .from("platform_rankings")
      .select("player_id, source, ranking_type, scoring_system, rank_value"),
    supabase
      .from("council_consensus")
      .select("scoring_system, player_id, avg_rank"),
  ]);

  type PerScoring = Partial<Record<ScoringSystem, number>>;
  const council = new Map<number, PerScoring>();

  const rawMap: PlatformRankingsMap = {};
  for (const r of (platformResult.data ?? []) as PlatformRow[]) {
    const player = rawMap[r.player_id] ?? (rawMap[r.player_id] = {});
    const source = player[r.source] ?? (player[r.source] = {});
    const byType = source[r.ranking_type] ?? (source[r.ranking_type] = {});
    byType[r.scoring_system] = { rank: Number(r.rank_value), points: null };
  }
  const platformMap = withMockPlatformRankings(rawMap, projections);

  for (const row of councilResult.data ?? []) {
    const existing = council.get(row.player_id as number) ?? {};
    existing[row.scoring_system as ScoringSystem] = Number(row.avg_rank);
    council.set(row.player_id as number, existing);
  }

  // PlatformRankingsMap leaf is now { rank, points }; the Trade Calculator
  // still wants a flat Record<ScoringSystem, number> of ranks, so unwrap.
  const pickRanks = (
    playerId: number,
    source: string,
    type: "editorial" | "adp",
  ): PerScoring => {
    const byScoring = platformMap[playerId]?.[source]?.[type] ?? {};
    const out: PerScoring = {};
    for (const [scoring, entry] of Object.entries(byScoring)) {
      if (entry?.rank != null) out[scoring as ScoringSystem] = entry.rank;
    }
    return out;
  };

  return projections.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    team: p.team,
    fantasyPoints: p.fantasyPoints,
    vbd: p.vbd,
    espnAdp: pickRanks(p.playerId, "espn", "adp"),
    fpAdp: pickRanks(p.playerId, "fantasypros", "adp"),
    sleeperAdp: pickRanks(p.playerId, "sleeper", "adp"),
    nflRank: pickRanks(p.playerId, "nfl", "editorial"),
    yahooRank: pickRanks(p.playerId, "yahoo", "editorial"),
    councilRank: council.get(p.playerId) ?? {},
  }));
}

export default async function TradesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: SortMode;
    scoring?: string;
    league?: string;
    a?: string;
    b?: string;
    pa?: string;
    pb?: string;
  }>;
}) {
  const params = await searchParams;
  const sortMode: SortMode = (
    SORT_OPTIONS.find((o) => o.value === params.sort)?.value ?? "recent"
  );
  const scoringFilter = (params.scoring ?? "all") as (typeof SCORING_FILTERS)[number];
  const leagueFilter = (params.league ?? "all") as (typeof LEAGUE_FILTERS)[number];

  // Load list rows and calculator players in parallel — the calculator
  // payload is small (top-200ish projections) and the list rows are
  // capped at 100 anyway. Both come from the same Supabase client.
  const supabase = await createClient();
  let query = supabase
    .from("trade_submissions")
    .select(
      "id, league_type, scoring, team_count, side_a, side_b, created_at",
    )
    .limit(100);
  if (scoringFilter !== "all") {
    query = query.eq("scoring", scoringFilter);
  }
  if (leagueFilter !== "all") {
    query = query.eq("league_type", leagueFilter);
  }
  query = query.order("created_at", { ascending: false });

  const [{ data: trades }, calcPlayers] = await Promise.all([
    query,
    loadCalculatorPlayers(),
  ]);
  const ids = (trades ?? []).map((t) => t.id);
  // Aggregate vote counts directly from trade_votes — the trade_vote_summary
  // view had a NULL-counting bug for anon votes (see migration 012). Going
  // through the raw rows keeps the source of truth in one place and lets us
  // hit it with a single IN-filtered query.
  const summariesById = new Map<string, Summary>();
  if (ids.length > 0) {
    const { data: voteRows } = await supabase
      .from("trade_votes")
      .select("trade_id, winner")
      .in("trade_id", ids);
    for (const v of (voteRows ?? []) as {
      trade_id: string;
      winner: "A" | "B" | "EVEN";
    }[]) {
      const s = summariesById.get(v.trade_id) ?? {
        total_votes: 0,
        votes_a: 0,
        votes_b: 0,
        votes_even: 0,
      };
      s.total_votes += 1;
      if (v.winner === "A") s.votes_a += 1;
      else if (v.winner === "B") s.votes_b += 1;
      else if (v.winner === "EVEN") s.votes_even += 1;
      summariesById.set(v.trade_id, s);
    }
  }

  const rows: TradeCardData[] = (trades ?? []).map((t) => ({
    id: t.id as string,
    league_type: t.league_type as string,
    scoring: t.scoring as string,
    team_count: t.team_count as number,
    side_a: t.side_a as Side,
    side_b: t.side_b as Side,
    created_at: t.created_at as string,
    summary: summariesById.get(t.id as string) ?? null,
  }));

  // Sort in app layer for the derived metrics
  if (sortMode === "popular") {
    rows.sort((a, b) => (b.summary?.total_votes ?? 0) - (a.summary?.total_votes ?? 0));
  } else if (sortMode === "controversial") {
    // Controversial = lowest max(votes_a, votes_b, votes_even) / total share.
    // Score is 1 - maxShare so HIGHER = more contested. Perfectly even three-
    // way split → 2/3. Unanimous → 0. Sub-threshold items get -1 so a 1-1
    // result with 2 votes can't dominate a real split with 200 votes.
    const split = (s: Summary | null): number => {
      if (!s || s.total_votes < MIN_VOTES_FOR_RANKED_SORT) return -1;
      const maxShare =
        Math.max(s.votes_a, s.votes_b, s.votes_even) / s.total_votes;
      return 1 - maxShare;
    };
    rows.sort((a, b) => split(b.summary) - split(a.summary));
  } else if (sortMode === "lopsided") {
    // Lopsided = highest absolute consensus toward A or B (ignoring even votes for ranking)
    const lopsidedScore = (s: Summary | null): number => {
      if (!s || s.total_votes < MIN_VOTES_FOR_RANKED_SORT) return -1;
      const a = s.votes_a / s.total_votes;
      const b = s.votes_b / s.total_votes;
      return Math.max(a, b);
    };
    rows.sort((a, b) => lopsidedScore(b.summary) - lopsidedScore(a.summary));
  }

  // Calculator + list share the URL. When the user clicks a list filter
  // we need to preserve any calculator params (a/b/pa/pb) so the trade
  // they're building doesn't get wiped. `scoring` is intentionally shared
  // between both surfaces — picking PPR on either side filters both.
  const calculatorParams = {
    a: params.a ?? "",
    b: params.b ?? "",
    pa: params.pa ?? "",
    pb: params.pb ?? "",
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">

        {/* Calculator — top of page. Empty state is compact (header +
            side cards with the Add input prominent). As soon as the user
            adds a player the verdict math drops in below. */}
        <section className="mb-6">
          <div className="mb-4 space-y-1">
            <h2 className="text-xl font-semibold sm:text-2xl">Build a trade</h2>
            <p className="text-xs text-zinc-400 sm:text-sm">
              Add players to each side. See whether the trade is fair across
              every source we track — Vegas season points, ESPN, FantasyPros,
              Sleeper, NFL, Yahoo, and the Council Consensus.
            </p>
          </div>
          <Suspense fallback={null}>
            <TradeCalculator players={calcPlayers} />
          </Suspense>
        </section>

        {/* Trade Court — below the calculator. Same surface, same URL. */}
        <section className="border-t border-zinc-800 pt-6">
          <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Trade Court</h2>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                Submitted trades. The council weighs in. Consensus emerges.
              </p>
            </div>
            <Link
              href="/trades/new"
              className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 sm:self-auto"
            >
              <Send className="h-3.5 w-3.5" />
              Submit a trade
            </Link>
          </div>

          {/* Filters + sort */}
          <div className="mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto text-xs sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterDropdown
              label="Sort"
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              current={sortMode}
              param="sort"
              otherParams={{
                scoring: scoringFilter,
                league: leagueFilter,
                ...calculatorParams,
              }}
            />
            <FilterDropdown
              label="Scoring"
              options={SCORING_FILTERS.map((s) => ({
                value: s,
                label: s === "all" ? "All scoring" : s,
              }))}
              current={scoringFilter}
              param="scoring"
              otherParams={{
                sort: sortMode,
                league: leagueFilter,
                ...calculatorParams,
              }}
            />
            <FilterDropdown
              label="League"
              options={LEAGUE_FILTERS.map((s) => ({
                value: s,
                label: s === "all" ? "All leagues" : s,
              }))}
              current={leagueFilter}
              param="league"
              otherParams={{
                sort: sortMode,
                scoring: scoringFilter,
                ...calculatorParams,
              }}
            />
            <span className="ml-auto shrink-0 text-zinc-500">
              {rows.length} trade{rows.length === 1 ? "" : "s"}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-10 text-center">
              <p className="text-lg font-bold text-emerald-300">
                No trades on the docket.
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                Submit a trade — the council will render its verdict.
              </p>
              <Link
                href="/trades/new"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30"
              >
                <Send className="h-3.5 w-3.5" />
                Submit a trade
              </Link>
            </div>
          ) : (
            <TradeListClient trades={rows} />
          )}
        </section>
      </div>
    </main>
  );
}

function FilterDropdown({
  label,
  options,
  current,
  param,
  otherParams,
}: {
  label: string;
  options: { value: string; label: string }[];
  current: string;
  param: string;
  otherParams: Record<string, string>;
}) {
  // Simple link-based filter — each option is its own URL. otherParams
  // carries forward the calculator state (a/b/pa/pb) so changing a
  // filter doesn't wipe the trade the user is building above.
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
      <span className="px-1.5 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {options.map((opt) => {
        // Drop empty values so the URL stays tidy.
        const merged: Record<string, string> = {};
        for (const [k, v] of Object.entries(otherParams)) {
          if (v) merged[k] = v;
        }
        merged[param] = opt.value;
        const qs = new URLSearchParams(merged).toString();
        const isActive = current === opt.value;
        return (
          <Link
            key={opt.value}
            href={`/trades?${qs}`}
            className={`rounded px-2 py-0.5 text-xs font-medium transition ${
              isActive
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
