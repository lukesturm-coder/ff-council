import type { PlatformRankingsMap } from "@/app/_components/RankingsTable";
import type { PlayerProjection, ScoringSystem } from "@/lib/types";

/**
 * Layer plausible mock rankings on top of any source that doesn't have a
 * real fetch script wired up yet, so the multi-source table doesn't look
 * empty during development. Numbers are deterministic from Vegas baseline +
 * per-platform noise — same player + same platform = same rank.
 *
 * Coverage matrix (kept honest as sources go live):
 *   - sleeper / nfl / yahoo: REAL fetches shipped, mock only fills gaps
 *     where the source doesn't list a player.
 *   - cbs: NO real fetch — Akamai-protected, dropped from scope. We do
 *     NOT mock it so the column shows `—` and reads as "no data yet"
 *     rather than fake numbers (per the dashes-not-hiding rule).
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
        if (byType[scoring] == null) byType[scoring] = rank;
      }
    });
  }
  return out;
}
