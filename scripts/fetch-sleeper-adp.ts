/**
 * Fetch Sleeper ADP (real aggregated draft consensus from millions of Sleeper
 * drafts), map players to our SportsDataIO IDs, and upsert into
 * platform_rankings.
 *
 *   npx tsx scripts/fetch-sleeper-adp.ts [season]
 *
 * Endpoint discovery:
 *   The Sleeper web app (sleeper.com) does NOT expose ADP via the documented
 *   REST or undocumented GraphQL APIs. The schema at api.sleeper.app/graphql
 *   has no `adp` / `get_adp` field. Instead, the draft UI calls an
 *   undocumented but unauthenticated REST endpoint shaped like:
 *
 *     GET https://api.sleeper.app/players/{sport}/adp_csv/{seasonType}/{season}
 *
 *   Discovered by grepping the production JS chunks served from
 *   sleepercdn.com/sleeper-web/_next/... — the FetchClient's `getAdpCsv`
 *   method targets exactly this path.
 *
 * Response is CSV, one row per player. Columns:
 *   player_id, player, team, position, sportradar_id,
 *   std, ppr, half_ppr, 2qb, idp, idp_1qb,
 *   dynasty_ppr, dynasty_half_ppr, dynasty_std, dynasty_2qb
 *
 * Each scoring column is a float ADP position (lower = drafted earlier).
 * Empty cell = no consensus / not drafted in that format.
 *
 * We pull `std`, `ppr`, `half_ppr` → scoring_system in {Standard, PPR, Half}.
 * Sleeper IDs are strings (e.g. "7564" = Ja'Marr Chase). To resolve display
 * names + teams cleanly we also fetch /v1/players/nfl (~14MB JSON).
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

const SLEEPER_BASE = "https://api.sleeper.app";

type SleeperPlayer = {
  player_id: string;
  full_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  team?: string | null;
  position?: string | null;
};

type AdpCsvRow = {
  player_id: string;
  player: string;
  team: string;
  position: string;
  std?: number;
  ppr?: number;
  half_ppr?: number;
};

type ScoringKey = "Standard" | "PPR" | "Half";

const SCORING_COLUMNS: { col: keyof AdpCsvRow; scoring: ScoringKey }[] = [
  { col: "std", scoring: "Standard" },
  { col: "ppr", scoring: "PPR" },
  { col: "half_ppr", scoring: "Half" },
];

/**
 * Minimal CSV parser. Sleeper's CSV is well-formed (quoted strings only when
 * the value contains a comma) and small enough that a one-pass split is fine.
 * We still handle quoted commas + escaped quotes so a future fix to the source
 * doesn't break us.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  // Trailing field/row (no final newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchAdpCsv(season: number): Promise<AdpCsvRow[]> {
  const url = `${SLEEPER_BASE}/players/nfl/adp_csv/regular/${season}`;
  const res = await fetch(url, {
    headers: {
      Accept: "text/csv,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`Sleeper ADP ${season} → ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  const parsed = parseCsv(text);
  if (parsed.length < 2) {
    throw new Error(`Sleeper ADP ${season}: empty CSV`);
  }
  const header = parsed[0];
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    idx[h.trim()] = i;
  });
  const required = ["player_id", "player", "team", "position", "std", "ppr", "half_ppr"];
  for (const r of required) {
    if (idx[r] == null) {
      throw new Error(`Sleeper ADP missing column "${r}". Columns: ${header.join(",")}`);
    }
  }

  const rows: AdpCsvRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const row = parsed[i];
    if (row.length < 4 || !row[idx.player_id]) continue;
    const numOrUndef = (col: string): number | undefined => {
      const raw = row[idx[col]];
      if (!raw || !raw.trim()) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    rows.push({
      player_id: row[idx.player_id].trim(),
      player: (row[idx.player] ?? "").trim(),
      team: (row[idx.team] ?? "").trim(),
      position: (row[idx.position] ?? "").trim(),
      std: numOrUndef("std"),
      ppr: numOrUndef("ppr"),
      half_ppr: numOrUndef("half_ppr"),
    });
  }
  return rows;
}

async function fetchPlayerDirectory(): Promise<Record<string, SleeperPlayer>> {
  const res = await fetch(`${SLEEPER_BASE}/v1/players/nfl`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Sleeper /v1/players/nfl → ${res.status}`);
  }
  return (await res.json()) as Record<string, SleeperPlayer>;
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

type ParsedRow = {
  playerId: number;
  rankingType: "adp";
  scoringSystem: ScoringKey;
  rankValue: number;
  playerName: string;
  playerTeam: string;
};

type UnmappedRow = {
  rankingType: "adp";
  scoringSystem: ScoringKey;
  rankValue: number;
  rawName: string;
  rawTeam: string | null;
};

function parseSleeper(
  csvRows: AdpCsvRow[],
  playerDir: Record<string, SleeperPlayer>,
  matcher: PlayerMatcher,
): {
  matched: ParsedRow[];
  unmapped: UnmappedRow[];
  matchStats: Record<string, number>;
  coverage: Record<ScoringKey, { matched: number; total: number }>;
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
  const coverage: Record<ScoringKey, { matched: number; total: number }> = {
    Standard: { matched: 0, total: 0 },
    PPR: { matched: 0, total: 0 },
    Half: { matched: 0, total: 0 },
  };

  type Candidate = {
    sleeperId: string;
    fullName: string;
    team: string | null;
    std?: number;
    ppr?: number;
    half_ppr?: number;
  };

  // First pass: enrich each CSV row with the canonical Sleeper player record
  // (preferred over the CSV's `player` column because the player directory has
  // cleaner team codes and handles "" vs null consistently).
  const candidates: Candidate[] = [];
  for (const r of csvRows) {
    const hasAny = r.std != null || r.ppr != null || r.half_ppr != null;
    if (!hasAny) {
      matchStats.skipped_no_rank++;
      continue;
    }
    const dir = playerDir[r.player_id];
    const fullName =
      dir?.full_name ||
      (dir?.first_name && dir?.last_name
        ? `${dir.first_name} ${dir.last_name}`
        : r.player);
    const team = (dir?.team ?? r.team) || null;
    if (!fullName) {
      matchStats.skipped_no_rank++;
      continue;
    }
    if (r.std != null) coverage.Standard.total++;
    if (r.ppr != null) coverage.PPR.total++;
    if (r.half_ppr != null) coverage.Half.total++;
    candidates.push({
      sleeperId: r.player_id,
      fullName,
      team,
      std: r.std,
      ppr: r.ppr,
      half_ppr: r.half_ppr,
    });
  }

  // Second pass: match against our roster. One Sleeper player → one roster
  // player; for the rare case where multiple Sleeper rows fuzzy-match the same
  // roster id, keep the highest-confidence match.
  const CONFIDENCE_RANK: Record<string, number> = {
    exact: 3,
    name_only: 2,
    lastname_team: 1,
  };
  const winnerByPlayerId = new Map<
    number,
    { candidate: Candidate; confidence: string }
  >();

  for (const c of candidates) {
    const m = matcher.match({ name: c.fullName, team: c.team });
    if (!m.matched) {
      if (c.std != null)
        unmapped.push({
          rankingType: "adp",
          scoringSystem: "Standard",
          rankValue: c.std,
          rawName: c.fullName,
          rawTeam: c.team,
        });
      if (c.ppr != null)
        unmapped.push({
          rankingType: "adp",
          scoringSystem: "PPR",
          rankValue: c.ppr,
          rawName: c.fullName,
          rawTeam: c.team,
        });
      if (c.half_ppr != null)
        unmapped.push({
          rankingType: "adp",
          scoringSystem: "Half",
          rankValue: c.half_ppr,
          rawName: c.fullName,
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

  // Third pass: emit rows
  for (const [playerId, { candidate: c }] of Array.from(winnerByPlayerId.entries())) {
    if (c.std != null) {
      matched.push({
        playerId,
        rankingType: "adp",
        scoringSystem: "Standard",
        rankValue: c.std,
        playerName: c.fullName,
        playerTeam: c.team ?? "",
      });
      coverage.Standard.matched++;
    }
    if (c.ppr != null) {
      matched.push({
        playerId,
        rankingType: "adp",
        scoringSystem: "PPR",
        rankValue: c.ppr,
        playerName: c.fullName,
        playerTeam: c.team ?? "",
      });
      coverage.PPR.matched++;
    }
    if (c.half_ppr != null) {
      matched.push({
        playerId,
        rankingType: "adp",
        scoringSystem: "Half",
        rankValue: c.half_ppr,
        playerName: c.fullName,
        playerTeam: c.team ?? "",
      });
      coverage.Half.matched++;
    }
  }

  return { matched, unmapped, matchStats, coverage };
}

async function upsertRows(rows: ParsedRow[]) {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      player_id: r.playerId,
      source: "sleeper",
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
  if (rows.length === 0) return;
  // Wipe Sleeper's previous unmapped batch so the table doesn't grow unbounded.
  await supabase
    .from("platform_rankings_unmapped")
    .delete()
    .eq("source", "sleeper");
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      source: "sleeper",
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
  const argSeason = process.argv[2] ? Number(process.argv[2]) : null;
  const seasonsToTry = argSeason
    ? [argSeason]
    : [new Date().getFullYear(), new Date().getFullYear() - 1];

  let csvRows: AdpCsvRow[] = [];
  let successfulSeason = 0;
  for (const season of seasonsToTry) {
    try {
      console.log(`→ Fetching Sleeper ADP CSV for season ${season}…`);
      const rows = await fetchAdpCsv(season);
      console.log(`  Sleeper returned ${rows.length} player rows`);
      const withRanks = rows.filter(
        (r) => r.std != null || r.ppr != null || r.half_ppr != null,
      );
      console.log(
        `  ${withRanks.length} have ADP in at least one scoring; ${rows.length - withRanks.length} don't`,
      );
      if (withRanks.length > 0) {
        csvRows = rows;
        successfulSeason = season;
        break;
      }
      console.log(`  No ADP data for ${season}, trying next…`);
    } catch (err) {
      console.log(
        `  Sleeper ${season} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (csvRows.length === 0) {
    console.error("❌ No usable Sleeper ADP data from any season tried.");
    process.exit(1);
  }
  console.log(`\n  Using Sleeper ADP from season ${successfulSeason}\n`);

  console.log(`→ Fetching Sleeper player directory (~14MB)…`);
  const playerDir = await fetchPlayerDirectory();
  console.log(`  Loaded ${Object.keys(playerDir).length} player metadata records`);

  const roster = await loadRoster();
  console.log(`→ Loaded local roster: ${roster.length} players`);
  const matcher = new PlayerMatcher(roster);

  const { matched, unmapped, matchStats, coverage } = parseSleeper(
    csvRows,
    playerDir,
    matcher,
  );
  console.log(`\n  Match stats: ${JSON.stringify(matchStats)}`);
  console.log(`  Coverage per scoring system (matched / total with ADP):`);
  for (const [scoring, c] of Object.entries(coverage)) {
    console.log(`    ${scoring}: ${c.matched} / ${c.total}`);
  }
  console.log(`\n  Matched rows ready to upsert: ${matched.length}`);
  console.log(`  Unmapped rows: ${unmapped.length}`);

  console.log(`\n→ Upserting matched rows to platform_rankings…`);
  await upsertRows(matched);
  console.log(`  ✓ Upserted`);

  console.log(`→ Logging unmapped rows to platform_rankings_unmapped…`);
  await logUnmapped(unmapped);
  console.log(`  ✓ Logged`);

  console.log("\n✅ Sleeper ADP sync complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
