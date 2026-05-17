/**
 * Test-only: load a URL in headless Chrome, dump HTML + screenshot to debug,
 * report what we see. No Claude API needed — answers the question "can we
 * even reach this page from here?"
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { scrapePage } from "@/lib/scrape";

const KNOWN_PLAYERS = [
  "Saquon Barkley",
  "Bijan Robinson",
  "Ja'Marr Chase",
  "Justin Jefferson",
  "Lamar Jackson",
  "Josh Allen",
  "Patrick Mahomes",
];

const GEOFENCE_HINTS = [
  "currently unavailable in your state",
  "sports betting is not legal",
  "not available in your location",
  "geolocation",
  "restricted in your jurisdiction",
];

async function probe(url: string) {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`→ ${url}`);
  try {
    const { html, finalUrl, title } = await scrapePage(url);
    const outFile = path.join(
      process.cwd(),
      "scripts",
      "scrape-debug",
      `probe-${new URL(url).hostname}-${new Date().toISOString().replace(/[:.]/g, "-")}.html`,
    );
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, html);

    console.log(`  title:       "${title}"`);
    console.log(`  final URL:   ${finalUrl}`);
    console.log(`  HTML size:   ${html.length.toLocaleString()} chars`);
    console.log(`  saved:       ${outFile}`);

    // Look for known player names — if they're there, the page rendered odds
    const playerHits = KNOWN_PLAYERS.filter((p) => html.includes(p));
    console.log(`  player hits: ${playerHits.length}/${KNOWN_PLAYERS.length}`);
    if (playerHits.length > 0) {
      console.log(`    found: ${playerHits.join(", ")}`);
    }

    // Geofence detection
    const lowerHtml = html.toLowerCase();
    const geoHits = GEOFENCE_HINTS.filter((h) => lowerHtml.includes(h));
    if (geoHits.length > 0) {
      console.log(`  ⚠ geofence hints: ${geoHits.join(", ")}`);
    }

    // Look for over/under structure
    const ouMatches = (html.match(/o\/u|over\s*\/\s*under/gi) ?? []).length;
    console.log(`  O/U mentions: ${ouMatches}`);

    // Look for odds-like numbers (-110, +120, etc.)
    const oddsMatches = (html.match(/[-+]\d{3}/g) ?? []).length;
    console.log(`  odds-like patterns: ${oddsMatches}`);

    // Verdict
    let verdict: string;
    if (geoHits.length > 0 && playerHits.length === 0) {
      verdict = "❌ GEOFENCED — page loaded but content blocked";
    } else if (html.length < 5000) {
      verdict = "❌ TINY RESPONSE — likely a block or redirect";
    } else if (playerHits.length === 0 && oddsMatches < 10) {
      verdict = "⚠ NO ODDS DATA — page may not be a futures market page";
    } else if (playerHits.length > 0 && oddsMatches > 10) {
      verdict = "✅ LIKELY HAS DATA — players + odds visible";
    } else {
      verdict = "🤔 AMBIGUOUS — inspect the saved HTML";
    }
    console.log(`  → ${verdict}`);
  } catch (err) {
    console.log(`  ❌ threw: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  const urls = [
    // Multi-player futures-vs-projections pages — what we want most
    "https://www.rotowire.com/betting/nfl/player-futures-plus-proj.php",
    "https://www.rotowire.com/betting/nfl/player-futures.php",
    "https://www.rotowire.com/football/articles/player-futures-passing-yards",
    // RotoWire by stat slug guesses
    "https://www.rotowire.com/betting/nfl/futures/passing-yards.php",
    "https://www.rotowire.com/betting/nfl/futures/rushing-yards.php",
  ];

  for (const url of urls) {
    await probe(url);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
