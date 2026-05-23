/**
 * Scrape NFL.com season PROJECTED STAT LINES from the public research page
 * (no login required) into platform_player_stats.
 *
 *   npm run fetch:projections:nfl [season]
 *
 * NFL killed its JSON API, but fantasy.nfl.com/research/projections is public
 * and server-rendered: each row carries `playerNameId-{id}` + `<em>POS - TEAM</em>`
 * and stat cells `playerStat statId-{N} playerId-{id}">{value}`. We page through
 * offsets, regex the table, map statIds → our ImpliedStats keys, match players
 * to our roster, and upsert.
 *
 * NOTE: NFL.com only posts NEXT season's projections around mid-summer — in the
 * offseason this returns 0 rows for the upcoming year (that's expected; re-run
 * once they publish). Requires migration 021 + Supabase env in .env.local.
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

// NFL.com statId → our ImpliedStats key. (5 = pass yds, 14 = rush yds verified
// live; the rest are NFL.com's standard ids — validate if numbers look off.)
const STAT_IDS: Record<string, string> = {
  "5": "passingYards",
  "6": "passingTouchdowns",
  "7": "interceptions",
  "14": "rushingYards",
  "15": "rushingTouchdowns",
  "20": "receptions",
  "21": "receivingYards",
  "22": "receivingTouchdowns",
};

// NFL.com team code → our roster code (most match; a few differ).
const TEAM_ALIAS: Record<string, string> = { LA: "LAR", WSH: "WAS", JAC: "JAX" };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

type NflPlayer = { name: string; team: string; stats: Record<string, number> };

async function fetchPage(season: number, offset: number): Promise<string> {
  const url = `https://fantasy.nfl.com/research/projections?position=O&statCategory=projectedStats&statSeason=${season}&statType=seasonProjectedStats&offset=${offset}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`NFL ${season} offset ${offset} → ${res.status}`);
  return res.text();
}

function parsePage(html: string): Map<string, NflPlayer> {
  const players = new Map<string, NflPlayer>();
  const nameRe =
    /playerNameId-(\d+) what-playerCard">([^<]+)<\/a>\s*<em>([A-Z]+)\s*-\s*([A-Za-z]+)<\/em>/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(html))) {
    const [, id, name, , teamRaw] = m;
    const team = TEAM_ALIAS[teamRaw.toUpperCase()] ?? teamRaw.toUpperCase();
    players.set(id, { name: name.trim(), team, stats: {} });
  }
  const statRe = /playerStat statId-(\d+) playerId-(\d+)">([0-9.]+)/g;
  while ((m = statRe.exec(html))) {
    const [, statId, id, value] = m;
    const key = STAT_IDS[statId];
    const p = players.get(id);
    if (key && p) p.stats[key] = Number(value);
  }
  return players;
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "players-mock.json"),
    "utf8",
  );
  return JSON.parse(raw) as RosterPlayer[];
}

type StatRow = {
  source: "nfl";
  player_id: number;
  stat: string;
  value: number;
  season: number;
  week: null;
};

async function collect(season: number): Promise<Map<string, NflPlayer>> {
  const all = new Map<string, NflPlayer>();
  for (let offset = 1; offset <= 301; offset += 25) {
    const html = await fetchPage(season, offset);
    const page = parsePage(html);
    if (page.size === 0) break;
    let added = 0;
    for (const [id, p] of Array.from(page.entries())) {
      if (!all.has(id)) {
        all.set(id, p);
        added++;
      }
    }
    if (added === 0) break; // looping the same page → stop
  }
  return all;
}

async function main() {
  const argSeason = process.argv[2] ? Number(process.argv[2]) : null;
  const seasons = argSeason ? [argSeason] : [new Date().getFullYear()];

  let players = new Map<string, NflPlayer>();
  let season = 0;
  for (const s of seasons) {
    const collected = await collect(s);
    const withStats = Array.from(collected.values()).filter(
      (p) => Object.keys(p.stats).length > 0,
    ).length;
    console.log(`→ ${s}: ${collected.size} players, ${withStats} with projection values`);
    if (withStats > 0) {
      players = collected;
      season = s;
      break;
    }
  }
  if (season === 0) {
    console.log(
      "⚠ No NFL.com projection values for the requested season yet (they post next-season projections mid-summer). Nothing to write.",
    );
    return;
  }

  const roster = await loadRoster();
  const matcher = new PlayerMatcher(roster);
  const rows: StatRow[] = [];
  const seen = new Set<string>();
  let matched = 0;
  for (const p of Array.from(players.values())) {
    if (Object.keys(p.stats).length === 0) continue;
    const mm = matcher.match({ name: p.name, team: p.team });
    if (!mm.matched) continue;
    matched++;
    for (const [stat, value] of Object.entries(p.stats) as [string, number][]) {
      if (!Number.isFinite(value) || value <= 0) continue;
      const dedupe = `${mm.playerId}:${stat}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({ source: "nfl", player_id: mm.playerId, stat, value, season, week: null });
    }
  }
  console.log(`  matched ${matched} players → ${rows.length} stat rows`);

  await supabase
    .from("platform_player_stats")
    .delete()
    .eq("source", "nfl")
    .eq("season", season)
    .is("week", null);
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await supabase
      .from("platform_player_stats")
      .insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`insert failed: ${error.message}`);
  }
  console.log(`\n✅ NFL projection stats synced (${rows.length} rows, season ${season}).`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
