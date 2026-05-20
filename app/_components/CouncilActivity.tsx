import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// =====================================================================
// CouncilActivity — home-page doorway into Trades + Tough Calls.
// Renders the 3 most-voted trade scenarios and the 3 most-voted
// verdict scenarios as small cards. Goal: give people landing on
// the rankings home a low-friction next step into the voting loop.
//
// Vote counts are aggregated directly from the raw vote tables —
// the trade_vote_summary view has a known anon-vote NULL bug
// (see migration 012) so we sum trade_votes ourselves.
// =====================================================================

const MIN_VOTES = 5;

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
  side_a: Side;
  side_b: Side;
  league_type: string;
  scoring: string;
};

type TradeCard = TradeRow & {
  totalVotes: number;
  votesA: number;
  votesB: number;
  votesEven: number;
};

type VerdictPlayerMini = {
  player_id: number;
  name: string;
  team: string;
  position: string;
};

type VerdictRow = {
  id: string;
  scenario_type: "draft" | "start_sit";
  candidates: VerdictPlayerMini[];
  context: { scoring?: string; week?: number | null; round?: number | null } | null;
};

type VerdictCard = VerdictRow & {
  totalVotes: number;
  topPick: VerdictPlayerMini | null;
  topPickPct: number;
};

async function loadTopTrades(): Promise<TradeCard[]> {
  const supabase = await createClient();
  // Pull a wider net (60 most recent) then sort by vote count in-app.
  // The volume here is tiny; one IN query gets the votes for all of them.
  const { data: trades } = await supabase
    .from("trade_submissions")
    .select("id, side_a, side_b, league_type, scoring")
    .order("created_at", { ascending: false })
    .limit(60);
  if (!trades || trades.length === 0) return [];

  const ids = trades.map((t) => t.id as string);
  const { data: voteRows } = await supabase
    .from("trade_votes")
    .select("trade_id, winner")
    .in("trade_id", ids);

  const tally = new Map<
    string,
    { total: number; a: number; b: number; even: number }
  >();
  for (const v of (voteRows ?? []) as {
    trade_id: string;
    winner: "A" | "B" | "EVEN";
  }[]) {
    const t = tally.get(v.trade_id) ?? { total: 0, a: 0, b: 0, even: 0 };
    t.total += 1;
    if (v.winner === "A") t.a += 1;
    else if (v.winner === "B") t.b += 1;
    else if (v.winner === "EVEN") t.even += 1;
    tally.set(v.trade_id, t);
  }

  const cards: TradeCard[] = trades.map((t) => {
    const c = tally.get(t.id as string) ?? { total: 0, a: 0, b: 0, even: 0 };
    return {
      id: t.id as string,
      side_a: t.side_a as Side,
      side_b: t.side_b as Side,
      league_type: t.league_type as string,
      scoring: t.scoring as string,
      totalVotes: c.total,
      votesA: c.a,
      votesB: c.b,
      votesEven: c.even,
    };
  });

  return cards
    .filter((c) => c.totalVotes >= MIN_VOTES)
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 3);
}

async function loadTopVerdicts(): Promise<VerdictCard[]> {
  const supabase = await createClient();
  const { data: scenarios } = await supabase
    .from("verdict_scenarios")
    .select("id, scenario_type, candidates, context")
    .order("created_at", { ascending: false })
    .limit(60);
  if (!scenarios || scenarios.length === 0) return [];

  const ids = scenarios.map((s) => s.id as string);
  const { data: voteRows } = await supabase
    .from("verdict_votes")
    .select("scenario_id, pick_player_id")
    .in("scenario_id", ids);

  const tally = new Map<
    string,
    { total: number; byPlayer: Record<number, number> }
  >();
  for (const v of (voteRows ?? []) as {
    scenario_id: string;
    pick_player_id: number;
  }[]) {
    const t = tally.get(v.scenario_id) ?? { total: 0, byPlayer: {} };
    t.total += 1;
    t.byPlayer[v.pick_player_id] = (t.byPlayer[v.pick_player_id] ?? 0) + 1;
    tally.set(v.scenario_id, t);
  }

  const cards: VerdictCard[] = scenarios.map((s) => {
    const t = tally.get(s.id as string) ?? { total: 0, byPlayer: {} };
    const candidates = (s.candidates as VerdictPlayerMini[]) ?? [];
    let topPick: VerdictPlayerMini | null = null;
    let topCount = -1;
    for (const c of candidates) {
      const ct = t.byPlayer[c.player_id] ?? 0;
      if (ct > topCount) {
        topCount = ct;
        topPick = c;
      }
    }
    const topPickPct =
      topPick && t.total > 0
        ? Math.round(((t.byPlayer[topPick.player_id] ?? 0) / t.total) * 100)
        : 0;
    return {
      id: s.id as string,
      scenario_type: s.scenario_type as "draft" | "start_sit",
      candidates,
      context: (s.context as VerdictCard["context"]) ?? null,
      totalVotes: t.total,
      topPick,
      topPickPct,
    };
  });

  return cards
    .filter((c) => c.totalVotes >= MIN_VOTES)
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 3);
}

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function sideHeadline(side: Side): string {
  // Short, scannable summary: first player name (or first pick), then "+N more".
  const items: string[] = [];
  for (const p of side.players) items.push(p.name);
  for (const pk of side.picks) {
    items.push(`${pk.year} R${pk.round}${pk.slot ? `.${String(pk.slot).padStart(2, "0")}` : ""}`);
  }
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0];
  return `${items[0]} + ${items.length - 1}`;
}

export default async function CouncilActivity() {
  const [topTrades, topVerdicts] = await Promise.all([
    loadTopTrades(),
    loadTopVerdicts(),
  ]);

  // Nothing to show — bail entirely so we don't render an empty section.
  if (topTrades.length === 0 && topVerdicts.length === 0) return null;

  return (
    <section className="mt-10 border-t border-zinc-800 pt-8">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-lg font-semibold text-zinc-100 sm:text-xl">
          What the community is voting on
        </h2>
        <p className="text-xs text-zinc-500">
          Tap a card to cast your vote.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Trades
            </h3>
            <Link
              href="/trades"
              className="text-xs text-emerald-400 underline-offset-4 hover:underline"
            >
              All trades →
            </Link>
          </div>
          {topTrades.length === 0 ? (
            <EmptyState
              copy="No trades with votes yet."
              ctaHref="/trades/new"
              ctaLabel="Submit a trade"
            />
          ) : (
            <div className="space-y-2">
              {topTrades.map((t) => (
                <TradeMiniCard key={t.id} trade={t} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Tough calls
            </h3>
            <Link
              href="/judge"
              className="text-xs text-emerald-400 underline-offset-4 hover:underline"
            >
              All tough calls →
            </Link>
          </div>
          {topVerdicts.length === 0 ? (
            <EmptyState
              copy="No tough calls with votes yet."
              ctaHref="/verdict/new"
              ctaLabel="Post a tough call"
            />
          ) : (
            <div className="space-y-2">
              {topVerdicts.map((v) => (
                <VerdictMiniCard key={v.id} verdict={v} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function EmptyState({
  copy,
  ctaHref,
  ctaLabel,
}: {
  copy: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
      <p>{copy}</p>
      <Link
        href={ctaHref}
        className="mt-2 inline-block text-xs font-medium text-emerald-300 underline-offset-4 hover:underline"
      >
        {ctaLabel} →
      </Link>
    </div>
  );
}

function TradeMiniCard({ trade }: { trade: TradeCard }) {
  const total = trade.totalVotes;
  const aPct = total > 0 ? Math.round((trade.votesA / total) * 100) : 0;
  const bPct = total > 0 ? Math.round((trade.votesB / total) * 100) : 0;
  const evenPct = total > 0 ? 100 - aPct - bPct : 0;
  type Winner = "A" | "B" | "EVEN";
  const winner: Winner =
    aPct >= bPct && aPct >= evenPct
      ? "A"
      : bPct >= aPct && bPct >= evenPct
        ? "B"
        : "EVEN";
  const winnerPct =
    winner === "A" ? aPct : winner === "B" ? bPct : evenPct;
  const verdictLabel =
    winner === "A"
      ? `Team A ${winnerPct}%`
      : winner === "B"
        ? `Team B ${winnerPct}%`
        : `Even ${winnerPct}%`;

  return (
    <Link
      href={`/trades/${trade.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition hover:border-emerald-500/40 hover:bg-zinc-900/60"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
        <span className="truncate text-zinc-100">
          {sideHeadline(trade.side_a)}
        </span>
        <span className="text-xs text-zinc-500">↔</span>
        <span className="truncate text-right text-zinc-100">
          {sideHeadline(trade.side_b)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-emerald-300">{verdictLabel}</span>
        <span className="text-zinc-500">
          {total} vote{total === 1 ? "" : "s"} · tap to vote
        </span>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">
        {trade.league_type} · {trade.scoring}
      </div>
    </Link>
  );
}

function VerdictMiniCard({ verdict }: { verdict: VerdictCard }) {
  const question =
    verdict.scenario_type === "draft"
      ? "Who would you draft?"
      : "Who would you start?";
  const ctx = verdict.context ?? {};
  const meta: string[] = [];
  if (ctx.scoring) meta.push(ctx.scoring);
  if (verdict.scenario_type === "start_sit" && ctx.week != null) {
    meta.push(`Week ${ctx.week}`);
  }
  if (verdict.scenario_type === "draft" && ctx.round != null) {
    meta.push(`Round ${ctx.round}`);
  }

  return (
    <Link
      href={`/verdict/${verdict.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition hover:border-emerald-500/40 hover:bg-zinc-900/60"
    >
      <p className="text-sm font-medium text-zinc-100">{question}</p>
      {verdict.topPick ? (
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
              POSITION_STYLES[verdict.topPick.position] ??
              "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
            }`}
          >
            {verdict.topPick.position}
          </span>
          <span className="text-sm font-semibold text-emerald-200">
            Council says {verdict.topPick.name}
          </span>
          <span className="font-mono text-xs text-emerald-300">
            · {verdict.topPickPct}%
          </span>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">No leading candidate yet.</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          {verdict.totalVotes} vote
          {verdict.totalVotes === 1 ? "" : "s"} · tap to vote
        </span>
        {meta.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">
            {meta.join(" · ")}
          </span>
        )}
      </div>
    </Link>
  );
}
