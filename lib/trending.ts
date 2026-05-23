import { loadRankingProjections } from "@/lib/projections-data";
import type { ScoringSystem } from "@/lib/types";

/**
 * Home-page "trending" risers & fallers.
 *
 * PLACEHOLDER DATA — we don't store week-over-week rank history yet (see the
 * `ranking_snapshots` migration for the table that will hold it). Until that
 * table has 2+ snapshots, this fabricates a plausible recent trajectory per
 * player deterministically (seeded by playerId, so the curve is stable across
 * renders). Movement = how many spots a player's rank improved over the window.
 *
 * Swap-out plan: replace `buildHistory` with a query against `ranking_snapshots`
 * keyed by (player_id, scoring_system) ordered by captured_at. The returned
 * shape stays identical, so the board + chart don't change.
 */

export const TRENDING_WEEKS = 8;
// Only consider the top of the board "notable" — nobody cares that RB103 rose
// to RB99. Movement is computed within this pool.
const POOL_SIZE = 60;

export type TrendingPoint = { week: number; rank: number };

export type TrendingPlayer = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  currentRank: number;
  startRank: number;
  /** Positive = rose this many spots over the window; negative = fell. */
  change: number;
  history: TrendingPoint[];
};

export type TrendingData = {
  risers: TrendingPlayer[];
  fallers: TrendingPlayer[];
  scoring: ScoringSystem;
};

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Walk BACKWARD from the anchored current rank so the final point is exactly
 * today's rank and the prior weeks fill in behind it. ±2 spots per step keeps
 * the curve readable; clamped to a sane band so lines don't shoot off-axis.
 */
function buildHistory(
  playerId: number,
  currentRank: number,
): TrendingPoint[] {
  const rng = mulberry32(hashSeed(`trend-${playerId}`));
  const points: TrendingPoint[] = new Array(TRENDING_WEEKS);
  points[TRENDING_WEEKS - 1] = { week: TRENDING_WEEKS, rank: currentRank };
  let prev = currentRank;
  for (let i = TRENDING_WEEKS - 2; i >= 0; i--) {
    const delta = Math.round((rng() - 0.5) * 5); // [-2, +2]ish
    prev = Math.min(POOL_SIZE + 15, Math.max(1, prev + delta));
    points[i] = { week: i + 1, rank: prev };
  }
  return points;
}

export async function loadTrending(
  scoring: ScoringSystem = "PPR",
): Promise<TrendingData> {
  const projections = await loadRankingProjections();
  const pool = projections
    .filter((p) => p.fantasyPoints[scoring] > 0)
    .sort((a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring])
    .slice(0, POOL_SIZE);

  const movers: TrendingPlayer[] = pool.map((p, idx) => {
    const currentRank = idx + 1;
    const history = buildHistory(p.playerId, currentRank);
    const startRank = history[0].rank;
    return {
      playerId: p.playerId,
      name: p.name,
      team: p.team,
      position: p.position,
      currentRank,
      startRank,
      change: startRank - currentRank,
      history,
    };
  });

  const risers = movers
    .filter((m) => m.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, 3);
  const fallers = movers
    .filter((m) => m.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, 3);

  return { risers, fallers, scoring };
}
