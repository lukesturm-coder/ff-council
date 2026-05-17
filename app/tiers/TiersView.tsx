"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  FantasyPosition,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { computeTiersForPosition, tierStyle } from "@/lib/tiers";

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

  function setParam(key: "scoring" | "source", value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set(key, value);
    router.replace(`/tiers?${params.toString()}`, { scroll: false });
  }

  const councilForScoring = councilByScoring[scoring] ?? {};

  return (
    <div className="space-y-6">
      <Controls
        scoring={scoring}
        source={source}
        hasCouncilData={hasCouncilData}
        onScoring={(s) => setParam("scoring", s)}
        onSource={(s) => setParam("source", s)}
      />

      {requested === "council" && !hasCouncilData && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-amber-300">
          No council consensus yet — falling back to Vegas FPts.
        </div>
      )}

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
  hasCouncilData,
  onScoring,
  onSource,
}: {
  scoring: ScoringSystem;
  source: Source;
  hasCouncilData: boolean;
  onScoring: (s: ScoringSystem) => void;
  onSource: (s: Source) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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

  // Compute tier-level summary chips (Tier 1: 2 players · 412.3-389.1 FPts).
  // Computed before any early return so hook order stays stable.
  const tierSummaries = useMemo(() => {
    const byTier = new Map<number, { players: number; fpts: number[] }>();
    for (const p of clustered.tiers) {
      const entry = byTier.get(p.tier) ?? { players: 0, fpts: [] };
      entry.players += 1;
      entry.fpts.push(p.fantasyPoints[scoring]);
      byTier.set(p.tier, entry);
    }
    return Array.from(byTier.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([tier, s]) => ({
        tier,
        players: s.players,
        max: Math.max(...s.fpts),
        min: Math.min(...s.fpts),
      }));
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

      {/* Tier summary chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {tierSummaries.map((t) => {
          const s = tierStyle(t.tier);
          return (
            <span
              key={t.tier}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ring-1 ring-inset ${s.badge}`}
              title={`Tier ${t.tier}: ${t.players} ${t.players === 1 ? "player" : "players"} · ${t.min.toFixed(1)}–${t.max.toFixed(1)} FPts`}
            >
              <span className="font-mono font-semibold">T{t.tier}</span>
              <span className="text-zinc-300/90">
                {t.players}p
              </span>
              <span className="hidden font-mono tabular-nums text-zinc-300/80 sm:inline">
                {t.min.toFixed(0)}–{t.max.toFixed(0)}
              </span>
            </span>
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
