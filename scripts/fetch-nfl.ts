/**
 * Scrape NFL.com Fantasy editorial rankings from the server-rendered
 * rankings page and upsert into platform_rankings.
 *
 *   npx tsx scripts/fetch-nfl.ts [season]
 *
 * NFL.com only exposes positional rankings (no `position=O` overall),
 * so we fetch QB/RB/WR/TE/K/DEF separately. Each player gets their
 * per-position rank as rank_value. NFL.com doesn't expose PPR/Half/
 * Standard variants on this page — we emit Standard only and let the
 * app mock the other scoring views.
 *
 * Tries the given (or current) season first, falls back one year.
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

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// NFL.com only supports these as ?position= values on the rankings page.
// `position=O` (overall) returns "No player to display".
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
type NflPosition = (typeof POSITIONS)[number];

const REQUEST_DELAY_MS = 2000;
const PAGE_SIZE = 200;
const MAX_OFFSET = 401; // 1, 201, 401 — covers up to 600 per position

type ParsedRow = {
  rank: number;
  name: string;
  team: string | null;
  position: NflPosition;
  nflPlayerId: string;
};

function buildUrl(season: number, position: NflPosition, offset: number): string {
  const params = new URLSearchParams({
    leagueId: "0",
    statType: "seasonProjectedStats",
    statSeason: String(season),
    position,
    offset: String(offset),
    count: String(PAGE_SIZE),
  });
  return `https://fantasy.nfl.com/research/rankings?${params.toString()}`;
}

/**
 * Distinct from /research/rankings (which only shows rank columns), the
 * /research/projections page exposes season projected fantasy points in the
 * last `<td class="stat projected …">` cell. Position codes here are numeric
 * (QB=1, RB=2, …) instead of the string codes /rankings uses. We key the
 * points by NFL's internal player_id and join against the rank scrape later.
 */
const PROJECTION_POSITION_CODES: Record<NflPosition, number> = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 4,
  K: 7,
  DEF: 8,
};

function buildProjectionUrl(
  season: number,
  position: NflPosition,
  offset: number,
): string {
  const params = new URLSearchParams({
    statCategory: "projectedStats",
    statSeason: String(season),
    statType: "seasonProjectedStats",
    position: String(PROJECTION_POSITION_CODES[position]),
    offset: String(offset),
    count: String(PAGE_SIZE),
  });
  return `https://fantasy.nfl.com/research/projections?${params.toString()}`;
}

async function fetchProjectionPoints(
  season: number,
  position: NflPosition,
): Promise<Map<string, number>> {
  const byNflId = new Map<string, number>();
  for (let offset = 1; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    const url = buildProjectionUrl(season, position, offset);
    console.log(`    proj ${position} offset=${offset}`);
    let html: string;
    try {
      html = await fetchPage(url);
    } catch (err) {
      console.log(
        `    proj ${position} offset=${offset} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
    // The last <td class="stat projected …"> in each <tr class="player-{id}">
    // row is the season FPTS. Some rows have "-" (no projection) — skip those.
    const rowRe = /<tr\s+class="player-(\d+)[^"]*">([\s\S]*?)<\/tr>/g;
    let m: RegExpExecArray | null;
    let parsed = 0;
    while ((m = rowRe.exec(html)) !== null) {
      const nflId = m[1];
      const rowHtml = m[2];
      const fptsMatch = rowHtml.match(
        /<td[^>]*class="[^"]*\bstat\s+projected\b[^"]*"[^>]*>\s*([\d.,-]+)\s*<\/td>/,
      );
      if (!fptsMatch) continue;
      const raw = fptsMatch[1].replace(/,/g, "");
      const pts = Number(raw);
      if (Number.isFinite(pts) && pts > 0) {
        byNflId.set(nflId, Math.round(pts * 100) / 100);
        parsed++;
      }
    }
    if (parsed === 0) break;
    if (parsed < PAGE_SIZE) break;
    await delay(REQUEST_DELAY_MS);
  }
  return byNflId;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.text();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse NFL.com's <table class="tableType-player"> body. Row structure:
 *   <tr class="player-{nflId} odd first">
 *     <td class="editorDraftRankRank ...">{rank}</td>
 *     <td class="playerNameAndInfo">
 *       <div class="c c-{team}">...
 *         <a class="playerCard playerName ...">{name}</a>
 *         <em>{POS} - {TEAM}</em>
 *       </div>
 *     </td>
 *     ...
 *   </tr>
 */
function parseTable(html: string, position: NflPosition): ParsedRow[] {
  const tableMatch = html.match(
    /<table[^>]*class="[^"]*tableType-player[^"]*"[^>]*>([\s\S]*?)<\/table>/,
  );
  if (!tableMatch) return [];

  const rows: ParsedRow[] = [];
  const rowMatches = Array.from(
    tableMatch[1].matchAll(
      /<tr\s+class="player-(\d+)[^"]*">([\s\S]*?)<\/tr>/g,
    ),
  );

  for (const m of rowMatches) {
    const nflPlayerId = m[1];
    const rowHtml = m[2];

    // Rank lives in the first td with class containing editorDraftRankRank.
    const rankMatch = rowHtml.match(
      /<td[^>]*class="[^"]*editorDraftRankRank[^"]*"[^>]*>\s*(\d+)\s*<\/td>/,
    );
    if (!rankMatch) continue;
    const rank = Number(rankMatch[1]);
    if (!Number.isFinite(rank) || rank <= 0) continue;

    // Name is in the playerName <a>; team in the <em>POS - TEAM</em>.
    const nameMatch = rowHtml.match(
      /<a[^>]*class="[^"]*playerName[^"]*"[^>]*>([^<]+)<\/a>/,
    );
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    const posTeamMatch = rowHtml.match(/<em>\s*([A-Z]+)\s*-\s*([A-Z]+)\s*<\/em>/);
    const team = posTeamMatch ? posTeamMatch[2] : null;

    rows.push({ rank, name, team, position, nflPlayerId });
  }
  return rows;
}

async function fetchPosition(
  season: number,
  position: NflPosition,
): Promise<ParsedRow[]> {
  const all: ParsedRow[] = [];
  for (let offset = 1; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    const url = buildUrl(season, position, offset);
    console.log(`  GET ${position} offset=${offset}`);
    const html = await fetchPage(url);
    const parsed = parseTable(html, position);
    if (parsed.length === 0) {
      if (offset === 1) {
        // Empty first page — capture a snippet for diagnostics.
        const snippet = html.replace(/\s+/g, " ").slice(0, 500);
        console.log(`    (empty; first 500 chars: ${snippet})`);
      }
      break;
    }
    all.push(...parsed);
    console.log(`    parsed ${parsed.length} rows`);
    // If page returned fewer than PAGE_SIZE rows, no more pages exist.
    if (parsed.length < PAGE_SIZE) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

type MatchedRow = {
  player_id: number;
  source: "nfl";
  ranking_type: "editorial";
  scoring_system: "Standard";
  rank_value: number;
  /** Season FPTS scraped from /research/projections, joined by NFL player id. */
  projected_points: number | null;
  player_name: string;
  player_team: string;
};

type UnmappedRow = {
  source: "nfl";
  ranking_type: "editorial";
  scoring_system: "Standard";
  rank_value: number;
  raw_name: string;
  raw_team: string | null;
};

async function main() {
  const argSeason = process.argv[2] ? Number(process.argv[2]) : null;
  const currentYear = new Date().getFullYear();
  const seasonsToTry = argSeason ? [argSeason] : [currentYear, currentYear - 1];

  let allRows: ParsedRow[] = [];
  let successfulSeason = 0;

  for (const season of seasonsToTry) {
    console.log(`\n→ Fetching NFL.com rankings for season ${season}…`);
    const seasonRows: ParsedRow[] = [];
    let anyData = false;
    let aborted = false;

    for (const position of POSITIONS) {
      try {
        const rows = await fetchPosition(season, position);
        if (rows.length > 0) anyData = true;
        seasonRows.push(...rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("429")) {
          console.error(`\n❌ NFL.com blocking us (${msg}). Stopping.`);
          process.exit(1);
        }
        console.log(`  ${position} failed: ${msg}`);
        aborted = true;
        break;
      }
      // Polite pause between positions too.
      await delay(REQUEST_DELAY_MS);
    }

    if (anyData && !aborted) {
      allRows = seasonRows;
      successfulSeason = season;
      break;
    }
    console.log(`  No usable data for ${season}, trying next…`);
  }

  // Pull projection points for whichever season the rankings came from.
  // Keyed by NFL player id (string) — joined into matched rows below.
  // NFL.com sometimes publishes preseason rankings before projections (in
  // which case every FPTS cell reads "0.00" and our filter drops them all).
  // Fall back one season if we get nothing.
  const pointsByNflId = new Map<string, number>();
  if (allRows.length > 0) {
    const projectionSeasons = [successfulSeason, successfulSeason - 1];
    let projSeason = 0;
    for (const trySeason of projectionSeasons) {
      console.log(
        `\n→ Fetching NFL.com projected points for season ${trySeason}…`,
      );
      const trial = new Map<string, number>();
      for (const position of POSITIONS) {
        try {
          const map = await fetchProjectionPoints(trySeason, position);
          for (const [k, v] of Array.from(map.entries())) trial.set(k, v);
          console.log(`    ${position}: ${map.size} projection rows`);
        } catch (err) {
          console.log(
            `    ${position} projections failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await delay(REQUEST_DELAY_MS);
      }
      if (trial.size > 0) {
        for (const [k, v] of Array.from(trial.entries())) pointsByNflId.set(k, v);
        projSeason = trySeason;
        break;
      }
      console.log(`  No projection points for ${trySeason}, trying previous…`);
    }
    if (projSeason !== 0 && projSeason !== successfulSeason) {
      console.log(
        `  ⚠ Using ${projSeason} projections for ${successfulSeason} ranks (NFL.com hadn't published ${successfulSeason} projections yet).`,
      );
    }
    console.log(`  Total players with projected_points: ${pointsByNflId.size}`);
  }

  if (allRows.length === 0) {
    console.error("\n❌ No NFL.com data from any season tried.");
    process.exit(1);
  }
  console.log(
    `\n  Using NFL.com data from season ${successfulSeason}: ${allRows.length} total rows`,
  );

  const roster = await loadRoster();
  console.log(`→ Loaded local roster: ${roster.length} players`);
  const matcher = new PlayerMatcher(roster);

  const CONFIDENCE_RANK: Record<string, number> = {
    exact: 3,
    name_only: 2,
    lastname_team: 1,
  };
  const matchStats: Record<string, number> = {
    exact: 0,
    name_only: 0,
    lastname_team: 0,
    unmapped: 0,
    dropped_dup: 0,
  };

  const winners = new Map<number, { row: ParsedRow; confidence: string }>();
  const unmapped: UnmappedRow[] = [];

  for (const row of allRows) {
    const m = matcher.match({ name: row.name, team: row.team });
    if (!m.matched) {
      matchStats.unmapped++;
      unmapped.push({
        source: "nfl",
        ranking_type: "editorial",
        scoring_system: "Standard",
        rank_value: row.rank,
        raw_name: row.name,
        raw_team: row.team,
      });
      continue;
    }
    matchStats[m.confidence]++;
    const existing = winners.get(m.playerId);
    if (
      !existing ||
      (CONFIDENCE_RANK[m.confidence] ?? 0) >
        (CONFIDENCE_RANK[existing.confidence] ?? 0)
    ) {
      if (existing) matchStats.dropped_dup++;
      winners.set(m.playerId, { row, confidence: m.confidence });
    } else {
      matchStats.dropped_dup++;
    }
  }

  console.log(`\n  Match stats: ${JSON.stringify(matchStats)}`);
  console.log(`  Unique matched players: ${winners.size}`);
  console.log(`  Unmapped: ${unmapped.length}`);

  const matched: MatchedRow[] = Array.from(winners.entries()).map(
    ([playerId, { row }]) => ({
      player_id: playerId,
      source: "nfl",
      ranking_type: "editorial",
      scoring_system: "Standard",
      rank_value: row.rank,
      projected_points: pointsByNflId.get(row.nflPlayerId) ?? null,
      player_name: row.name,
      player_team: row.team ?? "",
    }),
  );
  const withPoints = matched.filter((m) => m.projected_points != null).length;
  console.log(
    `  Matched rows with projected_points: ${withPoints} / ${matched.length}`,
  );

  console.log(`\n→ Upserting ${matched.length} matched rows…`);
  const chunkSize = 500;
  let upsertWithPoints = true;
  for (let i = 0; i < matched.length; i += chunkSize) {
    const slice = matched.slice(i, i + chunkSize);
    const chunk: Array<Record<string, unknown>> = slice.map((r) => {
      const row: Record<string, unknown> = {
        player_id: r.player_id,
        source: r.source,
        ranking_type: r.ranking_type,
        scoring_system: r.scoring_system,
        rank_value: r.rank_value,
        player_name: r.player_name,
        player_team: r.player_team,
      };
      if (upsertWithPoints) row.projected_points = r.projected_points;
      return row;
    });
    const { error } = await supabase
      .from("platform_rankings")
      .upsert(chunk, {
        onConflict: "player_id,source,ranking_type,scoring_system",
      });
    if (error) {
      if (upsertWithPoints && /projected_points/.test(error.message)) {
        console.log(
          `  ⚠ projected_points column missing — run migration 016. Retrying without.`,
        );
        upsertWithPoints = false;
        i -= chunkSize;
        continue;
      }
      throw new Error(`upsert failed: ${error.message}`);
    }
  }
  console.log(`  ✓ Upserted`);

  console.log(`→ Refreshing unmapped log (${unmapped.length} rows)…`);
  await supabase
    .from("platform_rankings_unmapped")
    .delete()
    .eq("source", "nfl");
  for (let i = 0; i < unmapped.length; i += chunkSize) {
    await supabase
      .from("platform_rankings_unmapped")
      .insert(unmapped.slice(i, i + chunkSize));
  }
  console.log(`  ✓ Logged`);

  console.log("\n✅ NFL.com sync complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
