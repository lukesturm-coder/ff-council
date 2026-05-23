import Link from "next/link";
import { Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

// Right-rail "Hot calls" — the most-voted trades + tough calls right now,
// ranked like Polymarket's "Hot topics" list. Compact: rank, title, vote count.

const SHOWN = 6;

type SidePlayer = { name: string };
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players?: SidePlayer[]; picks?: SidePick[] } | null;
type Candidate = { name?: string };

type HotItem = {
  kind: "trade" | "verdict";
  id: string;
  title: string;
  votes: number;
};

function firstAsset(side: Side): string {
  if (!side) return "—";
  const p = side.players?.[0]?.name;
  if (p) return p;
  const pk = side.picks?.[0];
  if (pk) return `${pk.year} R${pk.round}`;
  return "—";
}

async function loadHotCalls(): Promise<HotItem[]> {
  const supabase = await createClient();

  const [tradesRes, verdictsRes] = await Promise.all([
    supabase
      .from("trade_submissions")
      .select("id, side_a, side_b")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("verdict_scenarios")
      .select("id, candidates")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const trades = (tradesRes.data ?? []) as Array<{
    id: string;
    side_a: Side;
    side_b: Side;
  }>;
  const verdicts = (verdictsRes.data ?? []) as Array<{
    id: string;
    candidates: Candidate[] | null;
  }>;

  const tradeIds = trades.map((t) => t.id);
  const verdictIds = verdicts.map((v) => v.id);

  const [tradeVotesRes, verdictVotesRes] = await Promise.all([
    tradeIds.length
      ? supabase.from("trade_votes").select("trade_id").in("trade_id", tradeIds)
      : Promise.resolve({ data: [] as { trade_id: string }[] }),
    verdictIds.length
      ? supabase
          .from("verdict_votes")
          .select("scenario_id")
          .in("scenario_id", verdictIds)
      : Promise.resolve({ data: [] as { scenario_id: string }[] }),
  ]);

  const tradeTally = new Map<string, number>();
  for (const v of (tradeVotesRes.data ?? []) as { trade_id: string }[]) {
    tradeTally.set(v.trade_id, (tradeTally.get(v.trade_id) ?? 0) + 1);
  }
  const verdictTally = new Map<string, number>();
  for (const v of (verdictVotesRes.data ?? []) as { scenario_id: string }[]) {
    verdictTally.set(v.scenario_id, (verdictTally.get(v.scenario_id) ?? 0) + 1);
  }

  const items: HotItem[] = [];
  for (const t of trades) {
    const votes = tradeTally.get(t.id) ?? 0;
    if (votes === 0) continue;
    items.push({
      kind: "trade",
      id: t.id,
      title: `${firstAsset(t.side_a)} ↔ ${firstAsset(t.side_b)}`,
      votes,
    });
  }
  for (const v of verdicts) {
    const votes = verdictTally.get(v.id) ?? 0;
    if (votes === 0) continue;
    const names = (v.candidates ?? [])
      .slice(0, 2)
      .map((c) => c?.name ?? "")
      .filter(Boolean);
    items.push({
      kind: "verdict",
      id: v.id,
      title: names.length >= 2 ? `${names[0]} vs ${names[1]}` : "Tough call",
      votes,
    });
  }

  return items.sort((a, b) => b.votes - a.votes).slice(0, SHOWN);
}

export default async function HotCalls() {
  const items = await loadHotCalls();
  if (items.length === 0) return null;

  // The hottest item's vote count drives the flame highlight threshold.
  const max = items[0].votes;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-400" aria-hidden />
        <h2 className="text-base font-semibold text-zinc-100">Hot calls</h2>
      </div>

      <ol className="space-y-0.5">
        {items.map((item, i) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={
                item.kind === "trade"
                  ? `/trades/${item.id}`
                  : `/verdict/${item.id}`
              }
              className="flex items-center gap-3 rounded-md px-1.5 py-2 transition hover:bg-zinc-800/50"
            >
              <span className="w-4 shrink-0 text-center font-mono text-xs text-zinc-600">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                {item.title}
              </span>
              {item.votes >= max * 0.6 && (
                <Flame className="h-3.5 w-3.5 shrink-0 text-orange-400/80" aria-hidden />
              )}
              <span className="shrink-0 font-mono text-xs text-zinc-500">
                {item.votes}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <Link
        href="/judge"
        className="mt-3 block rounded-lg border border-zinc-800 py-2 text-center text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
      >
        Explore all
      </Link>
    </section>
  );
}
