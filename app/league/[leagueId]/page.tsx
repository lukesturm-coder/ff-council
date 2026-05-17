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
  type SleeperUser,
} from "@/lib/sleeper";
import { PlayerMatcher } from "@/lib/player-matching";

/** Compute integer age from an ISO date string like "1998-02-09". */
function ageFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

const FANTASY_POSITIONS: ReadonlySet<string> = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
]);

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
type RankLookup = Map<number, number>;

async function loadAdpLookups(scoring: ScoringSystem): Promise<{
  espnAdp: RankLookup;
  espnRank: RankLookup;
  fpAdp: RankLookup;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_rankings")
    .select("player_id, source, ranking_type, scoring_system, rank_value")
    .eq("scoring_system", scoring);
  const espnAdp = new Map<number, number>();
  const espnRank = new Map<number, number>();
  const fpAdp = new Map<number, number>();
  for (const r of (data ?? []) as PlatformRow[]) {
    const v = Number(r.rank_value);
    if (r.source === "espn") {
      if (r.ranking_type === "adp") espnAdp.set(r.player_id, v);
      else if (r.ranking_type === "editorial") espnRank.set(r.player_id, v);
    } else if (r.source === "fantasypros" && r.ranking_type === "adp") {
      fpAdp.set(r.player_id, v);
    }
  }
  // ESPN ADP is published only as PPR — fall back when scoring is Standard/Half
  if (espnAdp.size === 0 && scoring !== "PPR") {
    const { data: pprData } = await supabase
      .from("platform_rankings")
      .select("player_id, rank_value")
      .eq("scoring_system", "PPR")
      .eq("source", "espn")
      .eq("ranking_type", "adp");
    for (const r of pprData ?? []) {
      espnAdp.set(r.player_id as number, Number(r.rank_value));
    }
  }
  return { espnAdp, espnRank, fpAdp };
}

async function loadCouncilLookup(
  scoring: ScoringSystem,
): Promise<RankLookup> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("council_consensus")
    .select("player_id, avg_rank")
    .eq("scoring_system", scoring);
  const m = new Map<number, number>();
  for (const row of data ?? []) {
    m.set(row.player_id as number, Number(row.avg_rank));
  }
  return m;
}

type EnrichedPlayer = {
  sleeperId: string;
  sleeperName: string;
  team: string | null;
  position: FantasyPosition | null;
  age: number | null;
  projection: PlayerProjection | null;
  espnAdp: number | null;
  espnRank: number | null;
  fpAdp: number | null;
  councilRank: number | null;
};

function classifyPosition(
  pos: string | null | undefined,
): FantasyPosition | null {
  if (!pos) return null;
  return FANTASY_POSITIONS.has(pos) ? (pos as FantasyPosition) : null;
}

/**
 * Pick the best player from the roster who plays one of the eligible positions
 * and isn't already used. "Best" = highest Vegas FPts for the current scoring.
 */
function pickBest(
  pool: EnrichedPlayer[],
  used: Set<string>,
  eligible: readonly FantasyPosition[],
  scoring: ScoringSystem,
): EnrichedPlayer | null {
  let best: EnrichedPlayer | null = null;
  let bestScore = -Infinity;
  for (const p of pool) {
    if (used.has(p.sleeperId)) continue;
    if (!p.position || !eligible.includes(p.position)) continue;
    const score = p.projection?.fantasyPoints[scoring] ?? -1;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/**
 * Walk through the league's roster_positions slots, filling each from the
 * team's roster with the best eligible player. FLEX/SUPER_FLEX fill last.
 */
function buildOptimalLineup(
  roster: EnrichedPlayer[],
  slots: string[],
  scoring: ScoringSystem,
): EnrichedPlayer[] {
  const used = new Set<string>();
  const lineup: EnrichedPlayer[] = [];

  // First: hard positions
  for (const slot of slots) {
    if (
      slot === "FLEX" ||
      slot === "SUPER_FLEX" ||
      slot === "BN" ||
      slot === "IR" ||
      slot === "TAXI"
    )
      continue;
    if (!FANTASY_POSITIONS.has(slot)) continue;
    const best = pickBest(roster, used, [slot as FantasyPosition], scoring);
    if (best) {
      used.add(best.sleeperId);
      lineup.push(best);
    }
  }
  // Then FLEX
  for (const slot of slots) {
    if (slot === "FLEX") {
      const best = pickBest(roster, used, ["RB", "WR", "TE"], scoring);
      if (best) {
        used.add(best.sleeperId);
        lineup.push(best);
      }
    } else if (slot === "SUPER_FLEX") {
      const best = pickBest(roster, used, ["QB", "RB", "WR", "TE"], scoring);
      if (best) {
        used.add(best.sleeperId);
        lineup.push(best);
      }
    }
  }

  return lineup;
}

type TeamRow = {
  rosterId: number;
  ownerName: string;
  teamName: string;
  starters: EnrichedPlayer[];
  bench: EnrichedPlayer[];
  vegasFpts: number;
  vegasFptsPerWeek: number;
  /** Average age of starters with known age (informational) */
  avgAge: number | null;
  avgEspnAdp: number | null;
  avgFpAdp: number | null;
  avgCouncilRank: number | null;
  coverage: { matched: number; total: number };
};

export default async function LeagueAnalysisPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const scoring: ScoringSystem = "PPR"; // v1: hardcode PPR; toggle comes later

  let league, users, rosters, allPlayers, projections, adp, councilLookup;
  try {
    [league, users, rosters, allPlayers, projections, adp, councilLookup] =
      await Promise.all([
        fetchLeague(leagueId),
        fetchLeagueUsers(leagueId),
        fetchLeagueRosters(leagueId),
        fetchAllPlayers(),
        loadProjections(),
        loadAdpLookups(scoring),
        loadCouncilLookup(scoring),
      ]);
  } catch (err) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-rose-200">
              Couldn&apos;t load that league
            </h2>
            <p className="mt-2 text-sm text-rose-200/80">
              {err instanceof Error ? err.message : String(err)}
            </p>
            <Link
              href="/league"
              className="mt-4 inline-block text-xs underline-offset-4 hover:underline"
            >
              ← Try again
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Build matchers
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

  // Enrich each roster's players
  const teamRows: TeamRow[] = [];
  for (const roster of rosters) {
    const playerIds = roster.players ?? [];
    const enriched: EnrichedPlayer[] = playerIds.map((sid) => {
      const sp = allPlayers[sid];
      if (!sp) {
        return {
          sleeperId: sid,
          sleeperName: `#${sid}`,
          team: null,
          position: null,
          age: null,
          projection: null,
          espnAdp: null,
          espnRank: null,
          fpAdp: null,
          councilRank: null,
        };
      }
      const name = sp.full_name || `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
      const position = classifyPosition(sp.position);
      const match = matcher.match({ name, team: sp.team });
      const projection = match.matched
        ? (projectionById.get(match.playerId) ?? null)
        : null;
      const playerId = projection?.playerId ?? null;
      // Age is kept as informational context (injury-risk signal). It does
      // NOT drive any ranking math — we're a redraft product and our futures
      // are single-season.
      const age =
        ageFromBirthDate(sp.birth_date) ?? (typeof sp.age === "number" ? sp.age : null);
      return {
        sleeperId: sid,
        sleeperName: name,
        team: sp.team,
        position,
        age,
        projection,
        espnAdp: playerId != null ? (adp.espnAdp.get(playerId) ?? null) : null,
        espnRank: playerId != null ? (adp.espnRank.get(playerId) ?? null) : null,
        fpAdp: playerId != null ? (adp.fpAdp.get(playerId) ?? null) : null,
        councilRank:
          playerId != null ? (councilLookup.get(playerId) ?? null) : null,
      };
    });

    const starters = buildOptimalLineup(enriched, league.roster_positions, scoring);
    const starterIds = new Set(starters.map((p) => p.sleeperId));
    const bench = enriched.filter((p) => !starterIds.has(p.sleeperId));

    const vegasFpts = starters.reduce(
      (sum, p) => sum + (p.projection?.fantasyPoints[scoring] ?? 0),
      0,
    );

    const avgOf = (
      players: EnrichedPlayer[],
      pick: (p: EnrichedPlayer) => number | null,
    ): number | null => {
      const vals = players.map(pick).filter((v): v is number => v != null);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const owner = roster.owner_id ? userById.get(roster.owner_id) : null;
    const matched = enriched.filter((p) => p.projection != null).length;

    const startersWithAge = starters.filter(
      (p): p is EnrichedPlayer & { age: number } => p.age != null,
    );
    const avgAge =
      startersWithAge.length > 0
        ? startersWithAge.reduce((s, p) => s + p.age, 0) /
          startersWithAge.length
        : null;

    teamRows.push({
      rosterId: roster.roster_id,
      ownerName: owner?.display_name ?? `Roster ${roster.roster_id}`,
      teamName: owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`,
      starters,
      bench,
      vegasFpts,
      vegasFptsPerWeek: vegasFpts / 17,
      avgAge,
      avgEspnAdp: avgOf(starters, (p) => p.espnAdp),
      avgFpAdp: avgOf(starters, (p) => p.fpAdp),
      avgCouncilRank: avgOf(starters, (p) => p.councilRank),
      coverage: { matched, total: enriched.length },
    });
  }

  // Sort by Vegas FPts descending → that's the FF Council power ranking
  teamRows.sort((a, b) => b.vegasFpts - a.vegasFpts);

  // ===== Position strength matrix =====
  // For each team × position, sum the top-N players' Vegas FPts.
  // Captures depth (e.g. an RB1+RB2 worth 600 fpts is a stronger room than
  // a single 350-fpt RB1 with nothing behind).
  const POSITION_DEPTH: Record<FantasyPosition, number> = {
    QB: 2,
    RB: 4,
    WR: 5,
    TE: 2,
  };
  type PositionStrength = {
    rosterId: number;
    teamName: string;
    ownerName: string;
    scores: Record<FantasyPosition, number>;
  };
  const positionStrength: PositionStrength[] = teamRows.map((t) => {
    const all = [...t.starters, ...t.bench];
    const score = (pos: FantasyPosition): number => {
      const sorted = all
        .filter((p) => p.position === pos)
        .sort(
          (a, b) =>
            (b.projection?.fantasyPoints[scoring] ?? 0) -
            (a.projection?.fantasyPoints[scoring] ?? 0),
        )
        .slice(0, POSITION_DEPTH[pos]);
      return sorted.reduce(
        (sum, p) => sum + (p.projection?.fantasyPoints[scoring] ?? 0),
        0,
      );
    };
    return {
      rosterId: t.rosterId,
      teamName: t.teamName,
      ownerName: t.ownerName,
      scores: { QB: score("QB"), RB: score("RB"), WR: score("WR"), TE: score("TE") },
    };
  });

  // For coloring: per position, find min/max so we can render relative strength.
  const positionMinMax: Record<FantasyPosition, { min: number; max: number }> = {
    QB: { min: Infinity, max: -Infinity },
    RB: { min: Infinity, max: -Infinity },
    WR: { min: Infinity, max: -Infinity },
    TE: { min: Infinity, max: -Infinity },
  };
  for (const t of positionStrength) {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      const v = t.scores[pos];
      if (v < positionMinMax[pos].min) positionMinMax[pos].min = v;
      if (v > positionMinMax[pos].max) positionMinMax[pos].max = v;
    }
  }

  // ===== Free agents =====
  // Our 80-player pool minus everyone rostered. Top 20 by Vegas FPts.
  const rosteredPlayerIds = new Set<number>();
  for (const team of teamRows) {
    for (const p of [...team.starters, ...team.bench]) {
      if (p.projection) rosteredPlayerIds.add(p.projection.playerId);
    }
  }
  const freeAgents = projections
    .filter((p) => !rosteredPlayerIds.has(p.playerId))
    .sort((a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring])
    .slice(0, 20);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">

        <div className="mb-4 flex flex-col gap-2 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-0">
          <div>
            <h2 className="text-xl font-semibold sm:text-2xl">{league.name}</h2>
            <p className="text-sm text-zinc-400">
              {league.season} · {teamRows.length} teams · scoring{" "}
              <span className="text-zinc-200">{scoring}</span>
            </p>
          </div>
          <Link
            href="/league"
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← Different league
          </Link>
        </div>

        {/* Power rankings table */}
        <div className="mb-8 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="w-10 py-3 pl-2 text-right sm:w-12 sm:pl-4">#</th>
                <th className="py-3 pl-2 sm:pl-4">Team</th>
                <th className="hidden py-3 pl-2 sm:table-cell">Owner</th>
                <th
                  className="py-3 pr-2 text-right sm:pr-4"
                  title="Sum of optimal-lineup Vegas FPts (season)"
                >
                  Vegas
                </th>
                <th className="hidden py-3 pr-4 text-right text-zinc-600 sm:table-cell">/wk</th>
                <th
                  className="hidden py-3 pr-4 text-right sm:table-cell"
                  title="Average age of optimal starters — informational, not a ranking factor"
                >
                  Avg Age
                </th>
                <th
                  className="hidden py-3 pr-4 text-right sm:table-cell"
                  title="Average ESPN ADP across starters"
                >
                  <span className="text-rose-300">ESPN</span> avg
                </th>
                <th
                  className="hidden py-3 pr-4 text-right sm:table-cell"
                  title="Average FantasyPros ADP across starters"
                >
                  <span className="text-sky-300">FP</span> avg
                </th>
                <th
                  className="hidden py-3 pr-4 text-right sm:table-cell"
                  title="Average Council Consensus rank across starters"
                >
                  <span className="text-emerald-300">Council</span> avg
                </th>
                <th
                  className="hidden py-3 pr-4 text-right sm:table-cell"
                  title="How many of the team's players we have rankings for"
                >
                  Cov
                </th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((t, idx) => (
                <tr
                  key={t.rosterId}
                  className="border-t border-zinc-800/60"
                >
                  <td className="py-3 pl-2 text-right font-mono text-zinc-500 sm:pl-4">
                    {idx + 1}
                  </td>
                  <td className="py-3 pl-2 font-medium sm:pl-4">{t.teamName}</td>
                  <td className="hidden py-3 pl-2 text-zinc-400 sm:table-cell">{t.ownerName}</td>
                  <td className="py-3 pr-2 text-right font-mono font-semibold tabular-nums sm:pr-4">
                    {t.vegasFpts.toFixed(1)}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-500 sm:table-cell">
                    {t.vegasFptsPerWeek.toFixed(1)}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-400 sm:table-cell">
                    {t.avgAge != null ? t.avgAge.toFixed(1) : "—"}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-300 sm:table-cell">
                    {t.avgEspnAdp != null ? t.avgEspnAdp.toFixed(1) : "—"}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-300 sm:table-cell">
                    {t.avgFpAdp != null ? t.avgFpAdp.toFixed(1) : "—"}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-300 sm:table-cell">
                    {t.avgCouncilRank != null
                      ? t.avgCouncilRank.toFixed(1)
                      : "—"}
                  </td>
                  <td className="hidden py-3 pr-4 text-right font-mono text-xs tabular-nums text-zinc-500 sm:table-cell">
                    {t.coverage.matched}/{t.coverage.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Position strength matrix */}
        <div className="mb-8">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Position Strength
            </h3>
            <p className="text-xs text-zinc-500 sm:max-w-md sm:text-right">
              Each cell: sum of top players&apos; Vegas FPts at that position
              (QB×2, RB×4, WR×5, TE×2). Color shows relative strength within
              the league.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="py-3 pl-2 sm:pl-4">Team</th>
                  <th className="py-3 pr-2 text-right sm:pr-4">
                    <span className="text-rose-300">QB</span>
                  </th>
                  <th className="py-3 pr-2 text-right sm:pr-4">
                    <span className="text-emerald-300">RB</span>
                  </th>
                  <th className="py-3 pr-2 text-right sm:pr-4">
                    <span className="text-sky-300">WR</span>
                  </th>
                  <th className="py-3 pr-2 text-right sm:pr-4">
                    <span className="text-amber-300">TE</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {positionStrength.map((t) => (
                  <tr
                    key={t.rosterId}
                    className="border-t border-zinc-800/60"
                  >
                    <td className="py-2.5 pl-2 sm:pl-4">
                      <div className="font-medium text-zinc-100">
                        {t.teamName}
                      </div>
                      <div className="text-xs text-zinc-500">{t.ownerName}</div>
                    </td>
                    {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
                      <PositionCell
                        key={pos}
                        value={t.scores[pos]}
                        min={positionMinMax[pos].min}
                        max={positionMinMax[pos].max}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Free Agents */}
        {freeAgents.length > 0 && (
          <div className="mb-8">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Top Free Agents
              </h3>
              <p className="text-xs text-zinc-500 sm:max-w-md sm:text-right">
                Players in our pool that aren&apos;t rostered in this league —
                sorted by Vegas FPts. Waiver targets ordered by our model.
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="w-8 py-3 pl-2 text-right sm:w-10 sm:pl-4">#</th>
                    <th className="py-3 pl-2 sm:pl-4">Player</th>
                    <th className="py-3 pl-2">Pos</th>
                    <th className="hidden py-3 pl-2 sm:table-cell">Team</th>
                    <th className="py-3 pr-2 text-right sm:pr-4">Vegas FPts</th>
                    <th className="hidden py-3 pr-4 text-right sm:table-cell">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {freeAgents.map((p, idx) => (
                    <tr key={p.playerId} className="border-t border-zinc-800/60">
                      <td className="py-2 pl-2 text-right font-mono text-zinc-500 sm:pl-4">
                        {idx + 1}
                      </td>
                      <td className="py-2 pl-2 font-medium sm:pl-4">{p.name}</td>
                      <td className="py-2 pl-2">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                        >
                          {p.position}
                        </span>
                      </td>
                      <td className="hidden py-2 pl-2 font-mono text-xs text-zinc-400 sm:table-cell">
                        {p.team}
                      </td>
                      <td className="py-2 pr-2 text-right font-mono font-semibold tabular-nums sm:pr-4">
                        {p.fantasyPoints[scoring].toFixed(1)}
                      </td>
                      <td className="hidden py-2 pr-4 text-right font-mono text-xs tabular-nums text-zinc-400 sm:table-cell">
                        {p.vbd[scoring] > 0 ? "+" : ""}
                        {p.vbd[scoring].toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Per-team rosters */}
        <div className="space-y-3">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Rosters
            </h3>
            <Link
              href={`/league/${leagueId}/compare`}
              className="text-xs text-emerald-300 underline-offset-4 hover:underline"
            >
              Compare two teams →
            </Link>
          </div>
          {/* placeholder marker */}
          {teamRows.map((t) => (
            <details
              key={t.rosterId}
              className="group rounded-lg border border-zinc-800 bg-zinc-900 open:bg-zinc-900/60"
            >
              <summary className="flex cursor-pointer flex-col gap-1 px-3 py-3 transition hover:bg-zinc-800/30 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{t.teamName}</span>
                  <span className="text-xs text-zinc-500">{t.ownerName}</span>
                </div>
                <span className="font-mono text-xs text-zinc-400 sm:ml-auto">
                  Vegas {t.vegasFpts.toFixed(1)} ·{" "}
                  {t.avgAge != null
                    ? `avg age ${t.avgAge.toFixed(1)}`
                    : "no age data"}{" "}
                  · coverage {t.coverage.matched}/{t.coverage.total}
                </span>
              </summary>
              <div className="px-3 pb-4 sm:px-4">
                <PlayerTable players={t.starters} label="Starters" scoring={scoring} />
                {t.bench.length > 0 && (
                  <PlayerTable players={t.bench} label="Bench" scoring={scoring} />
                )}
              </div>
            </details>
          ))}
        </div>

        <p className="mt-8 text-xs text-zinc-500">
          <span className="text-zinc-300">Vegas Score</span> = sum of optimal
          lineup Vegas season FPts. <span className="text-zinc-300">Avg
          ADP/Rank</span> columns average across each team&apos;s starters; lower
          is better. <span className="text-zinc-300">Coverage</span> shows how
          many of the team&apos;s rostered players we have data for — early in
          development our pool is 80 players, so smaller leagues / lower-tier
          rosters will show partial coverage.
        </p>
      </div>
    </main>
  );
}

function PositionCell({
  value,
  min,
  max,
}: {
  value: number;
  min: number;
  max: number;
}) {
  const range = max - min;
  const pct = range > 0 ? (value - min) / range : 0.5;
  // Green when near max, red when near min, neutral in between
  const className =
    pct >= 0.75
      ? "text-emerald-300"
      : pct >= 0.5
        ? "text-zinc-200"
        : pct >= 0.25
          ? "text-zinc-400"
          : "text-rose-300";
  return (
    <td className="py-2.5 pr-2 text-right font-mono font-semibold tabular-nums sm:pr-4">
      <span className={className}>{value.toFixed(1)}</span>
    </td>
  );
}

function PlayerTable({
  players,
  label,
  scoring,
}: {
  players: EnrichedPlayer[];
  label: string;
  scoring: ScoringSystem;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <table className="w-full text-xs">
        <thead className="text-zinc-600">
          <tr className="text-left">
            <th className="py-1">Player</th>
            <th className="py-1">Pos</th>
            <th className="hidden py-1 sm:table-cell">Team</th>
            <th className="hidden py-1 text-right sm:table-cell">Age</th>
            <th className="py-1 text-right">Vegas FPts</th>
            <th className="hidden py-1 text-right sm:table-cell">Edge</th>
            <th className="hidden py-1 text-right sm:table-cell">ESPN ADP</th>
            <th className="hidden py-1 text-right sm:table-cell">FP ADP</th>
            <th className="py-1 text-right">Council</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.sleeperId}
              className="border-t border-zinc-800/40"
            >
              <td className="py-1">
                <span
                  className={
                    p.projection ? "text-zinc-100" : "text-zinc-600"
                  }
                >
                  {p.sleeperName}
                </span>
              </td>
              <td className="py-1">
                {p.position && (
                  <span
                    className={`inline-flex rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                  >
                    {p.position}
                  </span>
                )}
                {!p.position && p.sleeperName !== `#${p.sleeperId}` && (
                  <span className="text-[10px] text-zinc-600">—</span>
                )}
              </td>
              <td className="hidden py-1 font-mono text-zinc-500 sm:table-cell">{p.team ?? "—"}</td>
              <td className="hidden py-1 text-right font-mono tabular-nums sm:table-cell">
                {p.age != null ? (
                  <span
                    className={
                      p.age < 25
                        ? "text-emerald-400"
                        : p.age >= 30
                          ? "text-rose-400"
                          : "text-zinc-400"
                    }
                  >
                    {p.age}
                  </span>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
              </td>
              <td className="py-1 text-right font-mono tabular-nums">
                {p.projection
                  ? p.projection.fantasyPoints[scoring].toFixed(1)
                  : "—"}
              </td>
              <td className="hidden py-1 text-right font-mono tabular-nums text-zinc-400 sm:table-cell">
                {p.projection ? p.projection.vbd[scoring].toFixed(1) : "—"}
              </td>
              <td className="hidden py-1 text-right font-mono tabular-nums text-zinc-400 sm:table-cell">
                {p.espnAdp != null ? p.espnAdp.toFixed(1) : "—"}
              </td>
              <td className="hidden py-1 text-right font-mono tabular-nums text-zinc-400 sm:table-cell">
                {p.fpAdp != null ? p.fpAdp.toFixed(1) : "—"}
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-zinc-400">
                {p.councilRank != null ? p.councilRank.toFixed(1) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
