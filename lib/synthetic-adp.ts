/**
 * Synthetic 12-week ADP history per source.
 *
 * PLACEHOLDER — Until we ingest real time-series ADP snapshots (likely a
 * `platform_rankings_snapshots` table with (source, player_id, week,
 * scoring_system, rank_value) and a weekly cron), the player detail page's
 * ADP-over-time chart needs *something* plausible to render. This module
 * fabricates that history deterministically:
 *
 *   - Seeded PRNG keyed off `${playerId}-${source}` so the curve is stable
 *     across page loads (no jitter between renders).
 *   - 12 weekly points per source. Random walk of ±3 spots per step around a
 *     base rank in the neighborhood of the current rank.
 *   - Final point is *anchored* to the current rank exactly, so the chart
 *     connects to today's reality. The 11 prior points fill backward.
 *
 * Swap-out plan: when the real snapshot table exists, replace
 * `buildSyntheticAdpHistory` with a function that takes the same arguments
 * and queries the snapshot table. The component contract (returned shape)
 * stays the same.
 */
import type { SyntheticAdpSource } from "@/lib/synthetic-adp-sources";

export const SYNTHETIC_ADP_WEEKS = 12;

export type AdpPoint = { week: number; rank: number };

export type AdpHistoryBySource = Partial<Record<SyntheticAdpSource, AdpPoint[]>>;

/**
 * Deterministic 32-bit hash → seed for the PRNG. Same string in, same seed
 * out, across server and client.
 */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, good-enough PRNG. Returns [0, 1). */
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
 * Build a synthetic 12-week history for a single (player, source) pair.
 *
 * Walks BACKWARD from the anchored final point so week 12 always equals the
 * current rank exactly. Each step is currentRank + integer in [-3, +3].
 * Ranks are clamped to [1, 250] so very-late-round players never go negative.
 */
function buildSeriesForSource(
  playerId: number,
  source: SyntheticAdpSource,
  currentRank: number,
): AdpPoint[] {
  const rng = mulberry32(hashSeed(`${playerId}-${source}`));
  const points: AdpPoint[] = new Array(SYNTHETIC_ADP_WEEKS);
  // Anchor week 12 to the current rank exactly.
  points[SYNTHETIC_ADP_WEEKS - 1] = {
    week: SYNTHETIC_ADP_WEEKS,
    rank: Math.max(1, Math.round(currentRank)),
  };
  // Walk backward, ±3 per step around the anchor.
  let prev = points[SYNTHETIC_ADP_WEEKS - 1].rank;
  for (let i = SYNTHETIC_ADP_WEEKS - 2; i >= 0; i--) {
    const delta = Math.round((rng() - 0.5) * 6); // [-3, +3]
    prev = Math.min(250, Math.max(1, prev + delta));
    points[i] = { week: i + 1, rank: prev };
  }
  return points;
}

/**
 * Given a player's current rank per source, build a synthetic 12-week history
 * for every source that has a current rank. Sources with `null` rank are
 * omitted from the result so the chart skips them entirely.
 */
export function buildSyntheticAdpHistory(
  playerId: number,
  currentRanksBySource: Partial<Record<SyntheticAdpSource, number | null>>,
): AdpHistoryBySource {
  const out: AdpHistoryBySource = {};
  for (const [source, rank] of Object.entries(currentRanksBySource) as Array<
    [SyntheticAdpSource, number | null | undefined]
  >) {
    if (rank == null || !Number.isFinite(rank)) continue;
    out[source] = buildSeriesForSource(playerId, source, rank);
  }
  return out;
}
