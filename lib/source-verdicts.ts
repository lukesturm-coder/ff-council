/**
 * Source Verdicts — per-source diff between the two sides of a posted trade.
 *
 * For each ranking source we attach a per-player VALUE (not just a rank), sum
 * the value across each side, and report the side-A-minus-side-B difference.
 *
 * Value model
 * -----------
 *   - Vegas: use the player's projected fantasy points directly (already a
 *     value in fantasy-point units for the trade's scoring system).
 *   - Every other source publishes RANKS (1 = best). We convert rank → value
 *     via a positional ADP-style curve calibrated so rank 1 ≈ Vegas's top FPts
 *     and rank ~200 ≈ 0. The curve is linear in v1 — explicit and easy to
 *     tune. Form:
 *
 *         value(rank) = max(0, TOP_VALUE - (rank - 1) * SLOPE)
 *
 *     With TOP_VALUE ≈ 300 (a tier-1 RB's PPR projection) and SLOPE ≈ 1.5,
 *     rank 200 lands at 300 - 199*1.5 = 1.5 → effectively 0. A future
 *     iteration can swap this for a logarithmic curve fit to Vegas FPts.
 *
 * Missing-data policy
 * -------------------
 *   - If any player on either side has no rank/projection from a source,
 *     the source returns `dataUnavailable: true` and no diff. We never fudge
 *     a player as "rank 200" when they're missing — that would silently
 *     penalize new/rookie players who just haven't been ranked yet.
 *
 * Picks are out of scope for v1. Callers should surface a "(picks not counted)"
 * hint in the UI when either side has picks.
 */

import type { PlatformRankingsMap } from "@/app/_components/RankingsTable";
import type { CouncilConsensusMap } from "@/app/_components/RankingsTable";
import type { PlayerProjection, ScoringSystem } from "@/lib/types";

export type TradeSidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  /**
   * Real SportsDataIO player ID resolved at the panel boundary via a
   * name+team lookup against the Vegas roster. Optional because not every
   * player in our synthetic-id universe has a Vegas counterpart yet.
   * Used by the Vegas computer; other computers stick to `player_id`.
   */
  sdioPlayerId?: number | null;
};

export type TradeSide = {
  players: TradeSidePlayer[];
  picks: Array<unknown>;
};

export type SourceVerdict = {
  /** UI label for the source row. */
  label: string;
  /** Stable key used for React keys / accents. */
  key: string;
  /**
   * Side A total - Side B total in fantasy-point-equivalent units.
   * Positive = Team A favored. Null when the source can't be evaluated.
   */
  diff: number | null;
  /** Reason the source has no diff (only populated when diff is null). */
  dataUnavailable: boolean;
  /** Names of players this source had no data for (for diagnostic tooltips). */
  missingPlayers: string[];
  /** One-line description of how this diff was computed. */
  note: string;
};

const TOP_VALUE = 300;
const SLOPE = 1.5;

/**
 * Convert a rank (1 = best) to a fantasy-point-equivalent value. Clamps to
 * zero at the bottom of the curve so deep ranks don't go negative.
 */
export function rankToValue(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  return Math.max(0, TOP_VALUE - (rank - 1) * SLOPE);
}

/** "Even" threshold in fantasy points. Below this we call it a wash.
 * Calibrated to roughly one RB1-flex weekly swap — matches the casual
 * "this trade feels fair" eyeball test. */
export const EVEN_THRESHOLD = 10;

export function formatVerdict(
  diff: number | null,
  dataUnavailable: boolean,
): string {
  if (dataUnavailable || diff == null) return "—";
  const abs = Math.abs(diff);
  if (abs < EVEN_THRESHOLD) return "Even";
  const winner = diff > 0 ? "Team A" : "Team B";
  return `${winner} by ${Math.round(abs)} pts`;
}

type Side = TradeSide;

/**
 * Look up a player's rank for a given source, falling back from the trade's
 * scoring system to PPR (most sources publish PPR consistently; Half/Standard
 * often inherit from it). Returns null if neither editorial nor ADP rank is
 * present.
 */
function platformRank(
  platformRankings: PlatformRankingsMap,
  playerId: number,
  source: string,
  scoring: ScoringSystem,
): number | null {
  const tryScoring: ScoringSystem[] =
    scoring === "PPR" ? ["PPR"] : [scoring, "PPR"];
  const types: Array<"editorial" | "adp"> = ["editorial", "adp"];
  for (const s of tryScoring) {
    for (const t of types) {
      const v = platformRankings[playerId]?.[source]?.[t]?.[s];
      if (v != null) return v.rank;
    }
  }
  return null;
}

type SourceComputer = (player: TradeSidePlayer) => number | null;

/**
 * Sum per-player values across one side using the given computer. Returns
 * either the total or the list of missing player names. Picks are ignored.
 */
function sumSide(
  side: Side,
  compute: SourceComputer,
): { total: number; missing: string[] } {
  let total = 0;
  const missing: string[] = [];
  for (const p of side.players) {
    if (p.player_id == null) {
      missing.push(p.name);
      continue;
    }
    const v = compute(p);
    if (v == null) {
      missing.push(p.name);
      continue;
    }
    total += v;
  }
  return { total, missing };
}

function computeDiff(
  sideA: Side,
  sideB: Side,
  compute: SourceComputer,
): { diff: number | null; missing: string[] } {
  const a = sumSide(sideA, compute);
  const b = sumSide(sideB, compute);
  const missing = [...a.missing, ...b.missing];
  if (missing.length > 0) return { diff: null, missing };
  return { diff: a.total - b.total, missing: [] };
}

export type ComputeSourceVerdictsInput = {
  sideA: Side;
  sideB: Side;
  scoring: ScoringSystem;
  projections: PlayerProjection[];
  platformRankings: PlatformRankingsMap;
  councilConsensus: CouncilConsensusMap;
};

/**
 * The canonical ordering for the panel — Council first (it's the headline
 * brand), Vegas second (it's the FF Council ranking model), then the
 * platforms roughly in order of audience size.
 */
const SOURCE_ORDER: Array<{ key: string; label: string }> = [
  { key: "council", label: "Council" },
  { key: "vegas", label: "Vegas" },
  { key: "espn", label: "ESPN" },
  { key: "fantasypros", label: "FantasyPros" },
  { key: "sleeper", label: "Sleeper" },
  { key: "nfl", label: "NFL" },
  { key: "yahoo", label: "Yahoo" },
];

export function computeSourceVerdicts(
  input: ComputeSourceVerdictsInput,
): SourceVerdict[] {
  const { sideA, sideB, scoring, projections, platformRankings, councilConsensus } =
    input;

  const projectionById = new Map<number, PlayerProjection>(
    projections.map((p) => [p.playerId, p]),
  );

  const computers: Record<string, SourceComputer> = {
    council: (p) => {
      if (p.player_id == null) return null;
      const tryScoring: ScoringSystem[] =
        scoring === "PPR" ? ["PPR"] : [scoring, "PPR"];
      for (const s of tryScoring) {
        const row = councilConsensus[p.player_id]?.[s];
        if (row != null) return rankToValue(row.avgRank);
      }
      return null;
    },
    vegas: (p) => {
      // Vegas projections key off SportsDataIO ids; trades store synthetic
      // mock ids. The panel enriches each player with `sdioPlayerId` via a
      // name+team lookup before calling us — falling back to player_id only
      // when no SDIO match was resolved (e.g., backfilled trades that
      // happen to share the id space).
      const lookupId = p.sdioPlayerId ?? p.player_id;
      if (lookupId == null) return null;
      const proj = projectionById.get(lookupId);
      if (!proj) return null;
      return proj.fantasyPoints[scoring];
    },
    espn: (p) =>
      p.player_id == null
        ? null
        : (() => {
            const r = platformRank(platformRankings, p.player_id, "espn", scoring);
            return r == null ? null : rankToValue(r);
          })(),
    fantasypros: (p) =>
      p.player_id == null
        ? null
        : (() => {
            const r = platformRank(
              platformRankings,
              p.player_id,
              "fantasypros",
              scoring,
            );
            return r == null ? null : rankToValue(r);
          })(),
    sleeper: (p) =>
      p.player_id == null
        ? null
        : (() => {
            const r = platformRank(
              platformRankings,
              p.player_id,
              "sleeper",
              scoring,
            );
            return r == null ? null : rankToValue(r);
          })(),
    nfl: (p) =>
      p.player_id == null
        ? null
        : (() => {
            const r = platformRank(platformRankings, p.player_id, "nfl", scoring);
            return r == null ? null : rankToValue(r);
          })(),
    yahoo: (p) =>
      p.player_id == null
        ? null
        : (() => {
            const r = platformRank(
              platformRankings,
              p.player_id,
              "yahoo",
              scoring,
            );
            return r == null ? null : rankToValue(r);
          })(),
  };

  const notes: Record<string, string> = {
    council: "sourced from council_consensus",
    vegas: "sourced from Vegas-derived projections",
    espn: "sourced from platform_rankings",
    fantasypros: "sourced from platform_rankings",
    sleeper: "sourced from platform_rankings",
    nfl: "sourced from platform_rankings",
    yahoo: "sourced from platform_rankings",
  };

  return SOURCE_ORDER.map(({ key, label }) => {
    const { diff, missing } = computeDiff(sideA, sideB, computers[key]);
    return {
      key,
      label,
      diff,
      dataUnavailable: diff == null,
      missingPlayers: missing,
      note: notes[key],
    };
  });
}
