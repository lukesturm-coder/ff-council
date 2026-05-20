// =====================================================================
// lib/trade-verdict.ts — the "verdict severity" math.
//
// Each council vote on a trade carries a direction (winner: A / B / EVEN)
// and a magnitude (fairness_tier). This module collapses a pile of votes
// into a single SIGNED score on a [-4, +4] axis:
//
//     Team A  ◄──────────── 0 ────────────►  Team B
//        -4                                      +4
//
// Negative = Team A favored, positive = Team B favored, 0 = dead even.
// The magnitude is averaged across votes, so the score reflects BOTH which
// side the council leans AND how lopsided they think the deal is.
//
// Pure functions only — no React, no Supabase. Feed it raw vote rows.
// =====================================================================

export type TradeWinner = "A" | "B" | "EVEN";

export type FairnessTier =
  | "balanced"
  | "slight_edge"
  | "clear_advantage"
  | "major_advantage"
  | "extreme_imbalance";

export type TradeVoteInput = {
  winner: TradeWinner;
  fairness_tier: FairnessTier | string | null;
};

// Magnitude each tier contributes (before applying direction sign).
const TIER_MAGNITUDE: Record<FairnessTier, number> = {
  balanced: 0,
  slight_edge: 1,
  clear_advantage: 2,
  major_advantage: 3,
  extreme_imbalance: 4,
};

// Below this |score| the council is treated as having called it even.
const EVEN_EPSILON = 0.5;

// Zone labels keyed off |score|. The thresholds line up with the tier
// magnitudes so a unanimous "clear_advantage" pile lands squarely in the
// "Clear Advantage" zone, etc.
export type VerdictZone =
  | "even"
  | "slight"
  | "clear"
  | "major"
  | "fleece";

const ZONE_LABEL: Record<VerdictZone, string> = {
  even: "Even",
  slight: "Slight Edge",
  clear: "Clear Advantage",
  major: "Major Advantage",
  fleece: "Fleece",
};

export type TradeVerdict = {
  /** Average signed score in [-4, +4]. Negative = A, positive = B. */
  score: number;
  /** Total number of votes counted. */
  total: number;
  /** Leading side by sign of score (EVEN inside the epsilon band). */
  leader: TradeWinner;
  /** % of votes whose winner matches the leading side (0 when even/no votes). */
  winnerPct: number;
  /** Zone bucket keyed off |score|. */
  zone: VerdictZone;
  /** Human label for the zone, e.g. "Clear Advantage". */
  zoneLabel: string;
  /** One-line verdict, e.g. "Team B wins — Clear Advantage". */
  headline: string;
};

/** Signed value of a single vote on the [-4, +4] axis. */
export function signedVoteValue(vote: TradeVoteInput): number {
  if (vote.winner === "EVEN") return 0;
  const tier = vote.fairness_tier;
  const magnitude =
    tier != null && tier in TIER_MAGNITUDE
      ? TIER_MAGNITUDE[tier as FairnessTier]
      : 0;
  return vote.winner === "A" ? -magnitude : magnitude;
}

/** Map |score| to its severity zone. */
export function zoneForScore(absScore: number): VerdictZone {
  if (absScore < EVEN_EPSILON) return "even";
  if (absScore < 1.5) return "slight";
  if (absScore < 2.5) return "clear";
  if (absScore < 3.5) return "major";
  return "fleece";
}

/** Convert a score in [-4, +4] to a 0–100 marker position (left → right). */
export function scoreToPercent(score: number): number {
  const clamped = Math.max(-4, Math.min(4, score));
  return ((clamped + 4) / 8) * 100;
}

/**
 * Collapse a set of trade votes into a single signed verdict.
 *
 * Leader: sign of the average score (within EVEN_EPSILON of 0 → "EVEN").
 * winnerPct: share of votes whose `winner` matches the leading side. For
 * an "EVEN" verdict this is the share of "EVEN" votes (the council split
 * signal), which the credibility line reframes as "council split".
 */
export function computeTradeVerdict(votes: TradeVoteInput[]): TradeVerdict {
  const total = votes.length;

  if (total === 0) {
    return {
      score: 0,
      total: 0,
      leader: "EVEN",
      winnerPct: 0,
      zone: "even",
      zoneLabel: ZONE_LABEL.even,
      headline: "Council called it even",
    };
  }

  let sum = 0;
  let countA = 0;
  let countB = 0;
  let countEven = 0;
  for (const v of votes) {
    sum += signedVoteValue(v);
    if (v.winner === "A") countA += 1;
    else if (v.winner === "B") countB += 1;
    else countEven += 1;
  }

  const score = sum / total;
  const zone = zoneForScore(Math.abs(score));

  let leader: TradeWinner;
  if (zone === "even") leader = "EVEN";
  else leader = score > 0 ? "B" : "A";

  const leaderCount =
    leader === "A" ? countA : leader === "B" ? countB : countEven;
  const winnerPct = Math.round((leaderCount / total) * 100);

  const zoneLabel = ZONE_LABEL[zone];
  const headline =
    leader === "EVEN"
      ? "Council called it even"
      : `Team ${leader} wins — ${zoneLabel}`;

  return { score, total, leader, winnerPct, zone, zoneLabel, headline };
}

/**
 * Convenience builder for callers that only have aggregate tier counts
 * (e.g. a list-card summary), not the raw vote rows. Reconstructs an
 * equivalent vote array so it flows through computeTradeVerdict unchanged.
 *
 * The per-tier counts must be split by winning side. If a caller only has
 * direction counts (votes_a / votes_b / votes_even) with no tier detail,
 * pass tier counts as undefined and it falls back to treating every
 * non-even vote as a "slight_edge" (magnitude 1) so the meter still points
 * the right way, just without true severity.
 */
export function verdictFromCounts(counts: {
  votes_a: number;
  votes_b: number;
  votes_even: number;
  // Optional per-tier-per-side breakdown.
  tiers_a?: Partial<Record<FairnessTier, number>>;
  tiers_b?: Partial<Record<FairnessTier, number>>;
}): TradeVerdict {
  const votes: TradeVoteInput[] = [];

  const pushSide = (
    winner: "A" | "B",
    sideTotal: number,
    tiers: Partial<Record<FairnessTier, number>> | undefined,
  ) => {
    if (tiers) {
      let tallied = 0;
      for (const [tier, n] of Object.entries(tiers)) {
        for (let i = 0; i < (n ?? 0); i++) {
          votes.push({ winner, fairness_tier: tier as FairnessTier });
          tallied += 1;
        }
      }
      // Any side votes without a tier breakdown fall back to slight_edge.
      for (let i = tallied; i < sideTotal; i++) {
        votes.push({ winner, fairness_tier: "slight_edge" });
      }
    } else {
      for (let i = 0; i < sideTotal; i++) {
        votes.push({ winner, fairness_tier: "slight_edge" });
      }
    }
  };

  pushSide("A", counts.votes_a, counts.tiers_a);
  pushSide("B", counts.votes_b, counts.tiers_b);
  for (let i = 0; i < counts.votes_even; i++) {
    votes.push({ winner: "EVEN", fairness_tier: "balanced" });
  }

  return computeTradeVerdict(votes);
}
