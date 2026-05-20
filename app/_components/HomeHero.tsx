import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// =====================================================================
// HomeHero — landing hero shown above the rankings table.
//
// Purpose: give first-time visitors a one-screen pitch for the product
// before they hit the dense rankings grid. Two columns on desktop:
//   - Left:  the message + primary CTAs ("Weigh in" → /judge, "Analyze a
//            trade" → /trades, "Post a tough call" → /verdict/new)
//   - Right: live proof — four small stat cards seeded from the DB so
//            the hero feels alive instead of static marketing copy.
//
// Server component — all queries run inline with the existing home-page
// Promise.all. No hydration cost.
//
// Visual style: zinc-950 base with a soft emerald radial glow behind the
// content. We keep the glow subtle (low opacity, blurred) so it reads as
// atmosphere, not a beacon.
// =====================================================================

type HeroStats = {
  votes: number;
  scenarios: number;
  tradesJudged: number;
};

// Cheap, head-only count queries where possible. For "distinct trade_id"
// we pull just the column (no joins, no scenario payload) and dedupe in
// memory — Supabase's count modifier doesn't support DISTINCT directly,
// and we explicitly can't depend on the trade_vote_summary view.
export async function loadHeroStats(): Promise<HeroStats> {
  const supabase = await createClient();

  const [
    tradeVotesCountRes,
    verdictVotesCountRes,
    verdictScenariosCountRes,
    tradeSubmissionsCountRes,
    tradeVotesIdsRes,
  ] = await Promise.all([
    supabase
      .from("trade_votes")
      .select("trade_id", { count: "exact", head: true }),
    supabase
      .from("verdict_votes")
      .select("scenario_id", { count: "exact", head: true }),
    supabase
      .from("verdict_scenarios")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("trade_submissions")
      .select("id", { count: "exact", head: true }),
    // Distinct trade_id count — fetch column-only and dedupe locally.
    // Cheap because trade_votes is a slim table and we only need the id
    // column. If/when this grows we can move it behind an RPC.
    supabase.from("trade_votes").select("trade_id"),
  ]);

  const votes =
    (tradeVotesCountRes.count ?? 0) + (verdictVotesCountRes.count ?? 0);
  const scenarios =
    (verdictScenariosCountRes.count ?? 0) +
    (tradeSubmissionsCountRes.count ?? 0);

  const distinctTradeIds = new Set<string>();
  for (const row of (tradeVotesIdsRes.data ?? []) as Array<{
    trade_id: string;
  }>) {
    if (row.trade_id) distinctTradeIds.add(row.trade_id);
  }

  return {
    votes,
    scenarios,
    tradesJudged: distinctTradeIds.size,
  };
}

function StatCard({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-3">
      <div className="text-xl font-semibold tracking-tight text-emerald-400 sm:text-2xl">
        {value}
      </div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-zinc-400">
        {label}
      </div>
    </div>
  );
}

function LiveCard() {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="text-sm font-semibold text-emerald-300">Live</span>
      </div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-zinc-400">
        Council is voting now
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return n.toLocaleString();
  return n.toString();
}

export default function HomeHero({ stats }: { stats: HeroStats }) {
  return (
    <section
      aria-label="Welcome"
      className="relative mb-5 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950 sm:mb-6"
      style={{
        // Soft emerald radial glow — atmospheric, not a flashlight.
        // Two stacked gradients give the glow a slight diagonal feel
        // without needing a separate decorative element.
        backgroundImage:
          "radial-gradient(60% 80% at 15% 20%, rgba(16, 185, 129, 0.18), transparent 70%), radial-gradient(50% 70% at 90% 90%, rgba(16, 185, 129, 0.10), transparent 70%)",
      }}
    >
      <div className="grid min-h-[280px] grid-cols-1 gap-6 px-5 py-7 sm:px-7 sm:py-9 lg:min-h-[400px] lg:grid-cols-[1.4fr_1fr] lg:gap-10 lg:px-10 lg:py-12">
        {/* Left: message + CTAs */}
        <div className="flex flex-col justify-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl lg:text-5xl">
            Crowdsourced fantasy{" "}
            <span className="text-emerald-400">verdicts.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-zinc-300 sm:text-lg">
            The Council judges. You weigh in. Real consensus, not buried in
            Reddit comments.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/judge"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-6 py-3 text-base font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Weigh in
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/trades"
              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/50 px-6 py-3 text-base font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800/60"
            >
              Analyze a trade
            </Link>
            <Link
              href="/verdict/new"
              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/50 px-6 py-3 text-base font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800/60"
            >
              Post a tough call
            </Link>
          </div>
        </div>

        {/* Right: 2x2 proof grid */}
        <div className="grid grid-cols-2 gap-3 self-center sm:gap-4">
          <StatCard
            value={formatCount(stats.votes)}
            label="votes cast"
          />
          <StatCard
            value={formatCount(stats.scenarios)}
            label="scenarios active"
          />
          <StatCard
            value={formatCount(stats.tradesJudged)}
            label="trades judged"
          />
          <LiveCard />
        </div>
      </div>
    </section>
  );
}
