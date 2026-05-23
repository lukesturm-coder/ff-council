import { loadTrending, TRENDING_WEEKS } from "@/lib/trending";
import { assignTeamColors, DEFAULT_TEAM_COLOR } from "@/lib/team-colors";
import type { TrendingSeries } from "./TrendingChart";
import TrendingBoardClient, { type Mover } from "./TrendingBoardClient";

// Featured "Trending" hero — 3 risers + 3 fallers in the council ranking with a
// rank-movement chart. Each player's line is colored by their NFL team (muted,
// premium) for instant sports-native recognition; two players from the same
// team fall back to the team's secondary color. Brand green stays reserved for
// the active/selected state; direction reads via the green "+" / red "−" badges.

export default async function TrendingBoard() {
  const { risers, fallers, scoring } = await loadTrending("PPR");
  if (risers.length === 0 && fallers.length === 0) return null;

  // Color each line by NFL team (secondary for a 2nd player from the same team).
  const ordered = [...risers, ...fallers];
  const colorById = assignTeamColors(
    ordered.map((p) => ({ playerId: p.playerId, team: p.team })),
  );

  const toMover = (p: (typeof risers)[number]): Mover => ({
    playerId: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position,
    currentRank: p.currentRank,
    change: p.change,
    color: colorById.get(p.playerId) ?? DEFAULT_TEAM_COLOR.primary,
  });

  const series: TrendingSeries[] = ordered.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    color: colorById.get(p.playerId) ?? DEFAULT_TEAM_COLOR.primary,
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
