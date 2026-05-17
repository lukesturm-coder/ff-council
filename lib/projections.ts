import type {
  BettingMarket,
  FantasyPosition,
  FuturesResponse,
  ImpliedStats,
  MarketContribution,
  PlayerProjection,
  ReplacementLevels,
  ScoringSystem,
} from "./types";

/**
 * Replacement-level rank per position for a standard 12-team league:
 * QB12 (1 starter × 12), RB24 (2 × 12), WR30 (2 starters + ~half of flex × 12),
 * TE12 (1 × 12). Player ranked at this threshold sets the "replacement" FPts
 * subtracted from everyone at that position to compute VBD.
 */
const REPLACEMENT_RANK: Record<FantasyPosition, number> = {
  QB: 12,
  RB: 24,
  WR: 30,
  TE: 12,
};

const SCORING_SYSTEMS: ScoringSystem[] = ["PPR", "Half", "Standard"];

export type PlayerRosterEntry = {
  PlayerID: number;
  Name: string;
  Team: string;
  FantasyPosition: FantasyPosition;
  AverageDraftPosition?: number;
  AverageDraftPositionPPR?: number;
};

/** SportsDataIO BettingBetType → ImpliedStats field. */
const BET_TYPE_TO_STAT: Record<string, keyof ImpliedStats> = {
  "Passing Yards": "passingYards",
  "Passing Touchdowns": "passingTouchdowns",
  "Interceptions Thrown": "interceptions",
  "Rushing Yards": "rushingYards",
  "Rushing Touchdowns": "rushingTouchdowns",
  Receptions: "receptions",
  "Receiving Yards": "receivingYards",
  "Receiving Touchdowns": "receivingTouchdowns",
};

/**
 * V1 simplification: implied stat mean ≈ the Over/Under line. For symmetric
 * pricing (e.g. -110/-110) this is exact under any symmetric distribution.
 * Asymmetric pricing skews the true mean, but the effect is small relative
 * to model uncertainty at the rankings level — revisit when we add an EV view.
 */
function impliedMeanForMarket(market: BettingMarket): number | null {
  const over = market.BettingOutcomes.find((o) => o.Participant === "Over");
  if (over?.Value != null) return over.Value;
  // Fallback to under outcome's Value (mirror of over)
  const under = market.BettingOutcomes.find((o) => o.Participant === "Under");
  return under?.Value ?? null;
}

function impliedStatsFromMarkets(markets: BettingMarket[]): {
  stats: ImpliedStats;
  contributions: MarketContribution[];
} {
  const stats: ImpliedStats = {};
  const contributions: MarketContribution[] = [];

  for (const market of markets) {
    const statKey = BET_TYPE_TO_STAT[market.BettingBetType];
    if (!statKey) continue;

    const mean = impliedMeanForMarket(market);
    if (mean == null) continue;

    stats[statKey] = mean;

    const over = market.BettingOutcomes.find((o) => o.Participant === "Over");
    const under = market.BettingOutcomes.find((o) => o.Participant === "Under");
    contributions.push({
      betType: market.BettingBetType,
      line: mean,
      overPayout: over?.PayoutAmerican ?? 0,
      underPayout: under?.PayoutAmerican ?? 0,
    });
  }

  return { stats, contributions };
}

/** Standard fantasy football scoring. */
function fantasyPoints(stats: ImpliedStats, system: ScoringSystem): number {
  const recWeight = system === "PPR" ? 1 : system === "Half" ? 0.5 : 0;
  return (
    (stats.passingYards ?? 0) * 0.04 +
    (stats.passingTouchdowns ?? 0) * 4 +
    (stats.interceptions ?? 0) * -2 +
    (stats.rushingYards ?? 0) * 0.1 +
    (stats.rushingTouchdowns ?? 0) * 6 +
    (stats.receptions ?? 0) * recWeight +
    (stats.receivingYards ?? 0) * 0.1 +
    (stats.receivingTouchdowns ?? 0) * 6
  );
}

export function fantasyPointsAll(
  stats: ImpliedStats,
): Record<ScoringSystem, number> {
  return {
    PPR: fantasyPoints(stats, "PPR"),
    Half: fantasyPoints(stats, "Half"),
    Standard: fantasyPoints(stats, "Standard"),
  };
}

/**
 * Turn a SportsDataIO futures response + a player roster into ranked
 * projections. Markets with no matching roster entry are dropped (they're
 * still useful in the raw view but can't appear in the rankings without a
 * position).
 */
export function projectionsFromFutures(
  response: FuturesResponse,
  roster: PlayerRosterEntry[],
): PlayerProjection[] {
  const rosterById = new Map(roster.map((r) => [r.PlayerID, r]));
  const marketsByPlayer = new Map<number, BettingMarket[]>();

  for (const event of response) {
    for (const market of event.BettingMarkets) {
      if (market.PlayerID == null) continue;
      const list = marketsByPlayer.get(market.PlayerID) ?? [];
      list.push(market);
      marketsByPlayer.set(market.PlayerID, list);
    }
  }

  // First pass: build projections with FPts but no VBD yet.
  const draft: Array<Omit<PlayerProjection, "vbd">> = [];
  for (const [playerId, markets] of Array.from(marketsByPlayer.entries())) {
    const player = rosterById.get(playerId);
    if (!player) continue; // unknown player — skip for rankings

    const { stats, contributions } = impliedStatsFromMarkets(markets);
    draft.push({
      playerId,
      name: player.Name,
      team: player.Team,
      position: player.FantasyPosition,
      adp: player.AverageDraftPosition,
      adpPPR: player.AverageDraftPositionPPR,
      impliedStats: stats,
      fantasyPoints: fantasyPointsAll(stats),
      markets: contributions,
    });
  }

  // Second pass: compute replacement-level FPts per position per scoring system,
  // then attach VBD to each projection.
  const replacement = computeReplacementLevels(draft);
  return draft.map((p) => ({
    ...p,
    vbd: {
      PPR: p.fantasyPoints.PPR - replacement[p.position].PPR,
      Half: p.fantasyPoints.Half - replacement[p.position].Half,
      Standard: p.fantasyPoints.Standard - replacement[p.position].Standard,
    },
  }));
}

/**
 * For each (position, scoring system), find the FPts of the player ranked at
 * the position's replacement threshold. If the pool is shallower than the
 * threshold, fall back to the last (worst) player at that position — which
 * makes VBD ≈ 0 for the worst player and positive for everyone else.
 */
function computeReplacementLevels(
  projections: Array<Omit<PlayerProjection, "vbd">>,
): ReplacementLevels {
  const result: Partial<ReplacementLevels> = {};
  const positions: FantasyPosition[] = ["QB", "RB", "WR", "TE"];

  for (const pos of positions) {
    const atPos = projections.filter((p) => p.position === pos);
    const perScoring: Record<ScoringSystem, number> = { PPR: 0, Half: 0, Standard: 0 };
    for (const scoring of SCORING_SYSTEMS) {
      const sorted = [...atPos].sort(
        (a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring],
      );
      const idx = Math.min(REPLACEMENT_RANK[pos], sorted.length) - 1;
      perScoring[scoring] = sorted[idx]?.fantasyPoints[scoring] ?? 0;
    }
    result[pos] = perScoring;
  }

  return result as ReplacementLevels;
}
