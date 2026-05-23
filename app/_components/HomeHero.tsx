import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadTrending } from "@/lib/trending";

// =====================================================================
// HomeHero — compact, live "fantasy sentiment terminal" hero.
//
// Left:  the value prop + the three primary CTAs.
// Right: a terminal-style panel — a LIVE pulse, the headline counters, and
//        a couple of live tickers (top riser, most-divided trade) so the
//        page reads as an active product, not a marketing splash.
//
// Server component — queries run inline with the home-page render.
// =====================================================================

type Ticker = { label: string; value: string; up?: boolean } | null;

type HeroStats = {
  votes: number;
  scenarios: number;
  tradesJudged: number;
  topRiser: { name: string; change: number } | null;
  mostDivided: { headline: string; aPct: number; bPct: number } | null;
};

type SidePlayer = { name?: string };
type SidePick = { year: number; round: number };
type Side = { players?: SidePlayer[]; picks?: SidePick[] } | null;

function firstAsset(side: Side): string {
  if (!side) return "—";
  const p = side.players?.[0]?.name;
  if (p) return p;
  const pk = side.picks?.[0];
  if (pk) return `${pk.year} R${pk.round}`;
  return "—";
}

export async function loadHeroStats(): Promise<HeroStats> {
  const supabase = await createClient();

  const [
    tradeVotesCountRes,
    verdictVotesCountRes,
    verdictScenariosCountRes,
    tradeSubmissionsCountRes,
    tradeVotesIdsRes,
    recentTradesRes,
    trending,
  ] = await Promise.all([
    supabase.from("trade_votes").select("trade_id", { count: "exact", head: true }),
    supabase.from("verdict_votes").select("scenario_id", { count: "exact", head: true }),
    supabase.from("verdict_scenarios").select("id", { count: "exact", head: true }),
    supabase.from("trade_submissions").select("id", { count: "exact", head: true }),
    supabase.from("trade_votes").select("trade_id"),
    supabase
      .from("trade_submissions")
      .select("id, side_a, side_b")
      .order("created_at", { ascending: false })
      .limit(50),
    loadTrending("PPR"),
  ]);

  const votes =
    (tradeVotesCountRes.count ?? 0) + (verdictVotesCountRes.count ?? 0);
  const scenarios =
    (verdictScenariosCountRes.count ?? 0) +
    (tradeSubmissionsCountRes.count ?? 0);

  const distinctTradeIds = new Set<string>();
  for (const row of (tradeVotesIdsRes.data ?? []) as Array<{ trade_id: string }>) {
    if (row.trade_id) distinctTradeIds.add(row.trade_id);
  }

  // Most-divided trade: the closest A/B split among recently-voted trades.
  const recentTrades = (recentTradesRes.data ?? []) as Array<{
    id: string;
    side_a: Side;
    side_b: Side;
  }>;
  let mostDivided: HeroStats["mostDivided"] = null;
  if (recentTrades.length > 0) {
    const { data: voteRows } = await supabase
      .from("trade_votes")
      .select("trade_id, winner")
      .in(
        "trade_id",
        recentTrades.map((t) => t.id),
      );
    const tally = new Map<string, { a: number; b: number; total: number }>();
    for (const v of (voteRows ?? []) as { trade_id: string; winner: string }[]) {
      const t = tally.get(v.trade_id) ?? { a: 0, b: 0, total: 0 };
      t.total += 1;
      if (v.winner === "A") t.a += 1;
      else if (v.winner === "B") t.b += 1;
      tally.set(v.trade_id, t);
    }
    let best = -1;
    for (const tr of recentTrades) {
      const t = tally.get(tr.id);
      if (!t || t.total < 5) continue;
      const aPct = Math.round((t.a / t.total) * 100);
      const bPct = Math.round((t.b / t.total) * 100);
      const divisiveness = Math.min(aPct, bPct);
      if (divisiveness > best) {
        best = divisiveness;
        mostDivided = {
          headline: `${firstAsset(tr.side_a)} ↔ ${firstAsset(tr.side_b)}`,
          aPct,
          bPct,
        };
      }
    }
  }

  const topRiser = trending.risers[0]
    ? { name: trending.risers[0].name, change: trending.risers[0].change }
    : null;

  return {
    votes,
    scenarios,
    tradesJudged: distinctTradeIds.size,
    topRiser,
    mostDivided,
  };
}

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return n.toLocaleString();
  return n.toString();
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div className="text-lg font-semibold tabular-nums text-emerald-300">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}

function TickerRow({ icon, t }: { icon: string; t: NonNullable<Ticker> }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <span className={t.up ? "text-emerald-400" : "text-zinc-500"}>{icon}</span>
      <span className="shrink-0 text-zinc-500">{t.label}</span>
      <span className="ml-auto min-w-0 truncate text-right text-zinc-200">
        {t.value}
      </span>
    </div>
  );
}

function Terminal({ stats }: { stats: HeroStats }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80 font-mono">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="flex items-center gap-2">
          <LiveDot />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            Live
          </span>
          <span className="text-[11px] text-zinc-500">council is voting</span>
        </span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">
          FF&nbsp;Council
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800">
        <Metric value={formatCount(stats.votes)} label="votes" />
        <Metric value={formatCount(stats.scenarios)} label="scenarios" />
        <Metric value={formatCount(stats.tradesJudged)} label="judged" />
      </div>

      <div className="divide-y divide-zinc-800/70">
        {stats.topRiser && (
          <TickerRow
            icon="▲"
            t={{
              label: "Trending",
              value: `${stats.topRiser.name} +${stats.topRiser.change}`,
              up: true,
            }}
          />
        )}
        {stats.mostDivided && (
          <TickerRow
            icon="⚖"
            t={{
              label: "Most divided",
              value: `${stats.mostDivided.headline} · ${stats.mostDivided.aPct}/${stats.mostDivided.bPct}`,
            }}
          />
        )}
        <TickerRow
          icon="●"
          t={{ label: "Status", value: "open for verdicts" }}
        />
      </div>
    </div>
  );
}

export default function HomeHero({ stats }: { stats: HeroStats }) {
  return (
    <section
      aria-label="Welcome"
      className="relative mb-4 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950"
      style={{
        backgroundImage:
          "radial-gradient(55% 80% at 12% 15%, rgba(16, 185, 129, 0.16), transparent 70%), radial-gradient(45% 70% at 92% 95%, rgba(16, 185, 129, 0.08), transparent 70%)",
      }}
    >
      <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-8 lg:px-8">
        {/* Left: value prop + CTAs */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl lg:text-4xl">
            Crowdsourced fantasy{" "}
            <span className="text-emerald-400">verdicts.</span>
          </h1>
          <p className="mt-2 max-w-lg text-sm text-zinc-300 sm:text-base">
            The Council judges trades, rankings, and tough calls in real time.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/judge"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Weigh in
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/trades"
              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/50 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800/60"
            >
              Analyze a trade
            </Link>
            <Link
              href="/verdict/new"
              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/50 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800/60"
            >
              Post a tough call
            </Link>
          </div>
        </div>

        {/* Right: live terminal */}
        <Terminal stats={stats} />
      </div>
    </section>
  );
}
