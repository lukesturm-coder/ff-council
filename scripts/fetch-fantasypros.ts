/**
 * Fetch FantasyPros consensus rankings (ECR) for PPR / Half / Standard scoring,
 * match players to our SportsDataIO IDs, and upsert into platform_rankings.
 *
 *   npx tsx scripts/fetch-fantasypros.ts
 *
 * FantasyPros has an undocumented public JSON API at
 *   https://api.fantasypros.com/public/v2/json/nfl/{year}/consensus-rankings
 * but it requires an x-api-key header (returns 403 MissingAuthenticationToken
 * with just Referer/Origin). The cheatsheets pages embed the same JSON payload
 * server-side as a `var ecrData = {...}` literal, so we extract that. Each
 * scoring system has its own page; swap the URL slug.
 *
 * ecrData shape (relevant fields):
 *   - year, scoring ("PPR" | "HALF" | "STD"), count, total_experts
 *   - players[]:
 *       player_id, player_name, player_team_id, player_position_id,
 *       rank_ecr, rank_min, rank_max, rank_ave, rank_std
 *
 * We use rank_ecr (expert consensus rank) as the editorial rank value.
 * No ADP endpoint is wired here — FP's free ADP table is a separate scrape
 * already covered by the previous version of this script; ECR is the more
 * useful signal for our consensus view.
 */
import { config } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PlayerMatcher, type RosterPlayer } from "@/lib/player-matching";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing Supabase env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ScoringSystem = "PPR" | "Half" | "Standard";

const PAGES: { url: string; scoring: ScoringSystem }[] = [
  {
    url: "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
    scoring: "PPR",
  },
  {
    url: "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php",
    scoring: "Half",
  },
  {
    url: "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php",
    scoring: "Standard",
  },
];

// FP uses JAC; our roster uses JAX. All other 31 teams match.
const TEAM_ALIAS: Record<string, string> = {
  JAC: "JAX",
};

type FpPlayer = {
  player_id: number;
  player_name: string;
  player_team_id: string;
  player_position_id: string;
  rank_ecr: number;
  rank_ave?: string | number;
  rank_std?: string | number;
};

type EcrData = {
  sport: string;
  year: string;
  scoring: string;
  count: number;
  total_experts?: number;
  players: FpPlayer[];
};

type ParsedRow = {
  playerId: number;
  rankingType: "editorial";
  scoringSystem: ScoringSystem;
  rankValue: number;
  playerName: string;
  playerTeam: string;
};

type UnmappedRow = {
  rankingType: "editorial";
  scoringSystem: ScoringSystem;
  rankValue: number;
  rawName: string;
  rawTeam: string | null;
};

async function fetchEcrData(url: string): Promise<EcrData> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const html = await res.text();
  // The embedded literal looks like: `var ecrData = {...};` followed by a newline.
  // We need the outermost balanced braces — `.*?` is too greedy/non-greedy depending
  // on what follows, so we walk braces explicitly.
  const start = html.indexOf("var ecrData = {");
  if (start === -1) throw new Error(`ecrData not found in ${url}`);
  const objStart = html.indexOf("{", start);
  let depth = 0;
  let inStr = false;
  let strCh = "";
  let escape = false;
  let end = -1;
  for (let i = objStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === strCh) {
        inStr = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`ecrData braces unbalanced in ${url}`);
  const json = html.slice(objStart, end + 1);
  return JSON.parse(json) as EcrData;
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

function parseEcr(
  ecr: EcrData,
  scoring: ScoringSystem,
  matcher: PlayerMatcher,
): {
  matched: ParsedRow[];
  unmapped: UnmappedRow[];
  matchStats: Record<string, number>;
} {
  const matched: ParsedRow[] = [];
  const unmapped: UnmappedRow[] = [];
  const matchStats: Record<string, number> = {
    exact: 0,
    name_only: 0,
    lastname_team: 0,
    unmapped: 0,
    skipped_no_rank: 0,
    dropped_dup: 0,
  };

  const CONFIDENCE_RANK: Record<string, number> = {
    exact: 3,
    name_only: 2,
    lastname_team: 1,
  };

  type Candidate = {
    fp: FpPlayer;
    name: string;
    team: string | null;
    rank: number;
  };

  const candidates: Candidate[] = [];
  for (const p of ecr.players) {
    if (!p.player_name) continue;
    if (!Number.isFinite(p.rank_ecr) || p.rank_ecr <= 0) {
      matchStats.skipped_no_rank++;
      continue;
    }
    const rawTeam = p.player_team_id?.toUpperCase() ?? "";
    const team = rawTeam && rawTeam !== "FA" ? (TEAM_ALIAS[rawTeam] ?? rawTeam) : null;
    candidates.push({ fp: p, name: p.player_name, team, rank: p.rank_ecr });
  }

  const winnerByPlayerId = new Map<
    number,
    { candidate: Candidate; confidence: string }
  >();

  for (const c of candidates) {
    const m = matcher.match({ name: c.name, team: c.team });
    if (!m.matched) {
      unmapped.push({
        rankingType: "editorial",
        scoringSystem: scoring,
        rankValue: c.rank,
        rawName: c.name,
        rawTeam: c.team,
      });
      matchStats.unmapped++;
      continue;
    }
    matchStats[m.confidence]++;
    const existing = winnerByPlayerId.get(m.playerId);
    if (
      !existing ||
      (CONFIDENCE_RANK[m.confidence] ?? 0) >
        (CONFIDENCE_RANK[existing.confidence] ?? 0)
    ) {
      if (existing) matchStats.dropped_dup++;
      winnerByPlayerId.set(m.playerId, { candidate: c, confidence: m.confidence });
    } else {
      matchStats.dropped_dup++;
    }
  }

  for (const [playerId, { candidate: c }] of Array.from(winnerByPlayerId.entries())) {
    matched.push({
      playerId,
      rankingType: "editorial",
      scoringSystem: scoring,
      rankValue: c.rank,
      playerName: c.name,
      playerTeam: c.team ?? "",
    });
  }

  return { matched, unmapped, matchStats };
}

async function upsertRows(rows: ParsedRow[]) {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      player_id: r.playerId,
      source: "fantasypros",
      ranking_type: r.rankingType,
      scoring_system: r.scoringSystem,
      rank_value: r.rankValue,
      player_name: r.playerName,
      player_team: r.playerTeam,
    }));
    const { error } = await supabase
      .from("platform_rankings")
      .upsert(chunk, {
        onConflict: "player_id,source,ranking_type,scoring_system",
      });
    if (error) throw new Error(`upsert failed: ${error.message}`);
  }
}

async function logUnmapped(rows: UnmappedRow[]) {
  // Wipe FP's previous unmapped batch so the table doesn't grow unbounded.
  await supabase
    .from("platform_rankings_unmapped")
    .delete()
    .eq("source", "fantasypros");
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      source: "fantasypros",
      ranking_type: r.rankingType,
      scoring_system: r.scoringSystem,
      rank_value: r.rankValue,
      raw_name: r.rawName,
      raw_team: r.rawTeam,
    }));
    await supabase.from("platform_rankings_unmapped").insert(chunk);
  }
}

async function main() {
  const roster = await loadRoster();
  console.log(`→ Loaded local roster: ${roster.length} players`);
  const matcher = new PlayerMatcher(roster);

  const allMatched: ParsedRow[] = [];
  const allUnmapped: UnmappedRow[] = [];

  for (const { url, scoring } of PAGES) {
    console.log(`\n→ Fetching FP ${scoring}: ${url}`);
    let ecr: EcrData;
    try {
      ecr = await fetchEcrData(url);
    } catch (err) {
      console.log(
        `  failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    console.log(
      `  ecrData: year=${ecr.year} scoring=${ecr.scoring} count=${ecr.count} experts=${ecr.total_experts ?? "?"}`,
    );

    const { matched, unmapped, matchStats } = parseEcr(ecr, scoring, matcher);
    console.log(`  Match stats: ${JSON.stringify(matchStats)}`);
    console.log(`  matched ${matched.length} unique players`);
    console.log(`  unmapped ${unmapped.length} rows`);
    allMatched.push(...matched);
    allUnmapped.push(...unmapped);

    // Be polite — FP isn't paying us to scrape.
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n→ Upserting ${allMatched.length} rows to platform_rankings…`);
  await upsertRows(allMatched);
  console.log(`  ✓ Upserted`);

  console.log(`→ Logging ${allUnmapped.length} unmapped rows…`);
  await logUnmapped(allUnmapped);
  console.log(`  ✓ Logged`);

  console.log("\n✅ FantasyPros sync complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
