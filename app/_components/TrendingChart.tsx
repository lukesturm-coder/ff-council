"use client";

import { useMemo, useState } from "react";
import type { TrendingPoint } from "@/lib/trending";

// Inline-SVG multi-line chart (same approach as the player ADP chart). Y axis
// is rank, inverted so #1 sits at the top. Each series is a player's recent
// rank trajectory; risers are drawn emerald, fallers rose (color decided by the
// caller so the side list can show matching swatches).

const VIEW_W = 800;
const VIEW_H = 320;
const PAD_LEFT = 30;
const PAD_RIGHT = 14;
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

export default function TrendingChart({
  series,
  weeks,
}: {
  series: TrendingSeries[];
  weeks: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

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

  const pathFor = (points: TrendingPoint[]) =>
    points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${xFor(p.week).toFixed(2)} ${yFor(p.rank).toFixed(2)}`,
      )
      .join(" ");

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
                stroke="rgba(39,39,42,0.45)"
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
            const ah = hovered === a.playerId ? 1 : 0;
            const bh = hovered === b.playerId ? 1 : 0;
            return ah - bh;
          })
          .map((s) => {
            const isHovered = hovered === s.playerId;
            const dim = hovered != null && !isHovered;
            const last = s.points[s.points.length - 1];
            if (!last) return null;
            return (
              <g key={s.playerId}>
                <path
                  d={pathFor(s.points)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={isHovered ? 3.5 : 2.5}
                  strokeOpacity={dim ? 0.18 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  onMouseEnter={() => setHovered(s.playerId)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer" }}
                />
                <circle
                  cx={xFor(last.week)}
                  cy={yFor(last.rank)}
                  r={isHovered ? 4.5 : 3.5}
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
