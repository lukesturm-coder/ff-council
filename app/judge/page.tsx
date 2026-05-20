import type { Metadata } from "next";
import Link from "next/link";
import { Send, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type TradeCardData } from "../trades/TradeListClient";
import { type VerdictCardData } from "../verdict/VerdictListClient";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "../verdict/types";
import JudgeListClient, { type CourtCase } from "./JudgeListClient";

export const metadata: Metadata = {
  title: "Judge · FF Council",
  description:
    "Every case the council is weighing — trades, start/sit, and draft calls. Browse, filter, and vote. Consensus emerges from the crowd.",
};

// =====================================================================
// /judge — the community hub. Every submitted case lives here: trades,
// start/sit, and draft picks, interleaved newest-first. Users browse,
// filter by type, and vote (TradeModal / VerdictModal). Two side doors:
//   - "Speed vote →"      → /judge/feed (rapid one-tap feed)
//   - "Post a tough call" → /verdict/new
//
// Built on the restored CourtListClient pattern (JudgeListClient).
// =====================================================================

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

// Summary fields used by the list cards — vote counts for the verdict
// chip + the derived sort modes, plus the per-side fairness-tier
// breakdown that drives the card's severity verdict.
type FairnessTier =
  | "balanced"
  | "slight_edge"
  | "clear_advantage"
  | "major_advantage"
  | "extreme_imbalance";
type Summary = {
  total_votes: number;
  votes_a: number;
  votes_b: number;
  votes_even: number;
  tiers_a: Partial<Record<FairnessTier, number>>;
  tiers_b: Partial<Record<FairnessTier, number>>;
};

type SortMode = "recent" | "controversial" | "lopsided" | "popular";
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "popular", label: "Most voted" },
  { value: "controversial", label: "Most controversial" },
  { value: "lopsided", label: "Most lopsided" },
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
  { value: "start_sit", label: "Start/Sit" },
  { value: "draft", label: "Draft Picks" },
];

export default async function JudgePage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: SortMode;
    scoring?: string;
    league?: string;
    case?: string;
  }>;
}) {
  const params = await searchParams;
  const sortMode: SortMode =
    SORT_OPTIONS.find((o) => o.value === params.sort)?.value ?? "recent";
  const scoringFilter = (params.scoring ?? "all") as (typeof SCORING_FILTERS)[number];
  const leagueFilter = (params.league ?? "all") as (typeof LEAGUE_FILTERS)[number];
  const caseFilter: CaseTypeFilter =
    CASE_TYPE_FILTERS.find((o) => o.value === params.case)?.value ?? "all";

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
    .select("id, league_type, scoring, team_count, side_a, side_b, created_at")
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

  const [{ data: trades }, { data: scenarios }] = await Promise.all([
    wantTrades
      ? tradesQuery
      : Promise.resolve({ data: [] as Awaited<typeof tradesQuery>["data"] }),
    wantVerdicts
      ? verdictsQuery
      : Promise.resolve({ data: [] as Awaited<typeof verdictsQuery>["data"] }),
  ]);

  // ----- Trade vote aggregation -----
  const tradeIds = (trades ?? []).map((t) => t.id);
  const summariesById = new Map<string, Summary>();
  if (tradeIds.length > 0) {
    const { data: voteRows } = await supabase
      .from("trade_votes")
      .select("trade_id, winner, fairness_tier")
      .in("trade_id", tradeIds);
    for (const v of (voteRows ?? []) as {
      trade_id: string;
      winner: "A" | "B" | "EVEN";
      fairness_tier: FairnessTier | null;
    }[]) {
      const s = summariesById.get(v.trade_id) ?? {
        total_votes: 0,
        votes_a: 0,
        votes_b: 0,
        votes_even: 0,
        tiers_a: {},
        tiers_b: {},
      };
      s.total_votes += 1;
      if (v.winner === "A") {
        s.votes_a += 1;
        if (v.fairness_tier) {
          s.tiers_a[v.fairness_tier] = (s.tiers_a[v.fairness_tier] ?? 0) + 1;
        }
      } else if (v.winner === "B") {
        s.votes_b += 1;
        if (v.fairness_tier) {
          s.tiers_b[v.fairness_tier] = (s.tiers_b[v.fairness_tier] ?? 0) + 1;
        }
      } else if (v.winner === "EVEN") s.votes_even += 1;
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
    c.kind === "trade" ? c.data.summary?.total_votes ?? 0 : c.data.tally.total;

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

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
        {/* Header — the hub's two prominent side doors live here:
            speed-vote (rapid one-tap) + post-a-tough-call. The browse
            list below is the default view. */}
        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold sm:text-2xl">Judge</h2>
            <p className="text-xs text-zinc-400 sm:text-sm">
              Every case the council is weighing — trades, start/sit, and draft
              calls. Tap a case to cast your vote.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/judge/feed"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              <Zap className="h-4 w-4" />
              Speed vote
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/verdict/new"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              <Send className="h-3.5 w-3.5" />
              Post a tough call
            </Link>
          </div>
        </div>

        {/* Case-type chip row — independent of Sort / Scoring / League.
            Sits above the other filters because it changes WHICH rows you
            see, not how they're ranked. */}
        <div className="mb-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CASE_TYPE_FILTERS.map((opt) => {
            const merged: Record<string, string> = {};
            for (const [k, v] of Object.entries({
              sort: sortMode,
              scoring: scoringFilter,
              league: leagueFilter,
            })) {
              if (v && v !== "all" && v !== "recent") merged[k] = v;
            }
            if (opt.value !== "all") merged.case = opt.value;
            const qs = new URLSearchParams(merged).toString();
            const isActive = caseFilter === opt.value;
            return (
              <Link
                key={opt.value}
                href={qs ? `/judge?${qs}` : "/judge"}
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
            }}
          />
          <span className="ml-auto shrink-0 text-zinc-500">
            {allCases.length} case{allCases.length === 1 ? "" : "s"}
          </span>
        </div>

        {allCases.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-10 text-center">
            <p className="text-lg font-bold text-emerald-300">No open cases.</p>
            <p className="mt-2 text-sm text-zinc-300">
              Post a tough call or submit a trade — the council will render its
              verdict.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/verdict/new"
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30"
              >
                <Send className="h-3.5 w-3.5" />
                Post a tough call
              </Link>
              <Link
                href="/trades"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Analyze a trade
              </Link>
            </div>
          </div>
        ) : (
          <JudgeListClient cases={allCases} />
        )}
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
  // Simple link-based filter — each option is its own URL. Default values
  // ("all", "recent") are dropped so the URL stays tidy.
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
      <span className="px-1.5 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {options.map((opt) => {
        const merged: Record<string, string> = {};
        for (const [k, v] of Object.entries(otherParams)) {
          if (v && v !== "all" && v !== "recent") merged[k] = v;
        }
        if (opt.value !== "all" && opt.value !== "recent") {
          merged[param] = opt.value;
        }
        const qs = new URLSearchParams(merged).toString();
        const isActive = current === opt.value;
        return (
          <Link
            key={opt.value}
            href={qs ? `/judge?${qs}` : "/judge"}
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
