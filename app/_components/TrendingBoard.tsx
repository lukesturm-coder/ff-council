import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import {
  loadTrending,
  TRENDING_WEEKS,
  type TrendingPlayer,
} from "@/lib/trending";
import TrendingChart, { type TrendingSeries } from "./TrendingChart";

// Featured "Trending" hero — 3 risers + 3 fallers in the council ranking, with
// a recent rank-movement chart. Mirrors a Polymarket featured-market card:
// details list on the left, chart on the right.

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

// Vivid, well-separated hues (no pale tints) so each of the 6 lines is easy to
// tell apart. Risers stay green-family, fallers warm-family — directional read
// at a glance, like Polymarket's bold two-tone.
const RISER_COLORS = ["#4ade80", "#10b981", "#a3e635"];
const FALLER_COLORS = ["#f43f5e", "#fb923c", "#f472b6"];

function MoverRow({
  player,
  color,
  rising,
}: {
  player: TrendingPlayer;
  color: string;
  rising: boolean;
}) {
  const Arrow = rising ? ArrowUpRight : ArrowDownRight;
  return (
    <Link
      href={`/player/${player.playerId}`}
      className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition hover:bg-zinc-800/50"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span
        className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
          POSITION_STYLES[player.position] ??
          "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
        }`}
      >
        {player.position}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
        {player.name}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-zinc-500">
        #{player.currentRank}
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-0.5 font-mono text-xs font-semibold ${
          rising ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        <Arrow className="h-3.5 w-3.5" />
        {Math.abs(player.change)}
      </span>
    </Link>
  );
}

export default async function TrendingBoard() {
  const { risers, fallers, scoring } = await loadTrending("PPR");
  if (risers.length === 0 && fallers.length === 0) return null;

  const series: TrendingSeries[] = [
    ...risers.map((p, i) => ({
      playerId: p.playerId,
      name: p.name,
      color: RISER_COLORS[i % RISER_COLORS.length],
      points: p.history,
    })),
    ...fallers.map((p, i) => ({
      playerId: p.playerId,
      name: p.name,
      color: FALLER_COLORS[i % FALLER_COLORS.length],
      points: p.history,
    })),
  ];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden />
          <h2 className="text-base font-semibold text-zinc-100 sm:text-lg">
            Trending
          </h2>
          <span className="hidden text-xs text-zinc-500 sm:inline">
            risers &amp; fallers
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">
          {scoring} · last {TRENDING_WEEKS} wks
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-6">
        <div className="space-y-3">
          {risers.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                <ArrowUpRight className="h-3.5 w-3.5" /> Rising
              </div>
              <div className="space-y-0.5">
                {risers.map((p, i) => (
                  <MoverRow
                    key={p.playerId}
                    player={p}
                    color={RISER_COLORS[i % RISER_COLORS.length]}
                    rising
                  />
                ))}
              </div>
            </div>
          )}
          {fallers.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-rose-400">
                <ArrowDownRight className="h-3.5 w-3.5" /> Falling
              </div>
              <div className="space-y-0.5">
                {fallers.map((p, i) => (
                  <MoverRow
                    key={p.playerId}
                    player={p}
                    color={FALLER_COLORS[i % FALLER_COLORS.length]}
                    rising={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <TrendingChart series={series} weeks={TRENDING_WEEKS} />
          <p className="mt-1.5 text-center text-[10px] text-zinc-600">
            Rank over the last {TRENDING_WEEKS} weeks · lower is better
          </p>
        </div>
      </div>
    </section>
  );
}
