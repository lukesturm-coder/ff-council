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
import { type TradeCardData } from "./TradeListClient";
import { type VerdictCardData } from "../verdict/VerdictListClient";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "../verdict/types";
import CourtListClient, { type CourtCase } from "./CourtListClient";

export const metadata: Metadata = {
  title: "Trades · FF Council",
  description:
    "Submit a trade, start/sit, or draft pick. The community votes. Consensus emerges from the crowd.",
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
    description: "Trades with the most community weigh-in",
  },
  {
    value: "controversial",
    label: "Most controversial",
    description: "Split decisions, no clear consensus",
  },
  {
    value: "lopsided",
    label: "Most lopsided",
    description: "Trades the community overwhelmingly favors one side on",
  },
];

// Minimum vote threshold for an item to qualify for the controversial /
// lopsided sort. Anything below this falls to the bottom so a 2-vote 1-1
// split doesn't trump a real split with 200 votes.
const MIN_VOTES_FOR_RANKED_SORT = 10;

const SCORING_FILTERS = ["all", "PPR", "Half", "Standard", "Superflex", "TEPremium"] as const;
const LEAGUE_FILTERS = ["all", "redraft", "dynasty", "keeper"] as const;

// Case-type chip row. Independent of Sort / Scoring / League filters.
// "All" interleaves trades + start-sit + draft picks chronologically;
// the other modes hide everything else.
type CaseTypeFilter = "all" | "trade" | "start_sit" | "draft";
const CASE_TYPE_FILTERS: { value: CaseTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trade", label: "Trades" },
  { value: "start_sit", label: "Start-Sit" },
  { value: "draft", label: "Draft Picks" },
];

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
    case?: string;
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
  const caseFilter: CaseTypeFilter =
    CASE_TYPE_FILTERS.find((o) => o.value === params.case)?.value ?? "all";

  // Load list rows and calculator players in parallel — the calculator
  // payload is small (top-200ish projections) and the list rows are
  // capped at 100 anyway. Both come from the same Supabase client.
  const supabase = await createClient();

  // Trades query — only run if the case filter allows trades.
  const wantTrades = caseFilter === "all" || caseFilter === "trade";
  // Verdicts query — only run if the case filter allows at least one
  // verdict type (start_sit / draft).
  const wantVerdicts =
    caseFilter === "all" ||
    caseFilter === "start_sit" ||
    caseFilter === "draft";

  let tradesQuery = supabase
    .from("trade_submissions")
    .select(
      "id, league_type, scoring, team_count, side_a, side_b, created_at",
    )
    .limit(100);
  if (scoringFilter !== "all") {
    tradesQuery = tradesQuery.eq("scoring", scoringFilter);
  }
  if (leagueFilter !== "all") {
    tradesQuery = tradesQuery.eq("league_type", leagueFilter);
  }
  tradesQuery = tradesQuery.order("created_at", { ascending: false });

  let verdictsQuery = supabase
    .from("verdict_scenarios")
    .select(
      "id, asker_id, scenario_type, candidates, roster, context, notes, image_url, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (caseFilter === "start_sit") {
    verdictsQuery = verdictsQuery.eq("scenario_type", "start_sit");
  } else if (caseFilter === "draft") {
    verdictsQuery = verdictsQuery.eq("scenario_type", "draft");
  }

  const [{ data: trades }, { data: scenarios }, calcPlayers] = await Promise.all([
    wantTrades
      ? tradesQuery
      : Promise.resolve({ data: [] as Awaited<typeof tradesQuery>["data"] }),
    wantVerdicts
      ? verdictsQuery
      : Promise.resolve({ data: [] as Awaited<typeof verdictsQuery>["data"] }),
    loadCalculatorPlayers(),
  ]);

  // ----- Trade vote aggregation -----
  const tradeIds = (trades ?? []).map((t) => t.id);
  const summariesById = new Map<string, Summary>();
  if (tradeIds.length > 0) {
    const { data: voteRows } = await supabase
      .from("trade_votes")
      .select("trade_id, winner")
      .in("trade_id", tradeIds);
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

  // ----- Verdict vote aggregation -----
  // Scoring filter is applied client-side because it lives inside the
  // jsonb context blob (not its own column). Cheap at 100-row scale.
  const filteredScenarios = (scenarios ?? []).filter((s) => {
    if (scoringFilter === "all") return true;
    const ctx = (s.context as VerdictContext | null) ?? {};
    return ctx.scoring === scoringFilter;
  });

  const scenarioIds = filteredScenarios.map((s) => s.id as string);
  const tallyByScenario = new Map<
    string,
    { byPlayer: Record<number, number>; total: number }
  >();
  if (scenarioIds.length > 0) {
    const { data: votes } = await supabase
      .from("verdict_votes")
      .select("scenario_id, pick_player_id")
      .in("scenario_id", scenarioIds);
    for (const v of votes ?? []) {
      const sid = v.scenario_id as string;
      const pid = v.pick_player_id as number;
      const t = tallyByScenario.get(sid) ?? { byPlayer: {}, total: 0 };
      t.byPlayer[pid] = (t.byPlayer[pid] ?? 0) + 1;
      t.total += 1;
      tallyByScenario.set(sid, t);
    }
  }

  const tradeRows: TradeCardData[] = (trades ?? []).map((t) => ({
    id: t.id as string,
    league_type: t.league_type as string,
    scoring: t.scoring as string,
    team_count: t.team_count as number,
    side_a: t.side_a as Side,
    side_b: t.side_b as Side,
    created_at: t.created_at as string,
    summary: summariesById.get(t.id as string) ?? null,
  }));

  const verdictRows: VerdictCardData[] = filteredScenarios.map((s) => ({
    id: s.id as string,
    scenario_type: s.scenario_type as VerdictScenarioType,
    candidates: (s.candidates as VerdictPlayer[]) ?? [],
    roster: (s.roster as VerdictPlayer[] | null) ?? null,
    context: (s.context as VerdictContext) ?? {},
    notes: (s.notes as string | null) ?? null,
    image_url: (s.image_url as string | null) ?? null,
    created_at: s.created_at as string,
    tally: tallyByScenario.get(s.id as string) ?? { byPlayer: {}, total: 0 },
  }));

  // ----- Build the unified case list -----
  // Each entry carries the kind discriminator + the per-type payload.
  // Default order is created_at desc; the derived-metric sort modes
  // re-rank below using each case's vote share.
  const allCases: CourtCase[] = [
    ...tradeRows.map(
      (t): CourtCase => ({
        kind: "trade",
        created_at: t.created_at,
        data: t,
      }),
    ),
    ...verdictRows.map(
      (v): CourtCase => ({
        kind: "verdict",
        created_at: v.created_at,
        data: v,
      }),
    ),
  ];

  // Helpers for the unified sort modes. Trades and verdicts have
  // different shapes, so we project each into a (total, splitScore,
  // lopsidedScore) tuple and rank against the combined feed.
  const totalVotes = (c: CourtCase): number =>
    c.kind === "trade"
      ? c.data.summary?.total_votes ?? 0
      : c.data.tally.total;

  const splitScore = (c: CourtCase): number => {
    if (c.kind === "trade") {
      const s = c.data.summary;
      if (!s || s.total_votes < MIN_VOTES_FOR_RANKED_SORT) return -1;
      const maxShare =
        Math.max(s.votes_a, s.votes_b, s.votes_even) / s.total_votes;
      return 1 - maxShare;
    }
    const t = c.data.tally;
    if (t.total < MIN_VOTES_FOR_RANKED_SORT) return -1;
    const shares = Object.values(t.byPlayer)
      .filter((n) => n > 0)
      .map((n) => n / t.total)
      .sort((a, b) => b - a);
    if (shares.length < 2) return -1;
    return 1 - (shares[0] - shares[1]);
  };

  const lopsidedScore = (c: CourtCase): number => {
    if (c.kind === "trade") {
      const s = c.data.summary;
      if (!s || s.total_votes < MIN_VOTES_FOR_RANKED_SORT) return -1;
      return Math.max(s.votes_a, s.votes_b) / s.total_votes;
    }
    const t = c.data.tally;
    if (t.total < MIN_VOTES_FOR_RANKED_SORT) return -1;
    const shares = Object.values(t.byPlayer)
      .filter((n) => n > 0)
      .map((n) => n / t.total);
    return shares.length > 0 ? Math.max(...shares) : -1;
  };

  // Sort the unified feed. "recent" keeps the chronological interleave;
  // other modes use the derived projections above.
  if (sortMode === "recent") {
    allCases.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  } else if (sortMode === "popular") {
    allCases.sort((a, b) => totalVotes(b) - totalVotes(a));
  } else if (sortMode === "controversial") {
    allCases.sort((a, b) => {
      const diff = splitScore(b) - splitScore(a);
      if (diff !== 0) return diff;
      return a.created_at < b.created_at ? 1 : -1;
    });
  } else if (sortMode === "lopsided") {
    allCases.sort((a, b) => {
      const diff = lopsidedScore(b) - lopsidedScore(a);
      if (diff !== 0) return diff;
      return a.created_at < b.created_at ? 1 : -1;
    });
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
            adds a player the verdict math drops in below. Trade-only —
            verdicts have their own submit flow via /trades/new. */}
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

        {/* Open questions — unified feed. Trades + tough calls in one
            chronologically-sorted list. Same surface, same URL. */}
        <section className="border-t border-zinc-800 pt-6">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            What the community is voting on
          </div>
          <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Open questions</h2>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                Submit a trade or tough call. The community votes. Consensus
                emerges.
              </p>
            </div>
            <Link
              href="/trades/new"
              className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 sm:self-auto"
            >
              <Send className="h-3.5 w-3.5" />
              Submit a question
            </Link>
          </div>

          {/* Case-type chip row — independent of Sort / Scoring / League.
              Sits above the other filters because it changes WHICH rows
              you see, not how they're ranked. */}
          <div className="mb-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CASE_TYPE_FILTERS.map((opt) => {
              const merged: Record<string, string> = {};
              for (const [k, v] of Object.entries({
                sort: sortMode,
                scoring: scoringFilter,
                league: leagueFilter,
                ...calculatorParams,
              })) {
                if (v) merged[k] = v;
              }
              if (opt.value !== "all") merged.case = opt.value;
              const qs = new URLSearchParams(merged).toString();
              const isActive = caseFilter === opt.value;
              return (
                <Link
                  key={opt.value}
                  href={qs ? `/trades?${qs}` : "/trades"}
                  className={`shrink-0 rounded-full px-3 py-1 font-medium transition ${
                    isActive
                      ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-500/40"
                      : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  {opt.label}
                </Link>
              );
            })}
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
                case: caseFilter === "all" ? "" : caseFilter,
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
                case: caseFilter === "all" ? "" : caseFilter,
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
                case: caseFilter === "all" ? "" : caseFilter,
                ...calculatorParams,
              }}
            />
            <span className="ml-auto shrink-0 text-zinc-500">
              {allCases.length} open
            </span>
          </div>

          {allCases.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-10 text-center">
              <p className="text-lg font-bold text-emerald-300">
                Nothing open yet.
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                Submit a trade or tough call — the community will weigh in.
              </p>
              <Link
                href="/trades/new"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30"
              >
                <Send className="h-3.5 w-3.5" />
                Submit a question
              </Link>
            </div>
          ) : (
            <CourtListClient cases={allCases} />
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
