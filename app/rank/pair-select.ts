import type { FantasyPosition, ScoringSystem } from "@/lib/types";

export type PlayerInfo = {
  playerId: number;
  name: string;
  team: string;
  position: FantasyPosition;
  fantasyPoints: Record<ScoringSystem, number>;
};

export type EloRecord = {
  elo: number;
  gamesPlayed: number;
};

const DEFAULT_ELO = 1500;
const BANDS = [150, 300, 500];
const MIN_OPPONENTS = 3;

type AnnotatedPlayer = PlayerInfo & {
  elo: number;
  gamesPlayed: number;
};

function annotate(
  players: PlayerInfo[],
  elos: Map<number, EloRecord>,
): AnnotatedPlayer[] {
  return players.map((p) => {
    const rec = elos.get(p.playerId);
    return {
      ...p,
      elo: rec?.elo ?? DEFAULT_ELO,
      gamesPlayed: rec?.gamesPlayed ?? 0,
    };
  });
}

/**
 * Weighted-by-1/(games+1) sample. Players with fewer comparisons surface more
 * often so the Elo ladder fills in quickly. Uses a simple cumulative-weight
 * roulette wheel.
 */
function weightedPickIndex(weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return Math.floor(Math.random() * weights.length);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function pickOpponent(
  seed: AnnotatedPlayer,
  pool: AnnotatedPlayer[],
): AnnotatedPlayer | null {
  for (const band of BANDS) {
    const candidates = pool.filter(
      (p) => p.playerId !== seed.playerId && Math.abs(p.elo - seed.elo) <= band,
    );
    if (candidates.length >= MIN_OPPONENTS) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  // Last resort: anyone else in the pool. Keeps the page working even if Elos
  // are all clustered (e.g. on day 1, when everyone is at 1500).
  const fallback = pool.filter((p) => p.playerId !== seed.playerId);
  if (fallback.length === 0) return null;
  return fallback[Math.floor(Math.random() * fallback.length)];
}

function toInfo(p: AnnotatedPlayer): PlayerInfo {
  return {
    playerId: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position,
    fantasyPoints: p.fantasyPoints,
  };
}

/**
 * Build a batch of pairs:
 * 1. Seed weighted by 1/(games+1) — new players catch up faster.
 * 2. Opponent within Elo ±150, widening to ±300 / ±500 if too few candidates.
 * 3. Random side assignment (a/b) per pair so neither slot is biased.
 *
 * Cross-position by design — KeepTradeCut-style "would you rather have".
 */
export function buildPairs(
  players: PlayerInfo[],
  elos: Map<number, EloRecord>,
  batchSize: number,
): Array<{ a: PlayerInfo; b: PlayerInfo }> {
  const pool = annotate(players, elos);
  if (pool.length < 2) return [];
  const weights = pool.map((p) => 1 / (p.gamesPlayed + 1));

  const pairs: Array<{ a: PlayerInfo; b: PlayerInfo }> = [];
  for (let i = 0; i < batchSize; i++) {
    const seed = pool[weightedPickIndex(weights)];
    const opp = pickOpponent(seed, pool);
    if (!opp) continue;
    if (Math.random() < 0.5) {
      pairs.push({ a: toInfo(seed), b: toInfo(opp) });
    } else {
      pairs.push({ a: toInfo(opp), b: toInfo(seed) });
    }
  }
  return pairs;
}
