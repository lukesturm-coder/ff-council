/**
 * Scrape NFL outright/award markets from a public page, parse with Claude,
 * write to vegas_outright_markets.
 *
 *   npx tsx scripts/scrape-vegas.ts <source> <url>
 *
 * Example:
 *   npx tsx scripts/scrape-vegas.ts oddstrader "https://www.oddstrader.com/nfl/player-futures/"
 *
 * This is purpose-built for OUTRIGHT/AWARD markets (MVP, Most Passing Yards,
 * etc.) which is what most public aggregator pages publish. Stat over/under
 * scraping is a different problem (see lib/scrape.ts extractFuturesFromHtml).
 */
import { config } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PlayerMatcher, type RosterPlayer } from "@/lib/player-matching";
import {
  extractOutrightsFromHtml,
  scrapePage,
  type ScrapedOutright,
} from "@/lib/scrape";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing Supabase env vars");
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error("❌ Missing ANTHROPIC_API_KEY in .env.local");
  console.error("   Get one from https://console.anthropic.com → API Keys");
  process.exit(1);
}

const VALID_SOURCES = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "fantasypros_aggregator",
  "oddstrader",
  "oddsshark",
  "bettingpros",
] as const;
type ValidSource = (typeof VALID_SOURCES)[number];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loadRoster(): Promise<RosterPlayer[]> {
  const filepath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(filepath, "utf8");
  return JSON.parse(raw) as RosterPlayer[];
}

async function main() {
  const sourceArg = process.argv[2];
  const url = process.argv[3];
  const waitSelector = process.argv[4];

  if (!sourceArg || !url) {
    console.error(
      "Usage: npx tsx scripts/scrape-vegas.ts <source> <url> [waitSelector]",
    );
    console.error(`Sources: ${VALID_SOURCES.join(", ")}`);
    process.exit(1);
  }
  if (!VALID_SOURCES.includes(sourceArg as ValidSource)) {
    console.error(`Source "${sourceArg}" not allowed.`);
    console.error(`Use one of: ${VALID_SOURCES.join(", ")}`);
    process.exit(1);
  }
  const source = sourceArg as ValidSource;

  console.log(`→ Scraping ${url}\n  (source: ${source})`);
  const startMs = Date.now();
  const { html, finalUrl, title } = await scrapePage(url, { waitSelector });
  console.log(`  ✓ "${title}"`);
  console.log(`    Final URL:   ${finalUrl}`);
  console.log(`    HTML size:   ${html.length.toLocaleString()} chars`);
  console.log(`    Render time: ${((Date.now() - startMs) / 1000).toFixed(1)}s`);

  // Save snapshot for debugging
  const debugDir = path.join(process.cwd(), "scripts", "scrape-debug");
  await fs.mkdir(debugDir, { recursive: true });
  const debugFile = path.join(
    debugDir,
    `${source}-${new Date().toISOString().replace(/[:.]/g, "-")}.html`,
  );
  await fs.writeFile(debugFile, html);
  console.log(`    Snapshot:    ${debugFile}`);

  console.log(`\n→ Asking Claude to extract outright markets…`);
  let outrights: ScrapedOutright[] = [];
  try {
    outrights = await extractOutrightsFromHtml(html);
  } catch (err) {
    console.error(
      `❌ Extraction failed: ${err instanceof Error ? err.message : err}`,
    );
    console.error(`   Inspect the snapshot at ${debugFile}`);
    process.exit(1);
  }
  console.log(`  Extracted ${outrights.length} outright entries`);

  if (outrights.length === 0) {
    console.log(
      `\n⚠  No outright markets extracted. Common causes:\n` +
        `   - Page is geofenced / showed a state-restricted fallback\n` +
        `   - JS hasn't rendered yet (pass a waitSelector)\n` +
        `   - This URL doesn't have player outright markets\n` +
        `   Inspect: ${debugFile}`,
    );
    process.exit(0);
  }

  // Show sample by market
  const byMarket = new Map<string, ScrapedOutright[]>();
  for (const o of outrights) {
    const list = byMarket.get(o.market) ?? [];
    list.push(o);
    byMarket.set(o.market, list);
  }
  console.log(
    `\n  Markets found: ${Array.from(byMarket.keys()).join(", ")}`,
  );
  for (const [market, players] of Array.from(byMarket.entries()).slice(0, 5)) {
    console.log(`\n  ${market} (top 5 by odds favorite):`);
    const sorted = [...players].sort((a, b) => a.odds - b.odds).slice(0, 5);
    for (const p of sorted) {
      const oddsStr = p.odds > 0 ? `+${p.odds}` : String(p.odds);
      console.log(
        `    ${p.player_name.padEnd(24)} ${(p.team ?? "—").padEnd(4)} ${oddsStr}`,
      );
    }
  }

  // Match to our roster
  const roster = await loadRoster();
  const matcher = new PlayerMatcher(roster);

  // Dedup at (player, market) level — if multiple sportsbook quotes for the
  // same player in the same market, keep the one with odds closest to median.
  const winnerByKey = new Map<string, ScrapedOutright>();
  for (const o of outrights) {
    const key = `${o.player_name.toLowerCase()}|${(o.team ?? "").toUpperCase()}|${o.market}`;
    const existing = winnerByKey.get(key);
    if (!existing || Math.abs(o.odds) < Math.abs(existing.odds)) {
      // Prefer odds closer to even (smaller absolute value usually means more
      // recent / sharper book)
      winnerByKey.set(key, o);
    }
  }

  type Row = {
    player_id: number;
    source: ValidSource;
    market: string;
    odds: number;
    player_name: string;
    player_team: string | null;
  };
  const rows: Row[] = [];
  const unmatched: string[] = [];
  const seenUnmatched = new Set<string>();
  for (const o of Array.from(winnerByKey.values())) {
    const match = matcher.match({ name: o.player_name, team: o.team });
    if (match.matched) {
      rows.push({
        player_id: match.playerId,
        source,
        market: o.market,
        odds: o.odds,
        player_name: o.player_name,
        player_team: o.team,
      });
    } else {
      const u = `${o.player_name} (${o.team ?? "no team"})`;
      if (!seenUnmatched.has(u)) {
        unmatched.push(u);
        seenUnmatched.add(u);
      }
    }
  }

  console.log(
    `\n  Player matching: ${rows.length} rows matched, ${unmatched.length} players unmatched`,
  );
  if (unmatched.length > 0) {
    console.log(
      `  Unmatched: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? `, … and ${unmatched.length - 10} more` : ""}`,
    );
  }

  if (rows.length === 0) {
    console.log("\n⚠ Nothing matched our roster. Aborting upsert.");
    process.exit(0);
  }

  console.log(`\n→ Upserting ${rows.length} rows to vegas_outright_markets…`);
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("vegas_outright_markets")
      .upsert(chunk, { onConflict: "player_id,source,market" });
    if (error) {
      console.error(`❌ Upsert failed: ${error.message}`);
      process.exit(1);
    }
  }

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
