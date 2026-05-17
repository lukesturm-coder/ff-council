/**
 * Accuracy scoring: given a council member's submitted preseason rankings and
 * a set of actual end-of-season results, compute how well their ordering
 * matched reality.
 *
 * Two metrics:
 *   - Spearman correlation: rank-vs-rank correlation across all ranked players
 *   - Top-N hit rate: how many of their top N picks finished in actual top N
 *
 * Current state: SCAFFOLD ONLY. Real implementation runs after a season's
 * actual_results table is populated.
 */

export type RankedEntry = { playerId: number; rank: number };
export type ActualEntry = { playerId: number; finalFpts: number };

export type AccuracyResult = {
  spearman: number; // -1 to 1
  topNHitRate: number; // 0 to 1
  rankedPlayerCount: number;
  matchedCount: number;
};

/**
 * Compute accuracy of a ranked list vs. actual end-of-season fantasy points.
 * Only considers players that appear in BOTH the ranking and the actual results.
 */
export function computeAccuracy(
  ranked: RankedEntry[],
  actuals: ActualEntry[],
  topN: number = 24,
): AccuracyResult {
  if (ranked.length === 0 || actuals.length === 0) {
    return { spearman: 0, topNHitRate: 0, rankedPlayerCount: 0, matchedCount: 0 };
  }

  // Build actual-rank lookup: best fpts = rank 1
  const sortedActuals = [...actuals].sort((a, b) => b.finalFpts - a.finalFpts);
  const actualRankById = new Map<number, number>();
  sortedActuals.forEach((a, idx) => actualRankById.set(a.playerId, idx + 1));

  // Only score players present in both
  const pairs: Array<{ predicted: number; actual: number }> = [];
  for (const r of ranked) {
    const actual = actualRankById.get(r.playerId);
    if (actual != null) {
      pairs.push({ predicted: r.rank, actual });
    }
  }

  if (pairs.length < 2) {
    return {
      spearman: 0,
      topNHitRate: 0,
      rankedPlayerCount: ranked.length,
      matchedCount: pairs.length,
    };
  }

  // Spearman = Pearson on ranks
  const n = pairs.length;
  const meanP = pairs.reduce((s, p) => s + p.predicted, 0) / n;
  const meanA = pairs.reduce((s, p) => s + p.actual, 0) / n;
  let num = 0,
    denomP = 0,
    denomA = 0;
  for (const { predicted, actual } of pairs) {
    const dp = predicted - meanP;
    const da = actual - meanA;
    num += dp * da;
    denomP += dp * dp;
    denomA += da * da;
  }
  const spearman = denomP > 0 && denomA > 0 ? num / Math.sqrt(denomP * denomA) : 0;

  // Top-N hit rate
  const topNPredicted = ranked
    .filter((r) => r.rank <= topN)
    .map((r) => r.playerId);
  const topNActualSet = new Set(
    sortedActuals.slice(0, topN).map((a) => a.playerId),
  );
  const hits = topNPredicted.filter((id) => topNActualSet.has(id)).length;
  const topNHitRate = topNPredicted.length > 0 ? hits / topNPredicted.length : 0;

  return {
    spearman,
    topNHitRate,
    rankedPlayerCount: ranked.length,
    matchedCount: pairs.length,
  };
}
