import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/relative-time";

// =====================================================================
// ActivityTicker — slim "recent verdicts" ribbon for the home page.
//
// Surfaces the most-recent 10 votes across trade_votes + verdict_votes
// so users landing on the rankings can feel that the council is alive.
// Strictly anonymized — every voter is rendered as "Someone".
//
// Server component: SSR'd inline with the page; no client hydration.
// Empty state: render nothing (no skeleton, no placeholder).
//
// Animation strategy:
//  - Desktop (sm+): subtle CSS marquee that loops the pill row left.
//    We render the pills twice in the inner track so the seam is
//    invisible at the wrap point. Marquee pauses on hover so users
//    can read / click. Pure CSS keyframes, no JS.
//  - Mobile (<sm): horizontal scroll with snap; user controls pace.
//
// Query strategy (single round trip per table, then batched lookups):
//  1. Pull 15 most-recent trade_votes + 15 most-recent verdict_votes
//     in parallel (Promise.all).
//  2. Collect distinct trade_ids / scenario_ids and fetch the minimal
//     scenario snippet (id + headline pieces only) via .in() — two
//     more queries, both batched, no N+1.
//  3. Merge, sort by created_at desc, take top 10.
// =====================================================================

const TICKER_LIMIT = 10;
const FETCH_LIMIT = 15;

type TradeVoteRow = {
  trade_id: string;
  winner: "A" | "B" | "EVEN";
  created_at: string;
};

type VerdictVoteRow = {
  scenario_id: string;
  pick_player_id: number;
  created_at: string;
};

type SidePlayer = { name: string };
type SidePick = { year: number; round: number };
type TradeSnippet = {
  id: string;
  headline: string;
};

type VerdictCandidate = {
  player_id: number;
  name: string;
};
type VerdictSnippet = {
  id: string;
  scenario_type: "draft" | "start_sit";
  candidates: VerdictCandidate[];
};

type TickerItem =
  | {
      kind: "trade";
      id: string;
      tradeId: string;
      winner: "A" | "B" | "EVEN";
      headline: string;
      createdAt: string;
    }
  | {
      kind: "verdict";
      id: string;
      verdictId: string;
      pickName: string;
      scenarioType: "draft" | "start_sit";
      createdAt: string;
    };

function tradeHeadline(
  sideA: { players?: SidePlayer[]; picks?: SidePick[] } | null,
  sideB: { players?: SidePlayer[]; picks?: SidePick[] } | null,
): string {
  // Concise "X ↔ Y" using just the first asset on each side. We avoid
  // pulling the whole side payload to keep the response light.
  const firstAsset = (
    side: { players?: SidePlayer[]; picks?: SidePick[] } | null,
  ): string => {
    if (!side) return "—";
    const p = side.players?.[0]?.name;
    if (p) return p;
    const pk = side.picks?.[0];
    if (pk) return `${pk.year} R${pk.round}`;
    return "—";
  };
  return `${firstAsset(sideA)} ↔ ${firstAsset(sideB)}`;
}

async function loadRecentActivity(): Promise<TickerItem[]> {
  const supabase = await createClient();

  // Fan out the two vote-table reads in parallel. Each returns at most
  // FETCH_LIMIT rows so we have headroom to merge + sort + trim.
  const [tradeVotesRes, verdictVotesRes] = await Promise.all([
    supabase
      .from("trade_votes")
      .select("trade_id, winner, created_at")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT),
    supabase
      .from("verdict_votes")
      .select("scenario_id, pick_player_id, created_at")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT),
  ]);

  const tradeVotes = (tradeVotesRes.data ?? []) as TradeVoteRow[];
  const verdictVotes = (verdictVotesRes.data ?? []) as VerdictVoteRow[];

  if (tradeVotes.length === 0 && verdictVotes.length === 0) return [];

  // Distinct ids only — multiple recent votes on the same scenario should
  // collapse to one snippet fetch.
  const tradeIds = Array.from(new Set(tradeVotes.map((v) => v.trade_id)));
  const scenarioIds = Array.from(
    new Set(verdictVotes.map((v) => v.scenario_id)),
  );

  const [tradeSnipsRes, verdictSnipsRes] = await Promise.all([
    tradeIds.length > 0
      ? supabase
          .from("trade_submissions")
          .select("id, side_a, side_b")
          .in("id", tradeIds)
      : Promise.resolve({ data: [] as unknown[] }),
    scenarioIds.length > 0
      ? supabase
          .from("verdict_scenarios")
          .select("id, scenario_type, candidates")
          .in("id", scenarioIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const tradeMap = new Map<string, TradeSnippet>();
  for (const row of (tradeSnipsRes.data ?? []) as Array<{
    id: string;
    side_a: { players?: SidePlayer[]; picks?: SidePick[] } | null;
    side_b: { players?: SidePlayer[]; picks?: SidePick[] } | null;
  }>) {
    tradeMap.set(row.id, {
      id: row.id,
      headline: tradeHeadline(row.side_a, row.side_b),
    });
  }

  const verdictMap = new Map<string, VerdictSnippet>();
  for (const row of (verdictSnipsRes.data ?? []) as Array<{
    id: string;
    scenario_type: "draft" | "start_sit";
    candidates: VerdictCandidate[] | null;
  }>) {
    verdictMap.set(row.id, {
      id: row.id,
      scenario_type: row.scenario_type,
      candidates: row.candidates ?? [],
    });
  }

  const items: TickerItem[] = [];

  for (let i = 0; i < tradeVotes.length; i += 1) {
    const v = tradeVotes[i];
    const snip = tradeMap.get(v.trade_id);
    if (!snip) continue; // scenario deleted / RLS — skip silently
    items.push({
      kind: "trade",
      // Stable per-row key — trade_votes has no surfaced id field on the
      // PostgREST select, but trade_id + created_at is unique enough for
      // React reconciliation across an SSR pass.
      id: `t-${v.trade_id}-${v.created_at}-${i}`,
      tradeId: v.trade_id,
      winner: v.winner,
      headline: snip.headline,
      createdAt: v.created_at,
    });
  }

  for (let i = 0; i < verdictVotes.length; i += 1) {
    const v = verdictVotes[i];
    const snip = verdictMap.get(v.scenario_id);
    if (!snip) continue;
    const pick = snip.candidates.find((c) => c.player_id === v.pick_player_id);
    if (!pick) continue;
    items.push({
      kind: "verdict",
      id: `v-${v.scenario_id}-${v.created_at}-${i}`,
      verdictId: v.scenario_id,
      pickName: pick.name,
      scenarioType: snip.scenario_type,
      createdAt: v.created_at,
    });
  }

  items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return items.slice(0, TICKER_LIMIT);
}

// Faint accent rings — chosen to match the broader app palette and
// distinguish vote type at a glance without becoming visually loud.
const ACCENT: Record<string, string> = {
  A: "border-rose-500/30 bg-rose-500/5 text-rose-200 hover:border-rose-400/50",
  B: "border-sky-500/30 bg-sky-500/5 text-sky-200 hover:border-sky-400/50",
  EVEN:
    "border-zinc-500/30 bg-zinc-500/5 text-zinc-200 hover:border-zinc-400/50",
  VERDICT:
    "border-emerald-500/30 bg-emerald-500/5 text-emerald-200 hover:border-emerald-400/50",
};

function Pill({ item }: { item: TickerItem }) {
  if (item.kind === "trade") {
    const sideLabel =
      item.winner === "A"
        ? "Team A"
        : item.winner === "B"
          ? "Team B"
          : "Even";
    const accent = ACCENT[item.winner];
    return (
      <Link
        href={`/trades/${item.tradeId}`}
        className={`group inline-flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${accent}`}
      >
        <span className="text-zinc-500">Someone voted</span>
        <span className="font-semibold">{sideLabel}</span>
        <span className="text-zinc-500">on</span>
        <span className="max-w-[14rem] truncate text-zinc-200">
          {item.headline}
        </span>
        <span className="text-zinc-600">· {relativeTime(item.createdAt)}</span>
      </Link>
    );
  }

  const question =
    item.scenarioType === "draft" ? "draft" : "start";
  return (
    <Link
      href={`/verdict/${item.verdictId}`}
      className={`group inline-flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${ACCENT.VERDICT}`}
    >
      <span className="text-zinc-500">Someone picked</span>
      <span className="font-semibold">{item.pickName}</span>
      <span className="text-zinc-500">to {question}</span>
      <span className="text-zinc-600">· {relativeTime(item.createdAt)}</span>
    </Link>
  );
}

export default async function ActivityTicker() {
  const items = await loadRecentActivity();
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Recent council activity"
      className="-mx-3 mb-4 sm:mx-0 sm:mb-6"
    >
      {/* Mobile: native horizontal scroll with snap. User-controlled,
          no animation — feels less spammy on a small screen. */}
      <div className="flex gap-2 overflow-x-auto scroll-px-3 px-3 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] sm:hidden [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <Pill key={it.id} item={it} />
        ))}
      </div>

      {/* Desktop: marquee. Inner track is duplicated so the loop seam
          is invisible. Hovering the row pauses the animation so users
          can read or click a pill. */}
      <div className="ticker-mask relative hidden overflow-hidden sm:block">
        <div className="ticker-track flex w-max gap-2 hover:[animation-play-state:paused]">
          {items.map((it) => (
            <Pill key={it.id} item={it} />
          ))}
          {items.map((it) => (
            <Pill key={`${it.id}-dup`} item={it} />
          ))}
        </div>
      </div>

      <style>{`
        .ticker-mask {
          /* Soft fade on both ends so pills appear to slide in/out of view
             instead of hard-cutting at the container edge. */
          -webkit-mask-image: linear-gradient(
            to right,
            transparent 0,
            black 48px,
            black calc(100% - 48px),
            transparent 100%
          );
                  mask-image: linear-gradient(
            to right,
            transparent 0,
            black 48px,
            black calc(100% - 48px),
            transparent 100%
          );
        }
        .ticker-track {
          animation: ticker-scroll 60s linear infinite;
        }
        @keyframes ticker-scroll {
          from { transform: translate3d(0, 0, 0); }
          /* Translate exactly one copy's width so the second copy lands
             where the first started — seamless loop. */
          to   { transform: translate3d(-50%, 0, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track { animation: none; }
        }
      `}</style>
    </section>
  );
}
