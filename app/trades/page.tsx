import Link from "next/link";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import Header from "@/app/_components/Header";

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

type Summary = {
  total_votes: number;
  votes_a: number;
  votes_b: number;
  votes_even: number;
  tier_balanced: number;
  tier_slight_edge: number;
  tier_clear_advantage: number;
  tier_major_advantage: number;
  tier_extreme_imbalance: number;
};

type TradeListRow = {
  id: string;
  league_type: string;
  scoring: string;
  team_count: number;
  side_a: Side;
  side_b: Side;
  created_at: string;
  summary: Summary | null;
};

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
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

const SCORING_FILTERS = ["all", "PPR", "Half", "Standard", "Superflex", "TEPremium"] as const;
const LEAGUE_FILTERS = ["all", "redraft", "dynasty", "keeper"] as const;

export default async function TradesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: SortMode;
    scoring?: string;
    league?: string;
  }>;
}) {
  const params = await searchParams;
  const sortMode: SortMode = (
    SORT_OPTIONS.find((o) => o.value === params.sort)?.value ?? "recent"
  );
  const scoringFilter = (params.scoring ?? "all") as (typeof SCORING_FILTERS)[number];
  const leagueFilter = (params.league ?? "all") as (typeof LEAGUE_FILTERS)[number];

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

  const { data: trades } = await query;
  const ids = (trades ?? []).map((t) => t.id);
  let summariesById = new Map<string, Summary>();
  if (ids.length > 0) {
    const { data: summaries } = await supabase
      .from("trade_vote_summary")
      .select("*")
      .in("trade_id", ids);
    summariesById = new Map(
      (summaries ?? []).map((s) => [
        s.trade_id as string,
        {
          total_votes: Number(s.total_votes),
          votes_a: Number(s.votes_a),
          votes_b: Number(s.votes_b),
          votes_even: Number(s.votes_even),
          tier_balanced: Number(s.tier_balanced),
          tier_slight_edge: Number(s.tier_slight_edge),
          tier_clear_advantage: Number(s.tier_clear_advantage),
          tier_major_advantage: Number(s.tier_major_advantage),
          tier_extreme_imbalance: Number(s.tier_extreme_imbalance),
        },
      ]),
    );
  }

  const rows: TradeListRow[] = (trades ?? []).map((t) => ({
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
    // Controversial = closest to even three-way split among A/B/EVEN votes.
    const split = (s: Summary | null): number => {
      if (!s || s.total_votes === 0) return -1;
      const a = s.votes_a / s.total_votes;
      const b = s.votes_b / s.total_votes;
      const e = s.votes_even / s.total_votes;
      // 1 = perfectly split, 0 = unanimous
      const ideal = 1 / 3;
      return 1 - (Math.abs(a - ideal) + Math.abs(b - ideal) + Math.abs(e - ideal)) / 2;
    };
    rows.sort((a, b) => split(b.summary) - split(a.summary));
  } else if (sortMode === "lopsided") {
    // Lopsided = highest absolute consensus toward A or B (ignoring even votes for ranking)
    const lopsidedScore = (s: Summary | null): number => {
      if (!s || s.total_votes === 0) return -1;
      const a = s.votes_a / s.total_votes;
      const b = s.votes_b / s.total_votes;
      return Math.max(a, b);
    };
    rows.sort((a, b) => lopsidedScore(b.summary) - lopsidedScore(a.summary));
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <Header />

        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Trade Court</h2>
            <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
              Submit a fantasy trade. The council weighs in. Consensus emerges.
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
            otherParams={{ scoring: scoringFilter, league: leagueFilter }}
          />
          <FilterDropdown
            label="Scoring"
            options={SCORING_FILTERS.map((s) => ({
              value: s,
              label: s === "all" ? "All scoring" : s,
            }))}
            current={scoringFilter}
            param="scoring"
            otherParams={{ sort: sortMode, league: leagueFilter }}
          />
          <FilterDropdown
            label="League"
            options={LEAGUE_FILTERS.map((s) => ({
              value: s,
              label: s === "all" ? "All leagues" : s,
            }))}
            current={leagueFilter}
            param="league"
            otherParams={{ sort: sortMode, scoring: scoringFilter }}
          />
          <span className="ml-auto shrink-0 text-zinc-500">
            {rows.length} trade{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-center text-sm text-zinc-400">
            No trades match these filters yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((t) => (
              <TradeListCard key={t.id} trade={t} />
            ))}
          </div>
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
  // Simple link-based filter — each option is its own URL.
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
      <span className="px-1.5 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {options.map((opt) => {
        const allParams = { ...otherParams, [param]: opt.value };
        const qs = new URLSearchParams(allParams).toString();
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

function TradeListCard({ trade }: { trade: TradeListRow }) {
  const total = trade.summary?.total_votes ?? 0;
  const aPct =
    total > 0 ? Math.round(((trade.summary?.votes_a ?? 0) / total) * 100) : 0;
  const bPct =
    total > 0 ? Math.round(((trade.summary?.votes_b ?? 0) / total) * 100) : 0;
  const evenPct = total > 0 ? 100 - aPct - bPct : 0;

  const verdict =
    total === 0
      ? "No votes yet"
      : aPct > bPct && aPct > evenPct
        ? `${aPct}% favor Team A`
        : bPct > aPct && bPct > evenPct
          ? `${bPct}% favor Team B`
          : `${evenPct}% even`;

  return (
    <Link
      href={`/trades/${trade.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:p-4"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
        <SidePreview side={trade.side_a} accent="rose" />
        <div className="flex items-center justify-center text-xs text-zinc-500">
          ↔
        </div>
        <SidePreview side={trade.side_b} accent="sky" />
        <div className="col-span-3 flex flex-row items-center justify-between gap-1 border-t border-zinc-800 pt-2 text-xs md:col-span-1 md:flex-col md:items-end md:justify-center md:border-t-0 md:pt-0">
          <span className="font-medium text-zinc-200">{verdict}</span>
          <span className="text-zinc-500">
            {total} vote{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span>{trade.league_type}</span>
        <span>·</span>
        <span>{trade.scoring}</span>
        <span>·</span>
        <span>{trade.team_count} teams</span>
        <span>·</span>
        <span>{new Date(trade.created_at).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}

function SidePreview({ side, accent }: { side: Side; accent: "rose" | "sky" }) {
  const color = accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div className="space-y-1">
      {side.players.slice(0, 3).map((p, idx) => (
        <div key={`p-${idx}`} className="flex items-center gap-2 text-sm">
          {p.position && POSITION_STYLES[p.position] && (
            <span
              className={`inline-flex rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
            >
              {p.position}
            </span>
          )}
          <span className="truncate text-zinc-100">{p.name}</span>
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            {p.team}
          </span>
        </div>
      ))}
      {side.picks.slice(0, 2).map((pk, idx) => (
        <div key={`pk-${idx}`} className="flex items-center gap-2 text-sm">
          <span className={`text-[10px] uppercase tracking-wider ${color}`}>
            pick
          </span>
          <span className="font-mono text-xs text-zinc-300">
            {pk.year} R{pk.round}
          </span>
        </div>
      ))}
      {side.players.length + side.picks.length > 5 && (
        <p className="text-xs text-zinc-600">
          + {side.players.length + side.picks.length - 5} more
        </p>
      )}
    </div>
  );
}
