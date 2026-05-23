"use client";

import { useMemo } from "react";
import type { TrendingPoint } from "@/lib/trending";

// Inline-SVG multi-line chart. Y axis is rank, inverted so #1 sits at the top.
// Each player keeps its own palette color across the line, endpoint marker, and
// side-list dot. The "active" player (hovered or selected, owned by the parent)
// brightens + thickens + glows while the rest fade back — so the eye tracks one
// trend at a time. Lines are smoothed (Catmull-Rom) for a premium feel.

const VIEW_W = 800;
const VIEW_H = 320;
const PAD_LEFT = 30;
const PAD_RIGHT = 22;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

export type TrendingSeries = {
  playerId: number;
  name: string;
  color: string;
  points: TrendingPoint[];
};

type Pt = { x: number; y: number };

// Catmull-Rom → cubic-bezier smoothing. Keeps endpoints anchored.
function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  }
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export default function TrendingChart({
  series,
  weeks,
  activeId,
  onHover,
  onSelect,
}: {
  series: TrendingSeries[];
  weeks: number;
  activeId: number | null;
  onHover: (playerId: number | null) => void;
  onSelect: (playerId: number) => void;
}) {
  const { yMin, yMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.rank < min) min = p.rank;
        if (p.rank > max) max = p.rank;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { yMin: 1, yMax: 60 };
    }
    const range = Math.max(6, max - min);
    const pad = Math.max(2, Math.round(range * 0.12));
    return { yMin: Math.max(1, min - pad), yMax: max + pad };
  }, [series]);

  const xFor = (week: number) =>
    PAD_LEFT + ((week - 1) / Math.max(1, weeks - 1)) * PLOT_W;
  const yFor = (rank: number) =>
    PAD_TOP + ((rank - yMin) / Math.max(1, yMax - yMin)) * PLOT_H;

  const yTicks = useMemo(() => {
    const steps = 4;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      out.push(Math.round(yMin + ((yMax - yMin) * i) / steps));
    }
    return out;
  }, [yMin, yMax]);

  if (series.length === 0) return null;

  return (
    <div className="h-[220px] w-full sm:h-[260px]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label="Recent ranking movement"
      >
        {yTicks.map((rank) => {
          const y = yFor(rank);
          return (
            <g key={`y-${rank}`}>
              <line
                x1={PAD_LEFT}
                x2={VIEW_W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="rgba(63,63,70,0.28)"
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

        {series
          .slice()
          .sort((a, b) => {
            const ah = activeId === a.playerId ? 1 : 0;
            const bh = activeId === b.playerId ? 1 : 0;
            return ah - bh;
          })
          .map((s) => {
            const isActive = activeId === s.playerId;
            const dim = activeId != null && !isActive;
            const pts = s.points.map((p) => ({
              x: xFor(p.week),
              y: yFor(p.rank),
            }));
            const last = pts[pts.length - 1];
            if (!last) return null;
            const d = smoothPath(pts);
            return (
              <g key={s.playerId}>
                {/* Fat invisible hit area so thin lines are easy to hit/tap. */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                  onMouseEnter={() => onHover(s.playerId)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(s.playerId)}
                  style={{ cursor: "pointer" }}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={isActive ? 3.5 : 2}
                  strokeOpacity={dim ? 0.13 : isActive ? 1 : 0.92}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                  style={
                    isActive
                      ? { filter: `drop-shadow(0 0 5px ${s.color})` }
                      : undefined
                  }
                />
                {/* Endpoint marker — halo ring + dot, like a live market chart. */}
                <circle
                  cx={last.x}
                  cy={last.y}
                  r={isActive ? 7 : 5}
                  fill={s.color}
                  fillOpacity={dim ? 0.06 : 0.18}
                  pointerEvents="none"
                />
                <circle
                  cx={last.x}
                  cy={last.y}
                  r={isActive ? 4 : 3}
                  fill={s.color}
                  fillOpacity={dim ? 0.25 : 1}
                  pointerEvents="none"
                />
              </g>
            );
          })}
      </svg>
    </div>
  );
}
