/**
 * Scrape FantasyPros' public ADP pages for PPR / Half / Standard consensus.
 * Their free tier only exposes the consensus AVG (aggregated across
 * ESPN/Yahoo/Sleeper/NFL/RTSports under the hood); per-platform breakdowns
 * are paywalled.
 *
 *   npx tsx scripts/fetch-fantasypros.ts
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
  console.error("❌ Missing Supabase env vars");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGES: { url: string; scoring: "PPR" | "Half" | "Standard" }[] = [
  { url: "https://www.fantasypros.com/nfl/adp/ppr-overall.php", scoring: "PPR" },
  {
    url: "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
    scoring: "Half",
  },
  { url: "https://www.fantasypros.com/nfl/adp/standard-overall.php", scoring: "Standard" },
];

type ParsedRow = {
  name: string;
  team: string | null;
  position: string;
  adp: number;
};

function parseFpTable(html: string): ParsedRow[] {
  const tableMatch = html.match(
    /<table[^>]*id=["']data["'][^>]*>([\s\S]*?)<\/table>/,
  );
  if (!tableMatch) return [];

  const rows: ParsedRow[] = [];
  const rowMatches = Array.from(
    tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g),
  );

  for (const m of rowMatches) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(
      (c) =>
        c[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
    );
    if (cells.length < 4) continue;

    // cells[1] is "Player Team" — split on the last token (team abbr)
    const playerTeam = cells[1];
    const parts = playerTeam.split(" ");
    const lastWord = parts[parts.length - 1];
    let name = playerTeam;
    let team: string | null = null;
    if (/^[A-Z]{2,3}$/.test(lastWord)) {
      team = lastWord;
      name = parts.slice(0, -1).join(" ");
    }

    const adp = Number(cells[3]);
    if (!Number.isFinite(adp) || adp <= 0) continue;

    rows.push({
      name,
      team,
      position: cells[2],
      adp,
    });
  }
  return rows;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

async function main() {
  const roster = await loadRoster();
  const matcher = new PlayerMatcher(roster);
  console.log(`→ Loaded roster: ${roster.length} players`);

  const matchedRows: Array<{
    player_id: number;
    source: "fantasypros";
    ranking_type: "adp";
    scoring_system: "PPR" | "Half" | "Standard";
    rank_value: number;
    player_name: string;
    player_team: string;
  }> = [];
  const unmappedRows: Array<{
    source: "fantasypros";
    ranking_type: "adp";
    scoring_system: "PPR" | "Half" | "Standard";
    rank_value: number;
    raw_name: string;
    raw_team: string | null;
  }> = [];
  const winnersByScoring: Record<string, Map<number, { row: ParsedRow; confidence: string }>> = {};
  const CONFIDENCE_RANK: Record<string, number> = {
    exact: 3,
    name_only: 2,
    lastname_team: 1,
  };

  for (const { url, scoring } of PAGES) {
    console.log(`\n→ Fetching FP ${scoring}: ${url}`);
    const html = await fetchPage(url);
    const parsed = parseFpTable(html);
    console.log(`  parsed ${parsed.length} rows`);
    if (parsed.length === 0) continue;

    const winners = new Map<number, { row: ParsedRow; confidence: string }>();
    for (const row of parsed) {
      const m = matcher.match({ name: row.name, team: row.team });
      if (!m.matched) {
        unmappedRows.push({
          source: "fantasypros",
          ranking_type: "adp",
          scoring_system: scoring,
          rank_value: row.adp,
          raw_name: row.name,
          raw_team: row.team,
        });
        continue;
      }
      const existing = winners.get(m.playerId);
      if (
        !existing ||
        (CONFIDENCE_RANK[m.confidence] ?? 0) >
          (CONFIDENCE_RANK[existing.confidence] ?? 0)
      ) {
        winners.set(m.playerId, { row, confidence: m.confidence });
      }
    }
    winnersByScoring[scoring] = winners;
    console.log(`  matched ${winners.size} unique players`);

    for (const [playerId, { row }] of Array.from(winners.entries())) {
      matchedRows.push({
        player_id: playerId,
        source: "fantasypros",
        ranking_type: "adp",
        scoring_system: scoring,
        rank_value: row.adp,
        player_name: row.name,
        player_team: row.team ?? "",
      });
    }

    await new Promise((r) => setTimeout(r, 1000)); // be polite
  }

  console.log(`\n→ Upserting ${matchedRows.length} matched rows…`);
  const chunkSize = 500;
  for (let i = 0; i < matchedRows.length; i += chunkSize) {
    const chunk = matchedRows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("platform_rankings")
      .upsert(chunk, {
        onConflict: "player_id,source,ranking_type,scoring_system",
      });
    if (error) throw new Error(`upsert failed: ${error.message}`);
  }

  console.log(`→ Refreshing unmapped log (${unmappedRows.length} rows)…`);
  await supabase
    .from("platform_rankings_unmapped")
    .delete()
    .eq("source", "fantasypros");
  for (let i = 0; i < unmappedRows.length; i += chunkSize) {
    await supabase
      .from("platform_rankings_unmapped")
      .insert(unmappedRows.slice(i, i + chunkSize));
  }

  console.log("\n✅ FantasyPros sync complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
