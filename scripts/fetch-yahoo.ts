/**
 * Scrape Yahoo's public editorial top-200 prerank list from
 *   https://football.fantasysports.yahoo.com/f1/public_prerank
 *
 *   npx tsx scripts/fetch-yahoo.ts
 *
 * This page is publicly accessible (no OAuth, no login). It renders two
 * <ol class="List"> blocks: a snake-draft Top 200 and a Salary Cap Top 200.
 * We only use the snake-draft list — it's labeled "Top 200 Default Rankings -
 * Standard" but Yahoo doesn't differentiate PPR/Half/Standard publicly, so
 * we treat it as "editorial" and emit identical ranks for all three scoring
 * systems. If Yahoo eventually exposes per-format pages we can split them.
 *
 * Yahoo's markup omits team and position — entries are just "N. PlayerName".
 * That means matching relies on name_only confidence (no team to disambiguate),
 * which is fine for the consensus top ~200 since most names are unique.
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

const YAHOO_URL = "https://football.fantasysports.yahoo.com/f1/public_prerank";

type ParsedRow = {
  rank: number;
  name: string;
};

/**
 * Parse the snake-draft <ol class="List"> block. Yahoo renders two ols on the
 * page; the first is the standard draft order, the second is salary cap (with
 * "($N)" prices). We take the first one.
 *
 * Each <li> looks like:
 *   <li class="Listitem Phone-fz-lg">42. Omarion Hampton</li>
 */
function parseYahooList(html: string): ParsedRow[] {
  // Anchor on the header so we grab the right <ol>. The salary-cap block has
  // the same <ol class="List"> class — the header text is what distinguishes.
  const sectionMatch = html.match(
    /Top 200 Default Rankings - Standard[\s\S]*?<ol\s+class=["']List["'][^>]*>([\s\S]*?)<\/ol>/,
  );
  if (!sectionMatch) return [];
  const inner = sectionMatch[1];

  const rows: ParsedRow[] = [];
  const liMatches = Array.from(
    inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g),
  );
  for (const m of liMatches) {
    const text = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    // Expect: "42. Omarion Hampton"
    const parsed = text.match(/^(\d+)\.\s+(.+)$/);
    if (!parsed) continue;
    const rank = Number(parsed[1]);
    const name = parsed[2].trim();
    if (!Number.isFinite(rank) || rank <= 0 || !name) continue;
    rows.push({ rank, name });
  }
  return rows;
}

async function fetchYahoo(): Promise<string> {
  const res = await fetch(YAHOO_URL, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo returned ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  // Sanity: if Yahoo bounced us to a login page, the body will be tiny / contain
  // a login form rather than the prerank list. Dump first 500 chars and bail.
  if (
    !html.includes("public-preranks") &&
    !html.includes("Top 200 Default Rankings")
  ) {
    console.error("❌ Yahoo response missing prerank markers. First 500 chars:");
    console.error(html.slice(0, 500));
    throw new Error("Yahoo HTML did not contain the prerank section");
  }
  return html;
}

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

type MatchedOut = {
  player_id: number;
  source: "yahoo";
  ranking_type: "editorial";
  scoring_system: "PPR" | "Half" | "Standard";
  rank_value: number;
  player_name: string;
  player_team: string;
};

type UnmappedOut = {
  source: "yahoo";
  ranking_type: "editorial";
  scoring_system: "PPR" | "Half" | "Standard";
  rank_value: number;
  raw_name: string;
  raw_team: string | null;
};

async function main() {
  console.log(`→ Fetching ${YAHOO_URL}`);
  const html = await fetchYahoo();
  console.log(`  got ${html.length} bytes`);

  const parsed = parseYahooList(html);
  console.log(`  parsed ${parsed.length} ranked entries`);
  if (parsed.length === 0) {
    console.error("❌ Parser found 0 rows. HTML structure may have changed.");
    process.exit(1);
  }

  const roster = await loadRoster();
  console.log(`→ Loaded local roster: ${roster.length} players`);
  const matcher = new PlayerMatcher(roster);

  // Match each Yahoo entry against the roster. Yahoo doesn't expose team, so
  // we pass team:null — the matcher will fall through to name_only matching.
  // Dedupe by playerId, keeping the best rank if Yahoo somehow lists a player
  // twice (shouldn't happen in practice).
  const winners = new Map<number, ParsedRow>();
  const unmappedNames: ParsedRow[] = [];
  const stats = { exact: 0, name_only: 0, lastname_team: 0, unmapped: 0 };

  for (const row of parsed) {
    const m = matcher.match({ name: row.name, team: null });
    if (!m.matched) {
      unmappedNames.push(row);
      stats.unmapped++;
      continue;
    }
    stats[m.confidence]++;
    const existing = winners.get(m.playerId);
    if (!existing || row.rank < existing.rank) {
      winners.set(m.playerId, row);
    }
  }

  console.log(`  match stats: ${JSON.stringify(stats)}`);
  console.log(`  unique matched players: ${winners.size}`);
  if (unmappedNames.length > 0) {
    console.log(
      `  unmapped sample: ${unmappedNames.slice(0, 10).map((u) => `${u.rank}. ${u.name}`).join(", ")}`,
    );
  }

  // Yahoo's single editorial list applies to all three scoring formats until
  // they expose per-format views.
  const scoringSystems: Array<"PPR" | "Half" | "Standard"> = [
    "PPR",
    "Half",
    "Standard",
  ];
  const matchedRows: MatchedOut[] = [];
  for (const [playerId, row] of Array.from(winners.entries())) {
    for (const scoring of scoringSystems) {
      matchedRows.push({
        player_id: playerId,
        source: "yahoo",
        ranking_type: "editorial",
        scoring_system: scoring,
        rank_value: row.rank,
        player_name: row.name,
        player_team: "",
      });
    }
  }

  const unmappedRows: UnmappedOut[] = [];
  for (const row of unmappedNames) {
    for (const scoring of scoringSystems) {
      unmappedRows.push({
        source: "yahoo",
        ranking_type: "editorial",
        scoring_system: scoring,
        rank_value: row.rank,
        raw_name: row.name,
        raw_team: null,
      });
    }
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
  console.log(`  ✓ Upserted`);

  console.log(`→ Refreshing unmapped log (${unmappedRows.length} rows)…`);
  await supabase
    .from("platform_rankings_unmapped")
    .delete()
    .eq("source", "yahoo");
  for (let i = 0; i < unmappedRows.length; i += chunkSize) {
    await supabase
      .from("platform_rankings_unmapped")
      .insert(unmappedRows.slice(i, i + chunkSize));
  }
  console.log(`  ✓ Logged`);

  console.log("\n✅ Yahoo sync complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
