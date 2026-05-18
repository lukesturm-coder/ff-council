"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { computeTiersForPosition, tierStyle, tierLetter } from "@/lib/tiers";
import DraftBoardView from "./DraftBoardView";

// Scoring & source toggles are read/written via URL params so a Tier badge on
// another page can deep-link straight to the right view without us juggling
// component state.
const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];
// Note: Superflex / TEPremium are valid filters elsewhere in the app, but
// PlayerProjection.fantasyPoints only carries PPR/Half/Standard today. We'd
// need additional scoring math in lib/projections to render those tier charts
// — left out of this pass so the tier algorithm doesn't silently fall back to
// PPR FPts and mislabel it as "Superflex".

type Source = "vegas" | "council";
type Mode = "chart" | "board";
const POSITIONS: FantasyPosition[] = ["QB", "RB", "WR", "TE"];
const POSITION_LABELS: Record<FantasyPosition, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
};
const POSITION_CHIP: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

/** scoring → playerId → council avg rank (lower is better). */
export type CouncilAvgMap = Record<ScoringSystem, Record<number, number>>;

export default function TiersView({
  projections,
  councilByScoring,
  hasCouncilData,
}: {
  projections: PlayerProjection[];
  councilByScoring: CouncilAvgMap;
  hasCouncilData: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const scoring = parseScoring(sp.get("scoring"));
  const sourceParam = sp.get("source");
  // Auto-fall-back to vegas if user asked for council but we have no data.
  const requested: Source = sourceParam === "council" ? "council" : "vegas";
  const source: Source =
    requested === "council" && hasCouncilData ? "council" : "vegas";
  const mode: Mode = sp.get("mode") === "board" ? "board" : "chart";

  function setParam(key: "scoring" | "source" | "mode", value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set(key, value);
    router.replace(`/tiers?${params.toString()}`, { scroll: false });
  }

  // Memoize the lookup so the per-position useMemo below has a stable dep
  // identity (otherwise the `?? {}` fallback creates a new empty object every
  // render and re-triggers the heavy clustering work).
  const councilForScoring = useMemo(
    () => councilByScoring[scoring] ?? {},
    [councilByScoring, scoring],
  );

  // Pre-compute per-position tier shape for the comparison summary. Mirrors
  // the same clustering logic used inside PositionTierChart so the summary
  // counts agree with what each chart actually renders.
  const positionShapes = useMemo(() => {
    return POSITIONS.map((pos) => {
      const positionPlayers = projections.filter((p) => p.position === pos);
      let clustered;
      if (source === "council") {
        const ranked = positionPlayers.filter(
          (p) => councilForScoring[p.playerId] != null,
        );
        if (ranked.length === 0) {
          clustered = computeTiersForPosition(
            positionPlayers,
            (p) => p.fantasyPoints[scoring],
          );
        } else {
          clustered = computeTiersForPosition(
            ranked,
            (p) => -councilForScoring[p.playerId],
          );
        }
      } else {
        clustered = computeTiersForPosition(
          positionPlayers,
          (p) => p.fantasyPoints[scoring],
        );
      }
      const totalTiers = clustered.tiers.reduce(
        (m, t) => Math.max(m, t.tier),
        0,
      );
      return { pos, tiers: totalTiers, players: clustered.tiers.length };
    });
  }, [projections, scoring, source, councilForScoring]);

  return (
    <div className="space-y-6">
      <Controls
        scoring={scoring}
        source={source}
        mode={mode}
        hasCouncilData={hasCouncilData}
        onScoring={(s) => setParam("scoring", s)}
        onSource={(s) => setParam("source", s)}
        onMode={(m) => setParam("mode", m)}
      />

      {requested === "council" && !hasCouncilData && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-amber-300">
          No council consensus yet — falling back to Vegas FPts.
        </div>
      )}

      {mode === "board" ? (
        <DraftBoardView
          projections={projections}
          scoring={scoring}
          source={source}
          councilAvgRank={councilForScoring}
        />
      ) : (
        <>
          <PositionComparisonSummary shapes={positionShapes} />
          {POSITIONS.map((pos) => (
            <PositionTierChart
              key={pos}
              position={pos}
              projections={projections}
              scoring={scoring}
              source={source}
              councilAvgRank={councilForScoring}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * One-liner showing tier counts per position so you can see at a glance
 * which position groups are stratified vs flat. Stays visible on mobile.
 */
function PositionComparisonSummary({
  shapes,
}: {
  shapes: Array<{ pos: FantasyPosition; tiers: number; players: number }>;
}) {
  const nonEmpty = shapes.filter((s) => s.players > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 sm:text-sm">
      <span className="mr-2 text-[10px] uppercase tracking-wider text-zinc-500 sm:text-xs">
        Shape
      </span>
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
        {nonEmpty.map((s, idx) => (
          <span key={s.pos} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_CHIP[s.pos]}`}
            >
              {s.pos}
            </span>
            <span>
              {s.tiers} {s.tiers === 1 ? "tier" : "tiers"} · {s.players} players
            </span>
            {idx < nonEmpty.length - 1 && (
              <span className="text-zinc-600">|</span>
            )}
          </span>
        ))}
      </span>
    </div>
  );
}

function parseScoring(v: string | null): ScoringSystem {
  if (v === "Half" || v === "Standard" || v === "PPR") return v;
  return "PPR";
}

function Controls({
  scoring,
  source,
  mode,
  hasCouncilData,
  onScoring,
  onSource,
  onMode,
}: {
  scoring: ScoringSystem;
  source: Source;
  mode: Mode;
  hasCouncilData: boolean;
  onScoring: (s: ScoringSystem) => void;
  onSource: (s: Source) => void;
  onMode: (m: Mode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          View
        </span>
        <button
          onClick={() => onMode("chart")}
          className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
            mode === "chart"
              ? "bg-emerald-500/20 text-emerald-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          title="Browse tiers as a value-bar chart"
        >
          Chart
        </button>
        <button
          onClick={() => onMode("board")}
          className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
            mode === "board"
              ? "bg-emerald-500/20 text-emerald-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          title="On-the-clock draft board — click to mark drafted"
        >
          Draft board
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          Scoring
        </span>
        {SCORING_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onScoring(s)}
            className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
              scoring === s
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
          Source
        </span>
        <button
          onClick={() => onSource("vegas")}
          className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
            source === "vegas"
              ? "bg-emerald-500/20 text-emerald-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          title="Cluster on Vegas-implied fantasy points"
        >
          Vegas
        </button>
        <button
          onClick={() => onSource("council")}
          disabled={!hasCouncilData}
          className={`rounded-md px-2 py-1 text-sm font-medium transition sm:px-3 ${
            source === "council"
              ? "bg-emerald-500/20 text-emerald-200"
              : "text-zinc-400 hover:text-zinc-200"
          } disabled:cursor-not-allowed disabled:opacity-40`}
          title={
            hasCouncilData
              ? "Cluster on council average rank"
              : "No council consensus yet"
          }
        >
          Council
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile layout decision (375px iPhone width):
//
// The Boris-Chen reference layout puts player names on the left and a value
// bar on the right of each row. We use the same vertical-row layout but make
// each row full-container-width — no horizontal scroll. The bar is rendered
// as an absolutely-positioned div behind the row content, scaled to a 0..1
// share of the position's value range. At 375px the player chip + team are
// truncated with `min-w-0 truncate`, and the FPts value chip remains aligned
// right. This avoids the "side-scroll a chart" pattern, which is hostile on
// mobile, while preserving the visual "tiers as connected color bands"
// affordance — adjacent same-tier rows share a tinted background.
// ---------------------------------------------------------------------------

function PositionTierChart({
  position,
  projections,
  scoring,
  source,
  councilAvgRank,
}: {
  position: FantasyPosition;
  projections: PlayerProjection[];
  scoring: ScoringSystem;
  source: Source;
  councilAvgRank: Record<number, number>;
}) {
  // Why we choose FPts as the bar metric even when source=council:
  //   The TIER assignment uses the source-selected signal (so council-driven
  //   tiers reflect council opinion), but the bar visualizes raw FPts because
  //   "how many points per game does this player score" is the most universally
  //   meaningful magnitude. Council avg rank as a bar would just be "1..N"
  //   which compresses the visual range and tells us less.
  const positionPlayers = useMemo(
    () => projections.filter((p) => p.position === position),
    [projections, position],
  );

  // Pick the clustering signal. Higher = better is the algorithm's contract,
  // so council avg-rank (lower = better) is negated.
  const clustered = useMemo(() => {
    if (source === "council") {
      // Restrict to players the council has ranked. Players with no council
      // rank can't be tiered against the council signal — drop them so we
      // don't bias the cluster.
      const ranked = positionPlayers.filter(
        (p) => councilAvgRank[p.playerId] != null,
      );
      if (ranked.length === 0) {
        // No council ranks for this position — fall back to Vegas FPts so the
        // chart still renders something useful.
        return computeTiersForPosition(
          positionPlayers,
          (p) => p.fantasyPoints[scoring],
        );
      }
      return computeTiersForPosition(
        ranked,
        (p) => -councilAvgRank[p.playerId],
      );
    }
    return computeTiersForPosition(
      positionPlayers,
      (p) => p.fantasyPoints[scoring],
    );
  }, [positionPlayers, scoring, source, councilAvgRank]);

  // Compute tier-level summary chips (Tier S · 3p · 412-389 FPts · σ 11.4).
  // Computed before any early return so hook order stays stable.
  //
  // We bucket FPts within each tier into 5 equal-width bins for the inline
  // mini-histogram. Why 5 bins: matches the eye's ability to read a tiny
  // sparkline without overplotting, and lines up with the bar count the spec
  // calls for. Single-player tiers collapse to a single 1-tall bar.
  const tierSummaries = useMemo(() => {
    const HIST_BINS = 5;
    const byTier = new Map<number, { players: number; fpts: number[] }>();
    for (const p of clustered.tiers) {
      const entry = byTier.get(p.tier) ?? { players: 0, fpts: [] };
      entry.players += 1;
      entry.fpts.push(p.fantasyPoints[scoring]);
      byTier.set(p.tier, entry);
    }
    return Array.from(byTier.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([tier, s]) => {
        const min = Math.min(...s.fpts);
        const max = Math.max(...s.fpts);
        const mean = s.fpts.reduce((a, b) => a + b, 0) / s.fpts.length;
        // Population std-dev — tiers are the whole population at hand, not
        // a sample of some hidden distribution. With n=1 we just return 0.
        const variance =
          s.fpts.length > 1
            ? s.fpts.reduce((a, v) => a + (v - mean) * (v - mean), 0) /
              s.fpts.length
            : 0;
        const stdev = Math.sqrt(variance);
        // Build histogram buckets. Range==0 (single-value tier) → one filled bin.
        const range = max - min;
        const bins = new Array<number>(HIST_BINS).fill(0);
        for (const v of s.fpts) {
          if (range === 0) {
            bins[0] += 1;
          } else {
            // Clamp the top-end so the max value lands in the last bin
            // rather than overflowing.
            const idx = Math.min(
              HIST_BINS - 1,
              Math.floor(((v - min) / range) * HIST_BINS),
            );
            bins[idx] += 1;
          }
        }
        return {
          tier,
          players: s.players,
          max,
          min,
          stdev,
          bins,
        };
      });
  }, [clustered, scoring]);

  if (clustered.tiers.length === 0) {
    return null;
  }

  // Bar scaling — always show FPts magnitudes on the bar (see comment above).
  const fptsValues = clustered.tiers.map((p) => p.fantasyPoints[scoring]);
  const maxFpts = Math.max(...fptsValues, 1);
  const minFpts = Math.min(...fptsValues, 0);
  const fptsRange = Math.max(maxFpts - minFpts, 1);

  const totalTiers = tierSummaries.length;
  const sourceLabel =
    source === "council" ? "Council avg-rank" : `${scoring} FPts (Vegas)`;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-100 sm:text-lg">
          {POSITION_LABELS[position]}
        </h3>
        <span className="text-xs text-zinc-500">
          {totalTiers} {totalTiers === 1 ? "tier" : "tiers"} ·{" "}
          {clustered.tiers.length} players · clustered on {sourceLabel}
        </span>
      </div>

      {/* Tier summary strip — one chip per tier with count, FPts range, σ.
          On sm+ we tuck a tiny inline FPts histogram to the right of each chip
          so you can spot whether a tier is bottom-heavy / top-heavy / even. */}
      <div className="mb-3 flex flex-wrap gap-x-2 gap-y-1.5">
        {tierSummaries.map((t) => {
          const s = tierStyle(t.tier);
          return (
            <div
              key={t.tier}
              className="inline-flex items-center gap-1.5"
            >
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ring-1 ring-inset ${s.badge}`}
                title={`Tier ${tierLetter(t.tier)}: ${t.players} ${t.players === 1 ? "player" : "players"} · ${t.min.toFixed(1)}–${t.max.toFixed(1)} FPts · σ ${t.stdev.toFixed(1)}`}
              >
                <span className="font-mono font-semibold">
                  Tier {tierLetter(t.tier)}
                </span>
                <span className="text-zinc-300/90">{t.players}p</span>
                <span className="hidden font-mono tabular-nums text-zinc-300/80 sm:inline">
                  {t.min.toFixed(0)}–{t.max.toFixed(0)}
                </span>
                <span className="hidden font-mono tabular-nums text-zinc-300/70 sm:inline">
                  σ {t.stdev.toFixed(1)}
                </span>
              </span>
              <TierHistogram bins={t.bins} tier={t.tier} />
            </div>
          );
        })}
      </div>

      {/* Cluster chart — one row per player. */}
      <ol className="overflow-hidden rounded-md border border-zinc-800">
        {clustered.tiers.map((p, idx) => {
          const fpts = p.fantasyPoints[scoring];
          const widthPct = ((fpts - minFpts) / fptsRange) * 100;
          // Boris-Chen-style minimum so even the lowest-FPts player gets a
          // visible bar — without this, the bar disappears for the bottom row.
          const renderWidth = Math.max(widthPct, 8);
          const style = tierStyle(p.tier);
          const prev = idx > 0 ? clustered.tiers[idx - 1] : null;
          const isTierBoundary = prev !== null && prev.tier !== p.tier;

          return (
            <li key={p.playerId} className="block">
              {isTierBoundary && (
                <div
                  className={`flex items-center gap-2 border-t bg-zinc-950/60 px-3 py-1 ${style.border}`}
                  aria-label={`Tier ${p.tier} starts here`}
                >
                  <span
                    className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${style.badge}`}
                  >
                    T{p.tier}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                    Tier {p.tier} ·{" "}
                    {tierSummaries.find((t) => t.tier === p.tier)?.players ?? 0}{" "}
                    players
                  </span>
                  <span className={`h-px flex-1 border-t ${style.border}`} />
                </div>
              )}
              <div
                className={`relative flex items-center gap-2 px-3 py-2 sm:gap-3 ${style.row}`}
              >
                {/* Bar — absolute layer underneath the content row */}
                <div
                  className={`pointer-events-none absolute inset-y-0 left-0 ${style.row} opacity-60`}
                  style={{ width: `${renderWidth}%` }}
                  aria-hidden
                />
                <span className="relative w-6 shrink-0 text-right font-mono text-xs text-zinc-500 sm:w-8">
                  {idx + 1}
                </span>
                <span
                  className={`relative inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_CHIP[p.position]}`}
                >
                  {p.position}
                </span>
                <span className="relative min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
                  {p.name}
                </span>
                <span className="relative hidden shrink-0 font-mono text-[11px] text-zinc-400 sm:inline">
                  {p.team}
                </span>
                <span
                  className={`relative inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${style.badge}`}
                  title={`Tier ${p.tier} of ${totalTiers}`}
                >
                  T{p.tier}
                </span>
                <span className="relative w-12 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-300 sm:w-16">
                  {fpts.toFixed(1)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Inline FPts mini-histogram for a single tier. Renders as a tiny SVG of
 * vertical bars whose height is proportional to how many players fall into
 * that FPts bucket within the tier. Tinted to the tier's color via
 * tierStyle(tier).badge classes on a wrapper.
 *
 * Desktop-only (sm:): on mobile we hide it to keep the strip from wrapping
 * uncontrollably — the chip itself already shows player count + range + σ,
 * which are the most important numbers.
 */
function TierHistogram({ bins, tier }: { bins: number[]; tier: number }) {
  const style = tierStyle(tier);
  const max = Math.max(...bins, 1);
  // 80x20 viewBox. With 5 bins and a 1px gap we get ~15px per bar — readable
  // at the natural rendered width without artifacts.
  const W = 80;
  const H = 20;
  const gap = 1;
  const barW = (W - gap * (bins.length - 1)) / bins.length;
  return (
    <span
      className={`hidden items-center rounded px-1 py-0.5 ring-1 ring-inset sm:inline-flex ${style.badge}`}
      title={`FPts distribution within tier (${bins.length} bins)`}
      aria-hidden
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        role="img"
      >
        {bins.map((count, i) => {
          // Min visible height of 1 if any players, so single-player bins
          // still draw as a tick rather than vanishing entirely.
          const h = count === 0 ? 0 : Math.max(1, (count / max) * (H - 2));
          const x = i * (barW + gap);
          const y = H - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill="currentColor"
              opacity={count === 0 ? 0.15 : 0.85}
            />
          );
        })}
      </svg>
    </span>
  );
}
