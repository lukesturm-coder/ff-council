import { loadTrending, TRENDING_WEEKS } from "@/lib/trending";
import type { TrendingSeries } from "./TrendingChart";
import TrendingBoardClient, { type Mover } from "./TrendingBoardClient";

// Featured "Trending" hero — 3 risers + 3 fallers in the council ranking with a
// rank-movement chart. Two-tone (risers green, fallers red); you click a line
// or a name to trace it (handled in the client wrapper).

const RISER_COLOR = "#34d399"; // emerald-400
const FALLER_COLOR = "#f87171"; // red-400

export default async function TrendingBoard() {
  const { risers, fallers, scoring } = await loadTrending("PPR");
  if (risers.length === 0 && fallers.length === 0) return null;

  const toMover = (
    p: (typeof risers)[number],
    color: string,
  ): Mover => ({
    playerId: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position,
    currentRank: p.currentRank,
    change: p.change,
    color,
  });

  const riserMovers = risers.map((p) => toMover(p, RISER_COLOR));
  const fallerMovers = fallers.map((p) => toMover(p, FALLER_COLOR));

  const series: TrendingSeries[] = [
    ...risers.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      color: RISER_COLOR,
      points: p.history,
    })),
    ...fallers.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      color: FALLER_COLOR,
      points: p.history,
    })),
  ];

  return (
    <TrendingBoardClient
      risers={riserMovers}
      fallers={fallerMovers}
      series={series}
      weeks={TRENDING_WEEKS}
      scoring={scoring}
    />
  );
}
