"use client";

import { useMemo, useState } from "react";
import {
  ADP_SOURCES,
  type AdpSourceMeta,
  type SyntheticAdpSource,
} from "@/lib/synthetic-adp-sources";
import type { AdpHistoryBySource } from "@/lib/synthetic-adp";

// Inline SVG, no chart library. viewBox uses a fixed coordinate space so the
// chart scales fluidly to its container width while text + strokes stay
// visually consistent across mobile (375px) and desktop.
const VIEW_W = 800;
const VIEW_H = 320;
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

const WEEKS = 12;

export default function AdpChart({
  history,
}: {
  history: AdpHistoryBySource;
}) {
  // Limit pills + lines to sources that actually have data for this player.
  const availableSources: AdpSourceMeta[] = useMemo(
    () => ADP_SOURCES.filter((s) => history[s.key] && history[s.key]!.length > 0),
    [history],
  );

  const [visible, setVisible] = useState<Set<SyntheticAdpSource>>(() => {
    const init = new Set<SyntheticAdpSource>();
    for (const s of ADP_SOURCES) {
      if (s.defaultVisible && history[s.key]) init.add(s.key);
    }
    // Failsafe: if none of the defaults are available (e.g. only Sleeper +
    // NFL exist), seed with whatever IS available so the chart isn't empty.
    if (init.size === 0) {
      for (const s of ADP_SOURCES.slice(0, 3)) {
        if (history[s.key]) init.add(s.key);
      }
    }
    return init;
  });

  const [hovered, setHovered] = useState<SyntheticAdpSource | null>(null);

  // Y-axis domain: clamp to the visible data so the curves use the full
  // vertical space. Round outward to nice numbers (multiples of 5).
  const { yMin, yMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of availableSources) {
      if (!visible.has(s.key)) continue;
      const series = history[s.key]!;
      for (const p of series) {
        if (p.rank < min) min = p.rank;
        if (p.rank > max) max = p.rank;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { yMin: 1, yMax: 100 };
    }
    // Pad domain by ~10% of range for breathing room, then round.
    const range = Math.max(4, max - min);
    const pad = Math.max(2, Math.round(range * 0.1));
    const lo = Math.max(1, Math.floor((min - pad) / 5) * 5);
    const hi = Math.max(lo + 5, Math.ceil((max + pad) / 5) * 5);
    return { yMin: lo, yMax: hi };
  }, [availableSources, visible, history]);

  // Scales. X: week 1..12 → plot. Y: rank (inverted, lower rank = higher Y).
  const xFor = (week: number) =>
    PAD_LEFT + ((week - 1) / (WEEKS - 1)) * PLOT_W;
  const yFor = (rank: number) =>
    PAD_TOP + ((rank - yMin) / (yMax - yMin)) * PLOT_H;

  // Y-axis ticks: 4 evenly spaced rank labels across the domain.
  const yTicks = useMemo(() => {
    const steps = 4;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push(Math.round(yMin + ((yMax - yMin) * i) / steps));
    }
    return out;
  }, [yMin, yMax]);

  // Build SVG path for each visible series.
  const pathFor = (series: { week: number; rank: number }[]) =>
    series
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${xFor(p.week).toFixed(2)} ${yFor(p.rank).toFixed(2)}`,
      )
      .join(" ");

  function toggle(source: SyntheticAdpSource) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  if (availableSources.length < 2) {
    // Caller should be gating this — defensive empty state.
    return null;
  }

  return (
    <div>
      <div className="h-[240px] w-full sm:h-[280px]">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="ADP movement over 12 preseason weeks"
        >
          {/* Horizontal grid lines + Y-axis labels */}
          {yTicks.map((rank) => {
            const y = yFor(rank);
            return (
              <g key={`y-${rank}`}>
                <line
                  x1={PAD_LEFT}
                  x2={VIEW_W - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="rgba(39,39,42,0.4)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-zinc-600"
                  fontSize={10}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {rank}
                </text>
              </g>
            );
          })}

          {/* X-axis labels: week 1, 4, 8, 12 */}
          {[1, 4, 8, 12].map((wk) => (
            <text
              key={`x-${wk}`}
              x={xFor(wk)}
              y={VIEW_H - 8}
              textAnchor="middle"
              className="fill-zinc-600"
              fontSize={10}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              W{wk}
            </text>
          ))}

          {/* Series — non-hovered render first so the hovered line draws on top */}
          {availableSources
            .filter((s) => visible.has(s.key))
            .sort((a, b) => {
              const ah = hovered === a.key ? 1 : 0;
              const bh = hovered === b.key ? 1 : 0;
              return ah - bh;
            })
            .map((s) => {
              const series = history[s.key]!;
              const isHovered = hovered === s.key;
              const dim = hovered != null && !isHovered;
              return (
                <g key={s.key}>
                  <path
                    d={pathFor(series)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={isHovered ? 2.5 : 1.75}
                    strokeOpacity={dim ? 0.25 : 1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    onMouseEnter={() => setHovered(s.key)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer" }}
                  />
                  {/* Endpoint dot on week 12 for the visible/hovered lines */}
                  <circle
                    cx={xFor(WEEKS)}
                    cy={yFor(series[series.length - 1].rank)}
                    r={isHovered ? 3.5 : 2.5}
                    fill={s.color}
                    fillOpacity={dim ? 0.3 : 1}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
        </svg>
      </div>

      {/* Source toggle pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {availableSources.map((s) => {
          const isOn = visible.has(s.key);
          const isHovered = hovered === s.key;
          const series = history[s.key]!;
          const currentRank = series[series.length - 1].rank;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              onMouseEnter={() => isOn && setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                isOn
                  ? "border-zinc-700 bg-zinc-900 text-zinc-200"
                  : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-400"
              } ${isHovered ? "ring-1 ring-zinc-600" : ""}`}
              aria-pressed={isOn}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: isOn ? s.color : "transparent",
                  border: isOn ? "none" : `1px solid ${s.color}`,
                }}
              />
              <span>{s.label}</span>
              {isOn && (
                <span className="font-mono text-[10px] text-zinc-500">
                  #{currentRank}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        12-week preseason ADP movement. Lower is better.
      </p>
    </div>
  );
}
