import { createClient } from "@/lib/supabase/server";
import AllDecisionsClient, {
  type Decision,
  type TradeDecision,
  type VerdictDecision,
} from "./AllDecisionsClient";

// Server loader for the home "All decisions" grid. Pulls recent trades + draft
// tough calls, tallies votes from the raw vote tables (the summary view has a
// known anon-NULL bug), and hands serializable cards to the client grid.

// Offseason surfaces draft calls; flip to "start_sit" when the season starts.
const VERDICT_TYPE: "draft" | "start_sit" = "draft";
const MAX_CARDS = 24;

type SidePlayer = { name: string };
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players?: SidePlayer[]; picks?: SidePick[] } | null;

type Candidate = { player_id: number; name: string; position: string };

function sideHeadline(side: Side): string {
  const items: string[] = [];
  for (const p of side?.players ?? []) items.push(p.name);
  for (const pk of side?.picks ?? []) {
    items.push(
      `${pk.year} R${pk.round}${pk.slot ? `.${String(pk.slot).padStart(2, "0")}` : ""}`,
    );
  }
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0];
  return `${items[0]} + ${items.length - 1}`;
}

async function loadDecisions(): Promise<Decision[]> {
  const supabase = await createClient();

  const [tradesRes, verdictsRes] = await Promise.all([
    supabase
      .from("trade_submissions")
      .select("id, side_a, side_b, league_type, scoring")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("verdict_scenarios")
      .select("id, scenario_type, candidates, context")
      .eq("scenario_type", VERDICT_TYPE)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const trades = (tradesRes.data ?? []) as Array<{
    id: string;
    side_a: Side;
    side_b: Side;
    league_type: string;
    scoring: string;
  }>;
  const verdicts = (verdictsRes.data ?? []) as Array<{
    id: string;
    scenario_type: string;
    candidates: Candidate[] | null;
    context: { scoring?: string; week?: number | null; round?: number | null } | null;
  }>;

  const tradeIds = trades.map((t) => t.id);
  const verdictIds = verdicts.map((v) => v.id);

  const [tradeVotesRes, verdictVotesRes] = await Promise.all([
    tradeIds.length
      ? supabase
          .from("trade_votes")
          .select("trade_id, winner")
          .in("trade_id", tradeIds)
      : Promise.resolve({ data: [] as { trade_id: string; winner: string }[] }),
    verdictIds.length
      ? supabase
          .from("verdict_votes")
          .select("scenario_id, pick_player_id")
          .in("scenario_id", verdictIds)
      : Promise.resolve({
          data: [] as { scenario_id: string; pick_player_id: number }[],
        }),
  ]);

  const tradeTally = new Map<
    string,
    { total: number; a: number; b: number; even: number }
  >();
  for (const v of (tradeVotesRes.data ?? []) as {
    trade_id: string;
    winner: string;
  }[]) {
    const t = tradeTally.get(v.trade_id) ?? { total: 0, a: 0, b: 0, even: 0 };
    t.total += 1;
    if (v.winner === "A") t.a += 1;
    else if (v.winner === "B") t.b += 1;
    else if (v.winner === "EVEN") t.even += 1;
    tradeTally.set(v.trade_id, t);
  }

  const verdictTally = new Map<
    string,
    { total: number; byPlayer: Record<number, number> }
  >();
  for (const v of (verdictVotesRes.data ?? []) as {
    scenario_id: string;
    pick_player_id: number;
  }[]) {
    const t = verdictTally.get(v.scenario_id) ?? { total: 0, byPlayer: {} };
    t.total += 1;
    t.byPlayer[v.pick_player_id] = (t.byPlayer[v.pick_player_id] ?? 0) + 1;
    verdictTally.set(v.scenario_id, t);
  }

  const tradeDecisions: TradeDecision[] = trades.map((t) => {
    const c = tradeTally.get(t.id) ?? { total: 0, a: 0, b: 0, even: 0 };
    const aPct = c.total > 0 ? Math.round((c.a / c.total) * 100) : 0;
    const bPct = c.total > 0 ? Math.round((c.b / c.total) * 100) : 0;
    const evenPct = c.total > 0 ? Math.round((c.even / c.total) * 100) : 0;
    const winner: "A" | "B" | "EVEN" =
      aPct >= bPct && aPct >= evenPct
        ? "A"
        : bPct >= aPct && bPct >= evenPct
          ? "B"
          : "EVEN";
    const winnerPct = winner === "A" ? aPct : winner === "B" ? bPct : evenPct;
    return {
      kind: "trade",
      id: t.id,
      sideA: sideHeadline(t.side_a),
      sideB: sideHeadline(t.side_b),
      aPct,
      bPct,
      evenPct,
      winner,
      winnerPct,
      total: c.total,
      meta: `${t.league_type} · ${t.scoring}`.toUpperCase(),
      categories: ["trades", String(t.league_type).toLowerCase()],
    };
  });

  const verdictDecisions: VerdictDecision[] = verdicts.map((v) => {
    const t = verdictTally.get(v.id) ?? { total: 0, byPlayer: {} };
    const candidates = v.candidates ?? [];
    const options = candidates
      .map((c) => ({
        name: c.name,
        position: c.position,
        pct:
          t.total > 0
            ? Math.round(((t.byPlayer[c.player_id] ?? 0) / t.total) * 100)
            : 0,
        voteCount: t.byPlayer[c.player_id] ?? 0,
      }))
      .sort((a, b) => b.voteCount - a.voteCount)
      .map(({ name, position, pct }) => ({ name, position, pct }));

    const ctx = v.context ?? {};
    const meta: string[] = [];
    if (ctx.scoring) meta.push(ctx.scoring);
    if (v.scenario_type === "draft" && ctx.round != null) {
      meta.push(`Round ${ctx.round}`);
    }
    if (v.scenario_type === "start_sit" && ctx.week != null) {
      meta.push(`Week ${ctx.week}`);
    }

    return {
      kind: "verdict",
      id: v.id,
      question:
        v.scenario_type === "draft"
          ? "Who would you draft?"
          : "Who would you start?",
      options,
      total: t.total,
      meta: meta.join(" · ").toUpperCase(),
      categories: [v.scenario_type],
    };
  });

  return [...tradeDecisions, ...verdictDecisions]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_CARDS);
}

export default async function AllDecisions() {
  const decisions = await loadDecisions();
  if (decisions.length === 0) return null;
  return <AllDecisionsClient decisions={decisions} />;
}
