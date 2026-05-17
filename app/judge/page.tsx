import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import JudgeFeed, { type JudgeItem } from "./JudgeFeed";

// /judge — single-card full-screen feed of unvoted scenarios. Mixed feed
// of trade-court trades + verdict scenarios, ordered by recency. Optimised
// for high-throughput one-tap voting. Filters (type, league, scoring)
// live in URL search params so they survive refresh.

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
  { value: "verdicts", label: "Verdicts only" },
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

export default async function JudgePage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    league?: string;
    scoring?: string;
  }>;
}) {
  const params = await searchParams;
  const typeFilter =
    TYPE_OPTIONS.find((o) => o.value === params.type)?.value ?? "all";
  const leagueFilter =
    LEAGUE_OPTIONS.find((o) => o.value === params.league)?.value ?? "all";
  const scoringFilter =
    SCORING_OPTIONS.find((o) => o.value === params.scoring)?.value ?? "all";

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
  const verdictQuery = supabase
    .from("verdict_scenarios")
    .select(
      "id, scenario_type, candidates, roster, context, notes, image_url, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(80);

  // Skip fetches we don't need based on the type filter (saves a round-trip
  // and keeps the data small for the longest possible feed when one type
  // is selected).
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

  const anyFilterActive =
    typeFilter !== "all" || leagueFilter !== "all" || scoringFilter !== "all";

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

        {/* Filters — pill rows. Each pill is a Link so URL params drive state. */}
        <div className="mb-4 space-y-2">
          <FilterRow
            label="Type"
            options={TYPE_OPTIONS}
            current={typeFilter}
            paramName="type"
            otherParams={{ league: leagueFilter, scoring: scoringFilter }}
          />
          {typeFilter !== "verdicts" && (
            <FilterRow
              label="League"
              options={LEAGUE_OPTIONS}
              current={leagueFilter}
              paramName="league"
              otherParams={{ type: typeFilter, scoring: scoringFilter }}
            />
          )}
          <FilterRow
            label="Scoring"
            options={SCORING_OPTIONS}
            current={scoringFilter}
            paramName="scoring"
            otherParams={{ type: typeFilter, league: leagueFilter }}
          />
        </div>

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
                  href="/judge"
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  Clear filters
                </Link>
              )}
              <Link
                href="/verdict/new"
                className="rounded-md bg-emerald-500/20 px-4 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30"
              >
                Post a verdict scenario
              </Link>
              <Link
                href="/trades/new"
                className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Post a trade
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
  // Default values ("all") are omitted to keep URLs short and clean.
  function hrefFor(value: string): string {
    const params: Record<string, string> = { ...otherParams, [paramName]: value };
    const entries = Object.entries(params).filter(([, v]) => v && v !== "all");
    if (entries.length === 0) return "/judge";
    const qs = new URLSearchParams(entries).toString();
    return `/judge?${qs}`;
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
