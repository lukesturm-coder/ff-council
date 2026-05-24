import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import RadarChart from "@/app/_components/charts/RadarChart";
import SaveLeague from "../SaveLeague";

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

// League-relative letter grade from a 0-100 contender score.
function letterGrade(v: number): string {
  if (v >= 90) return "A+";
  if (v >= 82) return "A";
  if (v >= 73) return "A-";
  if (v >= 64) return "B";
  if (v >= 54) return "C";
  if (v >= 42) return "D";
  return "F";
}

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
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_rankings")
    .select("player_id, source, ranking_type, scoring_system, rank_value")
    .eq("scoring_system", scoring);
  const espnAdp = new Map<number, number>();
  const espnRank = new Map<number, number>();
  for (const r of (data ?? []) as PlatformRow[]) {
    const v = Number(r.rank_value);
    if (r.source === "espn") {
      if (r.ranking_type === "adp") espnAdp.set(r.player_id, v);
      else if (r.ranking_type === "editorial") espnRank.set(r.player_id, v);
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
  return { espnAdp, espnRank };
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
    // If Sleeper specifically returned 404, the league doesn't exist — surface
    // Next's not-found page instead of a "try again" panel. Other network
    // errors (rate limit, DNS, 500s) still render the retry panel.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("→ 404")) {
      notFound();
    }
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-rose-200">
              Couldn&apos;t load that league
            </h2>
            <p className="mt-2 text-sm text-rose-200/80">{msg}</p>
            <Link
              href="/league?change=1"
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

  // ===== Vegas rank map (global, all 80 projected players) =====
  // Used by the trade-opportunity scatter to compare Vegas rank vs Council rank.
  // Ranks players by Vegas FPts desc for the current scoring.
  const vegasRankById = new Map<number, number>();
  [...projections]
    .sort((a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring])
    .forEach((p, idx) => vegasRankById.set(p.playerId, idx + 1));

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

  // ===== Roster strength radars + contender scores =====
  // Each team gets a QB/RB/WR/TE/Depth radar (normalized to the league best on
  // each axis) and a 0-100 contender score (starter points vs the league best).
  const psById = new Map(positionStrength.map((p) => [p.rosterId, p]));
  const benchValueById = new Map<number, number>();
  for (const t of teamRows) {
    const bv = t.bench
      .map((p) => p.projection?.fantasyPoints[scoring] ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 6)
      .reduce((a, b) => a + b, 0);
    benchValueById.set(t.rosterId, bv);
  }
  const maxBench = Math.max(1, ...Array.from(benchValueById.values()));
  const maxFpts = Math.max(1, ...teamRows.map((t) => t.vegasFpts));
  const norm = (v: number, max: number) =>
    max > 0 ? Math.round((v / max) * 100) : 0;
  const TEAM_RADAR_COLORS = [
    "#2dd4bf", "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa",
    "#22d3ee", "#fb7185", "#5eead4", "#f59e0b", "#818cf8",
    "#4ade80", "#e879f9", "#38bdf8", "#facc15",
  ];
  const strengthCards = teamRows.map((t, i) => {
    const ps = psById.get(t.rosterId);
    const radar = [
      { label: "QB", value: norm(ps?.scores.QB ?? 0, positionMinMax.QB.max) },
      { label: "RB", value: norm(ps?.scores.RB ?? 0, positionMinMax.RB.max) },
      { label: "WR", value: norm(ps?.scores.WR ?? 0, positionMinMax.WR.max) },
      { label: "TE", value: norm(ps?.scores.TE ?? 0, positionMinMax.TE.max) },
      {
        label: "Depth",
        value: norm(benchValueById.get(t.rosterId) ?? 0, maxBench),
      },
    ];
    const posAxes = radar.slice(0, 4);
    const best = posAxes.reduce((a, b) => (b.value > a.value ? b : a));
    const worst = posAxes.reduce((a, b) => (b.value < a.value ? b : a));
    const contender = norm(t.vegasFpts, maxFpts);
    // Difference maker = the highest-projected starter on the roster.
    const topStarter = t.starters.reduce<EnrichedPlayer | null>(
      (bestP, p) =>
        (p.projection?.fantasyPoints[scoring] ?? 0) >
        (bestP?.projection?.fantasyPoints[scoring] ?? 0)
          ? p
          : bestP,
      null,
    );
    return {
      rosterId: t.rosterId,
      teamName: t.teamName,
      ownerName: t.ownerName,
      rank: i + 1,
      contender,
      grade: letterGrade(contender),
      differenceMaker: topStarter?.sleeperName ?? null,
      // #1 contender wears the brand green; the rest get a muted premium hue.
      color: i === 0 ? "#34d399" : TEAM_RADAR_COLORS[i % TEAM_RADAR_COLORS.length],
      radar,
      strength: best.label,
      weakness: worst.label,
    };
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <SaveLeague id={leagueId} />
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
            href="/league?change=1"
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← Different league
          </Link>
        </div>

        {/* Roster strength radars — each team's QB/RB/WR/TE/Depth shape + a
            contender score, all relative to the league. */}
        <section className="mb-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Roster strength
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {strengthCards.map((c) => (
              <div
                key={c.rosterId}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-base font-bold ring-1 ring-inset"
                      style={{ color: c.color, borderColor: `${c.color}55` }}
                    >
                      {c.grade}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-100">
                        {c.teamName}
                      </div>
                      <div className="truncate text-[11px] text-zinc-500">
                        {c.ownerName}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className="font-mono text-xl font-bold leading-none"
                      style={{ color: c.color }}
                    >
                      {c.contender}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
                      contender · #{c.rank}
                    </div>
                  </div>
                </div>
                <RadarChart
                  data={c.radar}
                  color={c.color}
                  className="mx-auto h-44 w-full"
                />
                <div className="mt-1 flex items-center justify-center gap-3 text-[11px]">
                  <span className="text-emerald-400">▲ {c.strength}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-rose-400">▼ {c.weakness}</span>
                </div>
                {c.differenceMaker && (
                  <div className="mt-1 truncate text-center text-[11px] text-zinc-500">
                    <span className="text-amber-300">★</span> {c.differenceMaker}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Positional heatmap — every team × position at a glance. Green =
            strong vs the league, red = weak. The shareable league-wide view. */}
        <section className="mb-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Positional heatmap
          </h3>
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="py-2 pl-3 text-left font-medium">Team</th>
                  {["QB", "RB", "WR", "TE", "Depth"].map((a) => (
                    <th key={a} className="px-2 py-2 text-center font-medium">
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {strengthCards.map((c) => (
                  <tr key={c.rosterId} className="border-t border-zinc-800/60">
                    <td className="max-w-[10rem] truncate py-1.5 pl-3 pr-2 text-zinc-200">
                      {c.teamName}
                    </td>
                    {c.radar.map((ax) => (
                      <td key={ax.label} className="px-1 py-1 text-center">
                        <span
                          className="inline-flex h-7 w-12 items-center justify-center rounded font-mono text-xs text-zinc-50"
                          style={{
                            backgroundColor: `hsl(${Math.round(ax.value * 1.2)} 48% ${20 + ax.value * 0.12}% / 0.9)`,
                          }}
                        >
                          {ax.value}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

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

        {/* ===== Visual analytics: power rankings, heatmap, scatter ===== */}
        {teamRows.length >= 4 ? (
          <>
            <PowerRankingsChart teams={teamRows} />
            <RosterHeatmap teams={teamRows} scoring={scoring} />
            <TradeOpportunityScatter teams={teamRows} vegasRankById={vegasRankById} />
          </>
        ) : (
          <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-400">
            League visualizations need at least 4 teams with projection data — this league has {teamRows.length}.
          </div>
        )}

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

// ===========================================================================
// Visual analytics components (pure inline SVG, no chart library)
// ===========================================================================

/**
 * Horizontal bar chart of each team's optimal-lineup Vegas FPts, sorted desc.
 * Color buckets: top third emerald, middle third amber, bottom third rose.
 * Responsive: stretches to container width. Bars sit at fixed pixel heights
 * so the chart looks the same at 375px and 1024px.
 */
function PowerRankingsChart({ teams }: { teams: TeamRow[] }) {
  const withProj = teams.filter((t) => t.vegasFpts > 0);
  if (withProj.length === 0) {
    return (
      <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-400">
        Power rankings unavailable — no Vegas projections matched any rosters.
      </div>
    );
  }
  const sorted = [...withProj].sort((a, b) => b.vegasFpts - a.vegasFpts);
  const max = sorted[0].vegasFpts;
  const n = sorted.length;
  // Bucket boundaries by rank position (top third, middle, bottom).
  const topCut = Math.ceil(n / 3);
  const midCut = Math.ceil((2 * n) / 3);
  const colorFor = (idx: number): string => {
    if (idx < topCut) return "#34d399"; // emerald-400
    if (idx < midCut) return "#fbbf24"; // amber-400
    return "#fb7185"; // rose-400
  };

  const ROW_H = 26;
  const ROW_GAP = 6;
  const BAR_H = 14;
  const LABEL_W = 90; // px reserved for team name on the left
  const VALUE_W = 56; // px reserved for value on the right
  const totalH = n * (ROW_H + ROW_GAP) - ROW_GAP;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Power rankings · Vegas baseline (PPR season FPts)
        </h3>
        <p className="text-xs text-zinc-500 sm:max-w-md sm:text-right">
          Sum of each team&apos;s optimal-lineup Vegas FPts. Emerald = top third,
          amber = middle, rose = bottom.
        </p>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
        <svg
          viewBox={`0 0 360 ${totalH}`}
          preserveAspectRatio="none"
          className="block h-auto w-full"
          style={{ height: totalH }}
          role="img"
          aria-label="Power rankings bar chart"
        >
          {sorted.map((t, idx) => {
            const y = idx * (ROW_H + ROW_GAP);
            const barX = LABEL_W;
            const barMaxW = 360 - LABEL_W - VALUE_W;
            const w = Math.max(2, (t.vegasFpts / max) * barMaxW);
            const fill = colorFor(idx);
            // Truncate team name visually if needed — SVG has no overflow:ellipsis
            const name =
              t.teamName.length > 13
                ? t.teamName.slice(0, 12) + "…"
                : t.teamName;
            return (
              <g key={t.rosterId}>
                <text
                  x={LABEL_W - 6}
                  y={y + ROW_H / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="#d4d4d8"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {name}
                </text>
                <rect
                  x={barX}
                  y={y + (ROW_H - BAR_H) / 2}
                  width={w}
                  height={BAR_H}
                  rx="2"
                  fill={fill}
                  fillOpacity="0.85"
                >
                  <title>{`${t.teamName} (${t.ownerName}) — ${t.vegasFpts.toFixed(1)} FPts`}</title>
                </rect>
                <text
                  x={barX + w + 4}
                  y={y + ROW_H / 2}
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="#a1a1aa"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {t.vegasFpts.toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/**
 * Heatmap grid: rows = teams, columns = QB / RB / WR / TE / FLEX.
 * Cell intensity = team's starter FPts at that slot, normalized within column.
 * Lerp from rose (weak) → zinc (mid) → emerald (strong). The tooltip shows
 * the actual starter name + FPts for that slot.
 */
function RosterHeatmap({
  teams,
  scoring,
}: {
  teams: TeamRow[];
  scoring: ScoringSystem;
}) {
  type SlotName = "QB" | "RB" | "WR" | "TE" | "FLEX";
  const SLOTS: readonly SlotName[] = ["QB", "RB", "WR", "TE", "FLEX"];

  // Build per-team, per-slot { fpts, name } cells. FLEX = the starter slot the
  // optimal-lineup builder assigned to FLEX (best RB/WR/TE after hard slots).
  type Cell = { fpts: number; name: string | null };
  type RowData = { teamName: string; ownerName: string; cells: Record<SlotName, Cell> };

  const rows: RowData[] = teams.map((t) => {
    const cells: Record<SlotName, Cell> = {
      QB: { fpts: 0, name: null },
      RB: { fpts: 0, name: null },
      WR: { fpts: 0, name: null },
      TE: { fpts: 0, name: null },
      FLEX: { fpts: 0, name: null },
    };
    // Walk starters; first time we see each hard position, that's the cell.
    // The "extra" RB/WR/TE beyond the hard slot count goes into FLEX.
    const hardFilled: Record<"QB" | "RB" | "WR" | "TE", boolean> = {
      QB: false,
      RB: false,
      WR: false,
      TE: false,
    };
    for (const p of t.starters) {
      const pts = p.projection?.fantasyPoints[scoring] ?? 0;
      const pos = p.position;
      if (!pos) continue;
      if (!hardFilled[pos]) {
        cells[pos] = { fpts: pts, name: p.sleeperName };
        hardFilled[pos] = true;
      } else if (cells.FLEX.fpts === 0 && (pos === "RB" || pos === "WR" || pos === "TE")) {
        cells.FLEX = { fpts: pts, name: p.sleeperName };
      }
    }
    return { teamName: t.teamName, ownerName: t.ownerName, cells };
  });

  // Per-column min/max for normalization.
  const colStats: Record<SlotName, { min: number; max: number }> = {
    QB: { min: Infinity, max: -Infinity },
    RB: { min: Infinity, max: -Infinity },
    WR: { min: Infinity, max: -Infinity },
    TE: { min: Infinity, max: -Infinity },
    FLEX: { min: Infinity, max: -Infinity },
  };
  for (const r of rows) {
    for (const s of SLOTS) {
      const v = r.cells[s].fpts;
      if (v > 0) {
        if (v < colStats[s].min) colStats[s].min = v;
        if (v > colStats[s].max) colStats[s].max = v;
      }
    }
  }

  const colorFor = (slot: SlotName, v: number): string => {
    if (v <= 0) return "#27272a"; // zinc-800 (empty)
    const { min, max } = colStats[slot];
    const range = max - min;
    const pct = range > 0 ? (v - min) / range : 0.5;
    // Lerp through three stops: rose-500 → zinc-700 → emerald-500.
    // We blend two stops based on whether pct is <0.5 or >=0.5.
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const rgb = (r: number, g: number, b: number) =>
      `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
    const rose = [244, 63, 94]; // rose-500
    const mid = [63, 63, 70]; // zinc-700
    const emerald = [16, 185, 129]; // emerald-500
    if (pct < 0.5) {
      const t = pct / 0.5;
      return rgb(
        lerp(rose[0], mid[0], t),
        lerp(rose[1], mid[1], t),
        lerp(rose[2], mid[2], t),
      );
    }
    const t = (pct - 0.5) / 0.5;
    return rgb(
      lerp(mid[0], emerald[0], t),
      lerp(mid[1], emerald[1], t),
      lerp(mid[2], emerald[2], t),
    );
  };

  const hasAnyData = rows.some((r) =>
    SLOTS.some((s) => r.cells[s].fpts > 0),
  );
  if (!hasAnyData) {
    return (
      <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-400">
        Roster strength heatmap unavailable — no starter projections matched.
      </div>
    );
  }

  // Layout: label column (left) + 5 cells. Sized for 375px viewport.
  const LABEL_W = 96;
  const CELL_W = 44;
  const CELL_H = 30;
  const CELL_GAP = 3;
  const HEADER_H = 22;
  const totalW = LABEL_W + SLOTS.length * (CELL_W + CELL_GAP) - CELL_GAP;
  const totalH = HEADER_H + rows.length * (CELL_H + CELL_GAP) - CELL_GAP;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Roster strength by position
        </h3>
        <p className="text-xs text-zinc-500 sm:max-w-md sm:text-right">
          Each cell is that team&apos;s starter at the slot, colored by FPts
          relative to the league. Emerald = strong, rose = weak.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          width={totalW}
          height={totalH}
          className="block max-w-full"
          role="img"
          aria-label="Roster strength heatmap"
        >
          {/* Column headers */}
          {SLOTS.map((slot, i) => (
            <text
              key={slot}
              x={LABEL_W + i * (CELL_W + CELL_GAP) + CELL_W / 2}
              y={HEADER_H - 6}
              textAnchor="middle"
              fontSize="11"
              fill="#a1a1aa"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {slot}
            </text>
          ))}
          {/* Row labels + cells */}
          {rows.map((r, rowIdx) => {
            const y = HEADER_H + rowIdx * (CELL_H + CELL_GAP);
            const label =
              r.teamName.length > 14
                ? r.teamName.slice(0, 13) + "…"
                : r.teamName;
            return (
              <g key={`${r.teamName}-${rowIdx}`}>
                <text
                  x={LABEL_W - 6}
                  y={y + CELL_H / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="#d4d4d8"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {label}
                </text>
                {SLOTS.map((slot, colIdx) => {
                  const cell = r.cells[slot];
                  const x = LABEL_W + colIdx * (CELL_W + CELL_GAP);
                  const fill = colorFor(slot, cell.fpts);
                  const tooltip =
                    cell.name != null
                      ? `${slot} — ${cell.name}: ${cell.fpts.toFixed(1)} FPts`
                      : `${slot} — no starter`;
                  return (
                    <g key={slot}>
                      <rect
                        x={x}
                        y={y}
                        width={CELL_W}
                        height={CELL_H}
                        rx="3"
                        fill={fill}
                        fillOpacity={cell.fpts > 0 ? 0.85 : 0.4}
                      >
                        <title>{tooltip}</title>
                      </rect>
                      {cell.fpts > 0 && (
                        <text
                          x={x + CELL_W / 2}
                          y={y + CELL_H / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="10"
                          fill="#fafafa"
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                          pointerEvents="none"
                        >
                          {cell.fpts.toFixed(0)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/**
 * Scatter: X = Vegas rank, Y = Council rank. Points off the diagonal are
 * trade opportunities (Vegas and consensus disagree). Color by position.
 * Top 10 disagreements get an initials label so the chart is readable at 280px.
 */
function TradeOpportunityScatter({
  teams,
  vegasRankById,
}: {
  teams: TeamRow[];
  vegasRankById: Map<number, number>;
}) {
  type Point = {
    playerId: number;
    name: string;
    position: FantasyPosition;
    vegasRank: number;
    councilRank: number;
    disagreement: number;
  };

  const seen = new Set<number>();
  const points: Point[] = [];
  for (const t of teams) {
    for (const p of [...t.starters, ...t.bench]) {
      const pid = p.projection?.playerId;
      if (pid == null) continue;
      if (seen.has(pid)) continue;
      const vr = vegasRankById.get(pid);
      const cr = p.councilRank;
      if (vr == null || cr == null) continue;
      if (!p.position) continue;
      seen.add(pid);
      points.push({
        playerId: pid,
        name: p.sleeperName,
        position: p.position,
        vegasRank: vr,
        councilRank: cr,
        disagreement: Math.abs(vr - cr),
      });
    }
  }

  if (points.length < 3) {
    return (
      <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-400">
        Trade opportunities unavailable — need both Vegas and Council ranks for
        rostered players (have {points.length} matched).
      </div>
    );
  }

  // Scale: both axes share the same range so the diagonal stays at 45°.
  const maxRank = Math.max(
    ...points.map((p) => Math.max(p.vegasRank, p.councilRank)),
  );

  const W = 280;
  const H = 240;
  const PAD_L = 32;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const denom = maxRank > 1 ? maxRank - 1 : 1;
  const xFor = (rank: number) => PAD_L + ((rank - 1) / denom) * plotW;
  const yFor = (rank: number) => PAD_T + ((rank - 1) / denom) * plotH;

  const colorFor = (pos: FantasyPosition): string => {
    // Match the position chip palette used elsewhere.
    switch (pos) {
      case "QB":
        return "#fb7185"; // rose-400
      case "RB":
        return "#34d399"; // emerald-400
      case "WR":
        return "#38bdf8"; // sky-400
      case "TE":
        return "#fbbf24"; // amber-400
    }
  };

  const initials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Top 10 disagreement points get labels.
  const labelled = new Set(
    [...points]
      .sort((a, b) => b.disagreement - a.disagreement)
      .slice(0, 10)
      .map((p) => p.playerId),
  );

  // Gridline rank ticks: every ~10 ranks, capped at 5 ticks.
  const tickStep = Math.max(5, Math.ceil(maxRank / 5));
  const ticks: number[] = [];
  for (let r = 1; r <= maxRank; r += tickStep) ticks.push(r);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Trade opportunities · where Vegas and consensus disagree
        </h3>
        <p className="text-xs text-zinc-500 sm:max-w-md sm:text-right">
          Points far from the diagonal mean the two rank sources disagree —
          sell-high or buy-low candidates.
        </p>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block max-w-full"
            role="img"
            aria-label="Trade opportunity scatter plot"
          >
            {/* Plot border */}
            <rect
              x={PAD_L}
              y={PAD_T}
              width={plotW}
              height={plotH}
              fill="#09090b"
              stroke="#3f3f46"
              strokeWidth="0.5"
            />
            {/* Gridlines + tick labels */}
            {ticks.map((r) => (
              <g key={`tick-${r}`}>
                <line
                  x1={xFor(r)}
                  y1={PAD_T}
                  x2={xFor(r)}
                  y2={PAD_T + plotH}
                  stroke="#27272a"
                  strokeWidth="0.5"
                />
                <line
                  x1={PAD_L}
                  y1={yFor(r)}
                  x2={PAD_L + plotW}
                  y2={yFor(r)}
                  stroke="#27272a"
                  strokeWidth="0.5"
                />
                <text
                  x={xFor(r)}
                  y={H - PAD_B + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#71717a"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {r}
                </text>
                <text
                  x={PAD_L - 4}
                  y={yFor(r)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="9"
                  fill="#71717a"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {r}
                </text>
              </g>
            ))}
            {/* Diagonal of agreement */}
            <line
              x1={xFor(1)}
              y1={yFor(1)}
              x2={xFor(maxRank)}
              y2={yFor(maxRank)}
              stroke="#52525b"
              strokeWidth="0.5"
              strokeDasharray="3,3"
            />
            {/* Axis titles */}
            <text
              x={PAD_L + plotW / 2}
              y={H - 4}
              textAnchor="middle"
              fontSize="10"
              fill="#a1a1aa"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              Vegas rank →
            </text>
            <text
              x={10}
              y={PAD_T + plotH / 2}
              textAnchor="middle"
              fontSize="10"
              fill="#a1a1aa"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              transform={`rotate(-90 10 ${PAD_T + plotH / 2})`}
            >
              Council rank →
            </text>
            {/* Points */}
            {points.map((p) => {
              const cx = xFor(p.vegasRank);
              const cy = yFor(p.councilRank);
              const show = labelled.has(p.playerId);
              return (
                <g key={p.playerId}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={show ? 3.5 : 2.5}
                    fill={colorFor(p.position)}
                    fillOpacity={show ? 0.95 : 0.6}
                    stroke={show ? "#fafafa" : "none"}
                    strokeWidth={show ? 0.5 : 0}
                  >
                    <title>{`${p.name} (${p.position}) — Vegas ${p.vegasRank} / Council ${p.councilRank.toFixed(1)} · Δ ${p.disagreement.toFixed(1)}`}</title>
                  </circle>
                  {show && (
                    <text
                      x={cx + 5}
                      y={cy - 4}
                      fontSize="8.5"
                      fill="#e4e4e7"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                      pointerEvents="none"
                    >
                      {initials(p.name)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400 sm:flex-col sm:gap-y-1.5">
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <div key={pos} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: colorFor(pos) }}
                  aria-hidden="true"
                />
                <span>{pos}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
