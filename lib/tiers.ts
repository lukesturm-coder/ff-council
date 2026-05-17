import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";

export type TierLetter = "S" | "A" | "B" | "C" | "D";
export const TIER_LETTERS: TierLetter[] = ["S", "A", "B", "C", "D"];

export const TIER_STYLES: Record<
  TierLetter,
  { badge: string; label: string }
> = {
  S: {
    badge: "bg-amber-400/25 text-amber-200 ring-amber-400/50",
    label: "Elite",
  },
  A: {
    badge: "bg-emerald-400/20 text-emerald-200 ring-emerald-400/40",
    label: "Strong",
  },
  B: {
    badge: "bg-sky-400/15 text-sky-200 ring-sky-400/30",
    label: "Solid",
  },
  C: {
    badge: "bg-zinc-500/20 text-zinc-300 ring-zinc-500/40",
    label: "Bench depth",
  },
  D: {
    badge: "bg-zinc-700/30 text-zinc-500 ring-zinc-700/50",
    label: "Replacement",
  },
};

const POSITIONS: FantasyPosition[] = ["QB", "RB", "WR", "TE"];

// Find 4 break-indices in a descending-sorted FPts array using the largest
// consecutive-gap heuristic. Returns ascending-sorted indices that mark where
// each new tier (A, B, C, D) begins.
function findTierBreaks(sortedFpts: number[]): number[] {
  if (sortedFpts.length < 5) {
    return [1, 2, 3, 4].map((n) =>
      Math.max(
        1,
        Math.min(
          sortedFpts.length - 1,
          Math.round((n * sortedFpts.length) / 5),
        ),
      ),
    );
  }
  const gaps = sortedFpts
    .slice(0, -1)
    .map((fpts, idx) => ({ idx: idx + 1, gap: fpts - sortedFpts[idx + 1] }));
  gaps.sort((a, b) => b.gap - a.gap);
  const breaks = gaps.slice(0, 4).map((g) => g.idx);
  breaks.sort((a, b) => a - b);
  return breaks;
}

// Per-position tiers (S/A/B/C/D) keyed by playerId. Computed independently for
// each position group so an S WR isn't being compared to an S RB.
export function computeTiersByPlayer(
  projections: PlayerProjection[],
  scoring: ScoringSystem,
): Map<number, TierLetter> {
  const out = new Map<number, TierLetter>();
  for (const pos of POSITIONS) {
    const players = projections
      .filter((p) => p.position === pos)
      .sort((a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring]);
    if (players.length === 0) continue;
    const breaks = findTierBreaks(players.map((p) => p.fantasyPoints[scoring]));
    players.forEach((p, idx) => {
      let tierIdx = TIER_LETTERS.length - 1;
      for (let i = 0; i < breaks.length; i++) {
        if (idx < breaks[i]) {
          tierIdx = i;
          break;
        }
      }
      out.set(p.playerId, TIER_LETTERS[tierIdx]);
    });
  }
  return out;
}
