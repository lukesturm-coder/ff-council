import type { PlatformRankingsMap } from "@/app/_components/RankingsTable";
import type { PlayerProjection, ScoringSystem } from "@/lib/types";

/**
 * Layer plausible mock rankings on top of any source that doesn't have full
 * real coverage yet — keeps the multi-source table from looking sparse
 * while real fetches grow. Numbers are deterministic from Vegas baseline +
 * per-platform noise so same player + same platform = same rank.
 *
 * CBS is intentionally absent — the column is removed from the product
 * entirely (Akamai-protected, not worth bypassing).
 */

const SCORINGS: ScoringSystem[] = ["PPR", "Half", "Standard"];

const MOCK_PLATFORMS: { source: string; type: "editorial" | "adp" }[] = [
  { source: "sleeper", type: "adp" },
  { source: "nfl", type: "editorial" },
  { source: "yahoo", type: "editorial" },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function withMockPlatformRankings(
  existing: PlatformRankingsMap,
  projections: PlayerProjection[],
): PlatformRankingsMap {
  const out: PlatformRankingsMap = { ...existing };

  for (const scoring of SCORINGS) {
    const sorted = [...projections].sort(
      (a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring],
    );
    sorted.forEach((p, idx) => {
      const vegasRank = idx + 1;
      for (const { source, type } of MOCK_PLATFORMS) {
        const noise = (hash(`${source}:${p.playerId}:${scoring}`) % 11) - 5; // -5..+5
        const rank = Math.max(1, vegasRank + noise);

        const player = out[p.playerId] ?? (out[p.playerId] = {});
        const src = player[source] ?? (player[source] = {});
        const byType = src[type] ?? (src[type] = {});
        // Only fill in mock when the real fetch hasn't produced an entry for
        // this (source, type, scoring). Mocks have no `points` value — Points
        // view will show — for mocked sources, which is honest signal that
        // we don't actually know their projection.
        if (byType[scoring] == null) {
          byType[scoring] = { rank, points: null };
        }
      }
    });
  }
  return out;
}
