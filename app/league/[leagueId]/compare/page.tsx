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
  ScoringSystem,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllPlayers,
  fetchLeague,
  fetchLeagueRosters,
  fetchLeagueUsers,
  type SleeperRoster,
  type SleeperUser,
} from "@/lib/sleeper";
import { PlayerMatcher } from "@/lib/player-matching";

const FANTASY_POSITIONS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE"]);

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

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

type PlatformRow = {
  player_id: number;
  source: string;
  ranking_type: "editorial" | "adp";
  scoring_system: ScoringSystem;
  rank_value: number;
};

async function loadLookups(scoring: ScoringSystem) {
  const supabase = await createClient();
  const [platform, council] = await Promise.all([
    supabase
      .from("platform_rankings")
      .select("player_id, source, ranking_type, scoring_system, rank_value")
      .eq("scoring_system", scoring),
    supabase
      .from("council_consensus")
      .select("player_id, avg_rank")
      .eq("scoring_system", scoring),
  ]);

  const espnAdp = new Map<number, number>();
  for (const r of (platform.data ?? []) as PlatformRow[]) {
    if (r.source === "espn" && r.ranking_type === "adp") {
      espnAdp.set(r.player_id, Number(r.rank_value));
    }
  }
  const councilLookup = new Map<number, number>();
  for (const row of council.data ?? []) {
    councilLookup.set(row.player_id as number, Number(row.avg_rank));
  }
  return { espnAdp, councilLookup };
}

type EnrichedPlayer = {
  sleeperId: string;
  name: string;
  team: string | null;
  position: FantasyPosition | null;
  fpts: number;
  vbd: number;
  espnAdp: number | null;
  councilRank: number | null;
};

type TeamData = {
  rosterId: number;
  ownerName: string;
  teamName: string;
  starters: EnrichedPlayer[];
  bench: EnrichedPlayer[];
  totalFpts: number;
  positionScores: Record<FantasyPosition, number>;
  avgEspnAdp: number | null;
  avgCouncil: number | null;
};

function classifyPosition(pos: string | null | undefined): FantasyPosition | null {
  if (!pos) return null;
  return FANTASY_POSITIONS.has(pos) ? (pos as FantasyPosition) : null;
}

function pickBest(
  pool: EnrichedPlayer[],
  used: Set<string>,
  eligible: readonly FantasyPosition[],
): EnrichedPlayer | null {
  let best: EnrichedPlayer | null = null;
  let bestScore = -Infinity;
  for (const p of pool) {
    if (used.has(p.sleeperId)) continue;
    if (!p.position || !eligible.includes(p.position)) continue;
    if (p.fpts > bestScore) {
      bestScore = p.fpts;
      best = p;
    }
  }
  return best;
}

function buildOptimalLineup(
  roster: EnrichedPlayer[],
  slots: string[],
): EnrichedPlayer[] {
  const used = new Set<string>();
  const lineup: EnrichedPlayer[] = [];
  for (const slot of slots) {
    if (["FLEX", "SUPER_FLEX", "BN", "IR", "TAXI"].includes(slot)) continue;
    if (!FANTASY_POSITIONS.has(slot)) continue;
    const best = pickBest(roster, used, [slot as FantasyPosition]);
    if (best) {
      used.add(best.sleeperId);
      lineup.push(best);
    }
  }
  for (const slot of slots) {
    if (slot === "FLEX") {
      const best = pickBest(roster, used, ["RB", "WR", "TE"]);
      if (best) {
        used.add(best.sleeperId);
        lineup.push(best);
      }
    } else if (slot === "SUPER_FLEX") {
      const best = pickBest(roster, used, ["QB", "RB", "WR", "TE"]);
      if (best) {
        used.add(best.sleeperId);
        lineup.push(best);
      }
    }
  }
  return lineup;
}

function avgOrNull(vals: (number | null)[]): number | null {
  const filtered = vals.filter((v): v is number => v != null);
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { leagueId } = await params;
  const { a, b } = await searchParams;
  const scoring: ScoringSystem = "PPR";

  let league, users, rosters, allPlayers, projections, lookups;
  try {
    [league, users, rosters, allPlayers, projections, lookups] =
      await Promise.all([
        fetchLeague(leagueId),
        fetchLeagueUsers(leagueId),
        fetchLeagueRosters(leagueId),
        fetchAllPlayers(),
        loadProjections(),
        loadLookups(scoring),
      ]);
  } catch (err) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <p className="text-rose-300">
            Couldn&apos;t load league:{" "}
            {err instanceof Error ? err.message : String(err)}
          </p>
        </div>
      </main>
    );
  }

  const ourRosterEntries: PlayerRosterEntry[] = projections.map((p) => ({
    PlayerID: p.playerId,
    Name: p.name,
    Team: p.team,
    FantasyPosition: p.position,
  }));
  const matcher = new PlayerMatcher(ourRosterEntries);
  const projectionById = new Map<number, PlayerProjection>(
    projections.map((p) => [p.playerId, p]),
  );
  const userById = new Map<string, SleeperUser>(
    users.map((u) => [u.user_id, u]),
  );

  // Build TeamData for every team in the league (we display only the chosen
  // two but need them all to compute selectors)
  const teamsById = new Map<number, TeamData>();
  for (const roster of rosters as SleeperRoster[]) {
    const enriched: EnrichedPlayer[] = (roster.players ?? []).map((sid) => {
      const sp = allPlayers[sid];
      if (!sp) {
        return {
          sleeperId: sid,
          name: `#${sid}`,
          team: null,
          position: null,
          fpts: 0,
          vbd: 0,
          espnAdp: null,
          councilRank: null,
        };
      }
      const name =
        sp.full_name ||
        `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
      const position = classifyPosition(sp.position);
      const match = matcher.match({ name, team: sp.team });
      const projection = match.matched
        ? projectionById.get(match.playerId)
        : null;
      const pid = projection?.playerId ?? null;
      return {
        sleeperId: sid,
        name,
        team: sp.team,
        position,
        fpts: projection?.fantasyPoints[scoring] ?? 0,
        vbd: projection?.vbd[scoring] ?? 0,
        espnAdp: pid != null ? (lookups.espnAdp.get(pid) ?? null) : null,
        councilRank: pid != null ? (lookups.councilLookup.get(pid) ?? null) : null,
      };
    });

    const starters = buildOptimalLineup(enriched, league.roster_positions);
    const starterIds = new Set(starters.map((p) => p.sleeperId));
    const bench = enriched.filter((p) => !starterIds.has(p.sleeperId));

    const POSITION_DEPTH: Record<FantasyPosition, number> = {
      QB: 2,
      RB: 4,
      WR: 5,
      TE: 2,
    };
    const positionScore = (pos: FantasyPosition): number =>
      enriched
        .filter((p) => p.position === pos)
        .sort((a, b) => b.fpts - a.fpts)
        .slice(0, POSITION_DEPTH[pos])
        .reduce((sum, p) => sum + p.fpts, 0);

    const owner = roster.owner_id ? userById.get(roster.owner_id) : null;

    teamsById.set(roster.roster_id, {
      rosterId: roster.roster_id,
      ownerName: owner?.display_name ?? `Roster ${roster.roster_id}`,
      teamName:
        owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`,
      starters,
      bench,
      totalFpts: starters.reduce((sum, p) => sum + p.fpts, 0),
      positionScores: {
        QB: positionScore("QB"),
        RB: positionScore("RB"),
        WR: positionScore("WR"),
        TE: positionScore("TE"),
      },
      avgEspnAdp: avgOrNull(starters.map((p) => p.espnAdp)),
      avgCouncil: avgOrNull(starters.map((p) => p.councilRank)),
    });
  }

  const sortedTeams = Array.from(teamsById.values()).sort(
    (a, b) => b.totalFpts - a.totalFpts,
  );

  // Default selections: top 2 by Vegas score
  const aId = Number(a ?? sortedTeams[0]?.rosterId);
  const bId = Number(b ?? sortedTeams[1]?.rosterId);
  const teamA = teamsById.get(aId) ?? sortedTeams[0];
  const teamB = teamsById.get(bId) ?? sortedTeams[1];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-6 py-6">

        <div className="mb-4 flex items-baseline justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 className="text-2xl font-semibold">{league.name} — Head to Head</h2>
            <p className="text-sm text-zinc-400">
              {league.season} · scoring {scoring}
            </p>
          </div>
          <Link
            href={`/league/${leagueId}`}
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← Back to league
          </Link>
        </div>

        {/* Team selectors */}
        <form method="get" className="mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="a"
              className="block text-xs uppercase tracking-wider text-zinc-500"
            >
              Team A
            </label>
            <select
              id="a"
              name="a"
              defaultValue={String(teamA?.rosterId ?? "")}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            >
              {sortedTeams.map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  {t.teamName} — {t.ownerName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="b"
              className="block text-xs uppercase tracking-wider text-zinc-500"
            >
              Team B
            </label>
            <select
              id="b"
              name="b"
              defaultValue={String(teamB?.rosterId ?? "")}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            >
              {sortedTeams.map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  {t.teamName} — {t.ownerName}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30"
          >
            Compare
          </button>
        </form>

        {!teamA || !teamB ? (
          <p className="text-sm text-zinc-400">Pick two teams above.</p>
        ) : (
          <div className="space-y-6">
            {/* Headline metrics */}
            <div className="grid grid-cols-2 gap-4">
              <TeamHeader team={teamA} accent="rose" />
              <TeamHeader team={teamB} accent="sky" />
            </div>

            {/* Position-by-position */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Position Depth
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                    const a = teamA.positionScores[pos];
                    const b = teamB.positionScores[pos];
                    const winner =
                      Math.abs(a - b) < 1 ? "tie" : a > b ? "A" : "B";
                    return (
                      <tr key={pos} className="border-t border-zinc-800/40">
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[pos]}`}
                          >
                            {pos}
                          </span>
                        </td>
                        <td
                          className={`py-2 pr-4 text-right font-mono font-semibold tabular-nums ${
                            winner === "A" ? "text-rose-300" : "text-zinc-400"
                          }`}
                        >
                          {a.toFixed(1)}
                          {winner === "A" && (
                            <span className="ml-1 text-xs">←</span>
                          )}
                        </td>
                        <td className="w-24 py-2 text-center font-mono text-xs text-zinc-600">
                          {winner === "tie"
                            ? "≈"
                            : winner === "A"
                              ? `A +${(a - b).toFixed(1)}`
                              : `B +${(b - a).toFixed(1)}`}
                        </td>
                        <td
                          className={`py-2 pl-4 text-left font-mono font-semibold tabular-nums ${
                            winner === "B" ? "text-sky-300" : "text-zinc-400"
                          }`}
                        >
                          {winner === "B" && (
                            <span className="mr-1 text-xs">→</span>
                          )}
                          {b.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Rosters side-by-side */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RosterPanel team={teamA} accent="rose" />
              <RosterPanel team={teamB} accent="sky" />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function TeamHeader({
  team,
  accent,
}: {
  team: TeamData;
  accent: "rose" | "sky";
}) {
  const color = accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className={`text-xs uppercase tracking-wider ${color}`}>Team {accent === "rose" ? "A" : "B"}</p>
      <h3 className="mt-1 text-lg font-semibold text-zinc-100">
        {team.teamName}
      </h3>
      <p className="text-xs text-zinc-500">{team.ownerName}</p>
      <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-zinc-500">Vegas FPts</p>
          <p className="font-mono text-lg font-semibold text-zinc-100">
            {team.totalFpts.toFixed(1)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Avg ESPN ADP</p>
          <p className="font-mono text-lg text-zinc-300">
            {team.avgEspnAdp != null ? team.avgEspnAdp.toFixed(1) : "—"}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Avg Council</p>
          <p className="font-mono text-lg text-zinc-300">
            {team.avgCouncil != null ? team.avgCouncil.toFixed(1) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function RosterPanel({
  team,
  accent,
}: {
  team: TeamData;
  accent: "rose" | "sky";
}) {
  const color = accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className={`text-xs uppercase tracking-wider ${color}`}>
        {team.teamName}
      </p>
      <h4 className="mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Starters
      </h4>
      <RosterTable players={team.starters} />
      {team.bench.length > 0 && (
        <>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Bench
          </h4>
          <RosterTable players={team.bench} />
        </>
      )}
    </div>
  );
}

function RosterTable({ players }: { players: EnrichedPlayer[] }) {
  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {players.map((p) => (
          <tr
            key={p.sleeperId}
            className="border-t border-zinc-800/40"
          >
            <td className="py-1">
              <span className={p.fpts > 0 ? "text-zinc-100" : "text-zinc-600"}>
                {p.name}
              </span>
            </td>
            <td className="py-1 px-2">
              {p.position && (
                <span
                  className={`inline-flex rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                >
                  {p.position}
                </span>
              )}
            </td>
            <td className="py-1 font-mono text-zinc-500">{p.team ?? "—"}</td>
            <td className="py-1 text-right font-mono tabular-nums">
              {p.fpts > 0 ? p.fpts.toFixed(1) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
