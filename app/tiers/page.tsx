import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FantasyPosition,
  FuturesResponse,
  PlayerProjection,
} from "@/lib/types";
import Header from "@/app/_components/Header";

async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  return projectionsFromFutures(futures, roster);
}

type TierLetter = "S" | "A" | "B" | "C" | "D";
const TIER_LETTERS: TierLetter[] = ["S", "A", "B", "C", "D"];

const TIER_STYLES: Record<TierLetter, { badge: string; row: string; label: string }> = {
  S: {
    badge: "bg-amber-400/25 text-amber-200 ring-amber-400/50",
    row: "border-amber-500/20",
    label: "Elite",
  },
  A: {
    badge: "bg-emerald-400/20 text-emerald-200 ring-emerald-400/40",
    row: "border-emerald-500/20",
    label: "Strong",
  },
  B: {
    badge: "bg-sky-400/15 text-sky-200 ring-sky-400/30",
    row: "border-sky-500/15",
    label: "Solid",
  },
  C: {
    badge: "bg-zinc-500/20 text-zinc-300 ring-zinc-500/40",
    row: "border-zinc-700/40",
    label: "Bench depth",
  },
  D: {
    badge: "bg-zinc-700/30 text-zinc-500 ring-zinc-700/50",
    row: "border-zinc-800/40",
    label: "Replacement",
  },
};

const POSITIONS: { code: FantasyPosition; name: string; accent: string }[] = [
  { code: "QB", name: "Quarterbacks", accent: "text-rose-300" },
  { code: "RB", name: "Running Backs", accent: "text-emerald-300" },
  { code: "WR", name: "Wide Receivers", accent: "text-sky-300" },
  { code: "TE", name: "Tight Ends", accent: "text-amber-300" },
];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

/**
 * Find natural tier boundaries via the largest FPts gaps between consecutive
 * players. Returns 4 break indices → 5 tiers (S/A/B/C/D). Each index is the
 * rank position where a NEW tier starts.
 */
function findTierBreaks(sortedFpts: number[]): number[] {
  if (sortedFpts.length < 5) {
    return [1, 2, 3, 4].map((n) =>
      Math.max(1, Math.min(sortedFpts.length - 1, Math.round((n * sortedFpts.length) / 5))),
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

type TieredPlayer = PlayerProjection & { tier: TierLetter; rank: number };

function assignTiers(players: PlayerProjection[]): TieredPlayer[] {
  const sorted = [...players].sort(
    (a, b) => b.fantasyPoints.PPR - a.fantasyPoints.PPR,
  );
  const breaks = findTierBreaks(sorted.map((p) => p.fantasyPoints.PPR));
  return sorted.map((p, idx) => {
    let tierIdx = TIER_LETTERS.length - 1;
    for (let i = 0; i < breaks.length; i++) {
      if (idx < breaks[i]) {
        tierIdx = i;
        break;
      }
    }
    return {
      ...p,
      tier: TIER_LETTERS[tierIdx],
      rank: idx + 1,
    };
  });
}

export default async function TiersPage() {
  const projections = await loadProjections();

  const positionGroups = POSITIONS.map(({ code, name, accent }) => {
    const positionPlayers = projections.filter((p) => p.position === code);
    const tiered = assignTiers(positionPlayers);
    const byTier = new Map<TierLetter, TieredPlayer[]>();
    for (const letter of TIER_LETTERS) byTier.set(letter, []);
    for (const p of tiered) byTier.get(p.tier)!.push(p);
    return { code, name, accent, byTier, total: tiered.length };
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <Header />

        <div className="mb-4 border-b border-zinc-800 pb-3">
          <h2 className="text-xl font-semibold sm:text-2xl">Tiers</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Players grouped into <span className="text-zinc-200">S / A / B / C / D</span>{" "}
            tiers based on natural cliffs in Vegas-projected fantasy points.
            Players within a tier are roughly interchangeable; tier breaks
            mark real talent drops.
          </p>
        </div>

        <div className="space-y-8">
          {positionGroups.map((pos) => (
            <section key={pos.code}>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className={`text-lg font-semibold ${pos.accent}`}>{pos.code}</h3>
                <span className="text-sm text-zinc-400">{pos.name}</span>
                <span className="ml-auto text-xs text-zinc-500">
                  {pos.total} players
                </span>
              </div>

              <div className="space-y-2">
                {TIER_LETTERS.map((letter) => {
                  const players = pos.byTier.get(letter) ?? [];
                  if (players.length === 0) return null;
                  const style = TIER_STYLES[letter];
                  return (
                    <div
                      key={letter}
                      className={`rounded-lg border bg-zinc-900 ${style.row}`}
                    >
                      <div className="flex items-center gap-2 border-b border-zinc-800/40 px-3 py-2.5 sm:gap-3 sm:px-4">
                        <span
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded font-mono text-sm font-bold ring-1 ring-inset ${style.badge}`}
                        >
                          {letter}
                        </span>
                        <span className="text-sm font-medium text-zinc-200">
                          Tier {letter}
                        </span>
                        <span className="hidden text-xs text-zinc-500 sm:inline">
                          · {style.label}
                        </span>
                        <span className="ml-auto text-right text-xs text-zinc-500">
                          {players.length}p ·{" "}
                          {players[0].fantasyPoints.PPR.toFixed(0)}–
                          {players[players.length - 1].fantasyPoints.PPR.toFixed(0)}
                          <span className="hidden sm:inline"> FPts</span>
                        </span>
                      </div>
                      <ul className="divide-y divide-zinc-800/40">
                        {players.map((p) => (
                          <li
                            key={p.playerId}
                            className="flex items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4"
                          >
                            <span className="w-6 shrink-0 text-right font-mono text-xs text-zinc-500 sm:w-8">
                              #{p.rank}
                            </span>
                            <Link
                              href={`/player/${p.playerId}`}
                              className="truncate font-medium text-zinc-100 hover:text-emerald-300 hover:underline underline-offset-4"
                            >
                              {p.name}
                            </Link>
                            <span
                              className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                            >
                              {p.position}
                            </span>
                            <span className="hidden font-mono text-xs text-zinc-400 sm:inline">
                              {p.team}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-sm tabular-nums text-zinc-300">
                              {p.fantasyPoints.PPR.toFixed(1)}
                              <span className="ml-1 hidden text-xs text-zinc-500 sm:inline">FPts</span>
                            </span>
                            <span className="hidden w-16 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-500 sm:inline">
                              {p.vbd.PPR > 0 ? "+" : ""}
                              {p.vbd.PPR.toFixed(1)} Edge
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          Tier breaks are computed by finding the four largest FPts gaps within
          each position — Vegas-projected talent drops, not fixed percentiles.
          Click any player for the full breakdown.
        </p>
      </div>
    </main>
  );
}
