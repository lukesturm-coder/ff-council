import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Numbered tiers (Tier 1 … Tier N) computed per position via Jenks natural
// breaks with a Goodness-of-Variance-Fit (GVF) elbow heuristic plus a
// min-tier-size = 2 merge pass. Replaces the old S/A/B/C/D 4-largest-gap
// heuristic, which had three structural problems we want to fix:
//   1. Always emitted exactly 5 tiers regardless of how clumped or smooth the
//      FPts distribution actually was.
//   2. The "4 largest gaps" pick made adjacent gaps look identical even when
//      one was meaningfully bigger than another (it ignored within-tier
//      variance entirely).
//   3. Could yield 1-player tiers, which is the worst-case tier output —
//      it adds visual noise without telling the user anything actionable.
//
// Jenks (a 1-D variant of k-means with sum-of-squared-deviations as the loss)
// is what FantasyPros / Boris Chen do under the hood. We pick K via the
// elbow in GVF rather than fixing K=5, then enforce min-tier-size by merging
// orphans into whichever neighbor is closer in mean.
// ---------------------------------------------------------------------------

// User preference: tier labels are S/A/B/C/D (5 fixed letter tiers).
// We could still vary K dynamically and map to letters, but the user wants
// the familiar five-tier rubric, so we cap K=5. Jenks + GVF still picks the
// best K within [MIN_TIERS, MAX_TIERS] — usually lands at 4 or 5 anyway.
export const MIN_TIERS = 3;
export const MAX_TIERS = 5;

// Tier number → letter. 1 = S (elite), 5 = D (replacement-level).
const TIER_LETTERS = ["", "S", "A", "B", "C", "D"] as const;
export function tierLetter(tier: number): string {
  return TIER_LETTERS[tier] ?? "—";
}
export const MIN_TIER_SIZE = 2;
export const GVF_THRESHOLD = 0.85;

const POSITIONS: FantasyPosition[] = ["QB", "RB", "WR", "TE"];

// ---- Tier color ramp -------------------------------------------------------
// 8 visually distinct, dark-bg friendly colors spanning emerald → fuchsia.
// Each tier number always maps to the same swatch (Tier 1 = emerald), so the
// color is a stable visual handle regardless of how many tiers a position has.
// All colors use Tailwind ring/bg/text triples with /20 backgrounds so adjacent
// rows with the same tier read as a connected band on zinc-950.

export type TierStyle = {
  /** badge classes — for compact numeric Tier chips */
  badge: string;
  /** row background tint — for chart row banding */
  row: string;
  /** divider color — for inline "── Tier N ──" separators */
  border: string;
  /** descriptive label used in tooltips */
  label: string;
};

export const TIER_STYLES: Record<number, TierStyle> = {
  1: {
    badge: "bg-emerald-400/25 text-emerald-100 ring-emerald-400/50",
    row: "bg-emerald-500/10",
    border: "border-emerald-400/40",
    label: "Elite",
  },
  2: {
    badge: "bg-teal-400/20 text-teal-100 ring-teal-400/40",
    row: "bg-teal-500/10",
    border: "border-teal-400/40",
    label: "High-end starter",
  },
  3: {
    badge: "bg-cyan-400/20 text-cyan-100 ring-cyan-400/40",
    row: "bg-cyan-500/10",
    border: "border-cyan-400/40",
    label: "Solid starter",
  },
  4: {
    badge: "bg-sky-400/20 text-sky-100 ring-sky-400/40",
    row: "bg-sky-500/10",
    border: "border-sky-400/40",
    label: "Mid-tier starter",
  },
  5: {
    badge: "bg-blue-400/20 text-blue-100 ring-blue-400/40",
    row: "bg-blue-500/10",
    border: "border-blue-400/40",
    label: "Flex / matchup",
  },
  6: {
    badge: "bg-indigo-400/20 text-indigo-100 ring-indigo-400/40",
    row: "bg-indigo-500/10",
    border: "border-indigo-400/40",
    label: "Bench / upside",
  },
  7: {
    badge: "bg-violet-400/20 text-violet-100 ring-violet-400/40",
    row: "bg-violet-500/10",
    border: "border-violet-400/40",
    label: "Deep bench",
  },
  8: {
    badge: "bg-fuchsia-400/20 text-fuchsia-100 ring-fuchsia-400/40",
    row: "bg-fuchsia-500/10",
    border: "border-fuchsia-400/40",
    label: "Replacement",
  },
};

const FALLBACK_STYLE: TierStyle = {
  badge: "bg-zinc-500/20 text-zinc-300 ring-zinc-500/40",
  row: "bg-zinc-700/10",
  border: "border-zinc-700/40",
  label: "Bench depth",
};

export function tierStyle(tier: number): TierStyle {
  return TIER_STYLES[tier] ?? FALLBACK_STYLE;
}

// ---- Algorithm ------------------------------------------------------------

export type TierInfo = {
  tier: number;
  position: FantasyPosition;
  /** Number of players in this tier within their position */
  tierSize: number;
  /** Total tier count for this position (so chips can show "Tier 3 of 5") */
  totalTiers: number;
  /** Mean fantasy points within the tier */
  fptsMean: number;
  /** [min, max] FPts within the tier (descending sort: max first, min second is OK either way) */
  fptsRange: [number, number];
};

export type PlayerInTier = {
  playerId: number;
  value: number;
  tier: number;
};

/** Sum-of-squared-deviations from the mean for one tier slice. */
function tierSSD(values: number[], from: number, to: number): number {
  // values is sorted descending; slice is values[from..to)
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  const mean = sum / (to - from);
  let ssd = 0;
  for (let i = from; i < to; i++) {
    const d = values[i] - mean;
    ssd += d * d;
  }
  return ssd;
}

/**
 * Compute Jenks natural breaks for a sorted-descending value array, finding
 * the K-1 break indices that minimize total within-tier SSD.
 *
 * Returns break indices in ascending order — each index is the START of a new
 * tier. For example, breaks=[3, 7] means [0..3) is Tier 1, [3..7) is Tier 2,
 * [7..end) is Tier 3.
 *
 * Uses Fisher's exact dynamic programming algorithm, O(K * N^2) time and
 * O(K * N) space. N is ~25 max so this is trivially fast.
 */
function jenksBreaks(sortedDesc: number[], k: number): number[] {
  const n = sortedDesc.length;
  if (k <= 1 || n <= 1) return [];
  if (k >= n) {
    // One element per tier — break after every element except the last.
    return Array.from({ length: n - 1 }, (_, i) => i + 1);
  }

  // dp[j][i] = minimum total SSD to partition values[0..i) into j tiers.
  // back[j][i] = the start index of the j-th tier in the optimal partition.
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(INF),
  );
  const back: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  // 1 tier covering [0..i): just one SSD chunk.
  for (let i = 1; i <= n; i++) {
    dp[1][i] = tierSSD(sortedDesc, 0, i);
    back[1][i] = 0;
  }

  for (let j = 2; j <= k; j++) {
    // The j-th tier needs at least j elements total to its left.
    for (let i = j; i <= n; i++) {
      // Try all possible start positions for tier j: s ∈ [j-1, i-1].
      for (let s = j - 1; s < i; s++) {
        const cost = dp[j - 1][s] + tierSSD(sortedDesc, s, i);
        if (cost < dp[j][i]) {
          dp[j][i] = cost;
          back[j][i] = s;
        }
      }
    }
  }

  // Reconstruct break indices.
  const breaks: number[] = [];
  let i = n;
  for (let j = k; j > 1; j--) {
    const s = back[j][i];
    breaks.push(s);
    i = s;
  }
  breaks.sort((a, b) => a - b);
  return breaks;
}

/** Total SSD = sum of within-tier SSDs for a given break set. */
function totalSSD(sortedDesc: number[], breaks: number[]): number {
  const bounds = [0, ...breaks, sortedDesc.length];
  let total = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    total += tierSSD(sortedDesc, bounds[i], bounds[i + 1]);
  }
  return total;
}

/** Goodness-of-Variance-Fit: 1 - (within-tier SSD / total SSD). */
function gvf(sortedDesc: number[], breaks: number[]): number {
  if (sortedDesc.length === 0) return 1;
  const sdam = tierSSD(sortedDesc, 0, sortedDesc.length); // total deviation from grand mean
  if (sdam === 0) return 1;
  const sdcm = totalSSD(sortedDesc, breaks);
  return 1 - sdcm / sdam;
}

/**
 * Merge tiers smaller than MIN_TIER_SIZE into whichever adjacent tier has the
 * closer mean. Operates on break indices (ascending). Returns new breaks +
 * the resulting tier sizes for sanity.
 *
 * We loop until stable because a single merge can leave another small tier.
 */
function enforceMinTierSize(
  sortedDesc: number[],
  breaks: number[],
): number[] {
  const n = sortedDesc.length;
  let current = [...breaks];

  // Helper: tier size for tier index t (0-based).
  const sizeOf = (bks: number[], t: number) => {
    const start = t === 0 ? 0 : bks[t - 1];
    const end = t === bks.length ? n : bks[t];
    return end - start;
  };
  // Helper: tier mean.
  const meanOf = (bks: number[], t: number) => {
    const start = t === 0 ? 0 : bks[t - 1];
    const end = t === bks.length ? n : bks[t];
    let s = 0;
    for (let i = start; i < end; i++) s += sortedDesc[i];
    return s / (end - start);
  };

  // Keep merging the smallest offending tier until none remain (or we're at 1).
  while (true) {
    const tierCount = current.length + 1;
    if (tierCount <= 1) break;

    let smallTierIdx = -1;
    for (let t = 0; t < tierCount; t++) {
      if (sizeOf(current, t) < MIN_TIER_SIZE) {
        smallTierIdx = t;
        break;
      }
    }
    if (smallTierIdx === -1) break;

    // Decide which neighbor to merge with.
    let mergeWith: "prev" | "next";
    if (smallTierIdx === 0) mergeWith = "next";
    else if (smallTierIdx === tierCount - 1) mergeWith = "prev";
    else {
      const myMean = meanOf(current, smallTierIdx);
      const prevGap = Math.abs(myMean - meanOf(current, smallTierIdx - 1));
      const nextGap = Math.abs(myMean - meanOf(current, smallTierIdx + 1));
      mergeWith = nextGap < prevGap ? "next" : "prev";
    }

    // Merging tier t with its "prev" neighbor: drop break at index t-1.
    // Merging tier t with its "next" neighbor: drop break at index t.
    const dropIdx = mergeWith === "prev" ? smallTierIdx - 1 : smallTierIdx;
    current = current.filter((_, i) => i !== dropIdx);
  }

  return current;
}

/**
 * Pick the optimal K via GVF elbow, then enforce min tier size.
 *
 * GVF (Goodness-of-Variance-Fit) is the standard Jenks quality metric:
 * 1 - (within-tier-SSD / total-deviation-from-grand-mean). GVF=1 means each
 * tier is perfectly homogeneous; GVF=0 means tiering didn't help at all.
 *
 * Strategy:
 *   - Start at K=MIN_TIERS (3). Walk up to MAX_TIERS (8).
 *   - Take the smallest K such that GVF(K) >= GVF_THRESHOLD (0.85), OR the K
 *     where adding another tier improves GVF by less than half the previous
 *     improvement (derivative falloff — the "elbow").
 *   - 0.85 was chosen because empirically with 20-25 player position groups
 *     and the kind of FPts spreads we see, GVF crosses 0.85 around the
 *     natural break in the distribution (3-5 tiers for QB, 5-7 for WR/RB).
 *     Lower (0.7) overshoots — picks K=3 when there really are 5 meaningful
 *     groupings. Higher (0.92) keeps adding tiny tiers for marginal GVF gains.
 */
function chooseBreaks(sortedDesc: number[]): number[] {
  const n = sortedDesc.length;
  if (n === 0) return [];
  if (n < 4) {
    // Too few for meaningful clustering — one tier.
    return [];
  }
  if (n < 6) {
    // Force K=2 for very small position groups.
    const breaks = jenksBreaks(sortedDesc, 2);
    return enforceMinTierSize(sortedDesc, breaks);
  }

  // Cap K so we don't ask for more tiers than we have room for given the
  // min-tier-size constraint.
  const maxFeasibleK = Math.max(
    MIN_TIERS,
    Math.min(MAX_TIERS, Math.floor(n / MIN_TIER_SIZE)),
  );

  type Candidate = { k: number; breaks: number[]; gvf: number };
  const candidates: Candidate[] = [];
  for (let k = MIN_TIERS; k <= maxFeasibleK; k++) {
    const breaks = jenksBreaks(sortedDesc, k);
    candidates.push({ k, breaks, gvf: gvf(sortedDesc, breaks) });
  }

  // Rule 1: smallest K with GVF >= threshold.
  const goodEnough = candidates.find((c) => c.gvf >= GVF_THRESHOLD);
  let picked: Candidate;
  if (goodEnough) {
    picked = goodEnough;
  } else {
    // Rule 2: elbow detection — find the K where the marginal GVF gain drops
    // below half the prior gain. If no clear elbow, pick the K with highest GVF.
    let elbow: Candidate | null = null;
    for (let i = 2; i < candidates.length; i++) {
      const prevGain = candidates[i - 1].gvf - candidates[i - 2].gvf;
      const thisGain = candidates[i].gvf - candidates[i - 1].gvf;
      if (prevGain > 0 && thisGain < prevGain * 0.5) {
        elbow = candidates[i - 1];
        break;
      }
    }
    picked =
      elbow ??
      candidates.reduce((best, c) => (c.gvf > best.gvf ? c : best), candidates[0]);
  }

  return enforceMinTierSize(sortedDesc, picked.breaks);
}

/**
 * Cluster a single position's players into numbered tiers. Pure & deterministic.
 *
 * `getValue` lets callers cluster on FPts, VBD, or council avg-rank (in which
 * case the caller should pass `-avgRank` to keep "higher = better"). The
 * function sorts internally; the caller does not need to pre-sort.
 */
export function computeTiersForPosition<T extends { playerId: number }>(
  players: T[],
  getValue: (p: T) => number,
): { breaks: number[]; tiers: Array<PlayerInTier & T> } {
  const sorted = [...players].sort((a, b) => getValue(b) - getValue(a));
  const values = sorted.map(getValue);
  const breaks = chooseBreaks(values);

  const tiered: Array<PlayerInTier & T> = sorted.map((p, idx) => {
    let tier = breaks.length + 1; // last tier by default
    for (let i = 0; i < breaks.length; i++) {
      if (idx < breaks[i]) {
        tier = i + 1;
        break;
      }
    }
    return { ...p, playerId: p.playerId, value: getValue(p), tier };
  });

  return { breaks, tiers: tiered };
}

/**
 * Per-position numbered tiers keyed by playerId, computed from Vegas FPts.
 * Returns rich TierInfo so call sites can render badges + tooltips without
 * recomputing means/sizes.
 */
export function computeTiersByPlayer(
  projections: PlayerProjection[],
  scoring: ScoringSystem,
): Map<number, TierInfo> {
  const out = new Map<number, TierInfo>();
  for (const pos of POSITIONS) {
    const positionPlayers = projections.filter((p) => p.position === pos);
    if (positionPlayers.length === 0) continue;

    const { tiers } = computeTiersForPosition(
      positionPlayers,
      (p) => p.fantasyPoints[scoring],
    );

    // Bucket tier stats so each TierInfo carries its tier-level aggregates.
    const totalTiers = tiers.reduce((m, t) => Math.max(m, t.tier), 0);
    const byTier = new Map<number, number[]>();
    for (const t of tiers) {
      if (!byTier.has(t.tier)) byTier.set(t.tier, []);
      byTier.get(t.tier)!.push(t.value);
    }
    const tierStats = new Map<
      number,
      { size: number; mean: number; range: [number, number] }
    >();
    Array.from(byTier.entries()).forEach(([t, vals]) => {
      const sum = vals.reduce((s, v) => s + v, 0);
      const mean = sum / vals.length;
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      tierStats.set(t, { size: vals.length, mean, range: [max, min] });
    });

    for (const t of tiers) {
      const stats = tierStats.get(t.tier)!;
      out.set(t.playerId, {
        tier: t.tier,
        position: pos,
        tierSize: stats.size,
        totalTiers,
        fptsMean: stats.mean,
        fptsRange: stats.range,
      });
    }
  }
  return out;
}

// ---- Display helpers ------------------------------------------------------

/** Tooltip-friendly description of a tier within its position. */
export function tierDescription(
  tier: number,
  position: FantasyPosition,
  size: number,
): string {
  const style = tierStyle(tier);
  const playersWord = size === 1 ? "player" : "players";
  return `Tier ${tierLetter(tier)} · ${style.label} ${position} (${size} ${playersWord})`;
}
