import { loadTrending, TRENDING_WEEKS } from "@/lib/trending";
import type { TrendingSeries } from "./TrendingChart";
import TrendingBoardClient, { type Mover } from "./TrendingBoardClient";

// Featured "Trending" hero — 3 risers + 3 fallers in the council ranking with a
// rank-movement chart. Each player gets a unique color from a restrained
// premium palette (the FF Council brand green is deliberately NOT in it — it's
// reserved for the active/selected state). Direction still reads via the green
// "+" / red "−" change badges on each row.
//
// Curated, terminal-like hues: teal, soft blue, amber, rose, purple, aqua,
// coral, mint. Assigned by stable rank order so a player keeps their color.
const PLAYER_PALETTE = [
  "#2dd4bf", // teal
  "#60a5fa", // soft blue
  "#fbbf24", // amber
  "#f472b6", // rose
  "#a78bfa", // purple
  "#22d3ee", // aqua
  "#fb7185", // coral
  "#5eead4", // mint
];

export default async function TrendingBoard() {
  const { risers, fallers, scoring } = await loadTrending("PPR");
  if (risers.length === 0 && fallers.length === 0) return null;

  // Assign palette colors across the combined set so all 6 lines are distinct.
  const ordered = [...risers, ...fallers];
  const colorById = new Map<number, string>();
  ordered.forEach((p, i) => {
    colorById.set(p.playerId, PLAYER_PALETTE[i % PLAYER_PALETTE.length]);
  });

  const toMover = (p: (typeof risers)[number]): Mover => ({
    playerId: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position,
    currentRank: p.currentRank,
    change: p.change,
    color: colorById.get(p.playerId) ?? PLAYER_PALETTE[0],
  });

  const series: TrendingSeries[] = ordered.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    color: colorById.get(p.playerId) ?? PLAYER_PALETTE[0],
    points: p.history,
  }));

  return (
    <TrendingBoardClient
      risers={risers.map(toMover)}
      fallers={fallers.map(toMover)}
      series={series}
      weeks={TRENDING_WEEKS}
      scoring={scoring}
    />
  );
}
