import { config } from "dotenv";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

config({ path: ".env.local" });

const API_KEY = process.env.SPORTSDATAIO_API_KEY;
const SAMPLES_DIR = join(process.cwd(), "scripts", "api-samples");
const DELAY_MS = 1000;

if (!API_KEY) {
  console.error("❌ SPORTSDATAIO_API_KEY is missing from .env.local");
  console.error("   Add your key to .env.local and re-run `npm run explore`.");
  process.exit(1);
}

type FetchOutcome =
  | { ok: true; status: number; json: unknown; size: number }
  | { ok: false; status: number | "ERROR"; error: string };

type EndpointResult = {
  name: string;
  url: string;
  status: number | "ERROR";
  ok: boolean;
  empty?: boolean;
  savedTo?: string;
  error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawFetch(url: string): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": API_KEY! },
    });
    if (res.status === 200) {
      const json = await res.json();
      const size = Array.isArray(json)
        ? json.length
        : typeof json === "object" && json !== null
          ? Object.keys(json).length
          : 1;
      return { ok: true, status: 200, json, size };
    }
    const body = await res.text();
    const preview = body.length > 500 ? body.slice(0, 500) + "…" : body;
    return { ok: false, status: res.status, error: preview };
  } catch (err) {
    return {
      ok: false,
      status: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function saveSample(name: string, json: unknown): Promise<string> {
  const filepath = join(SAMPLES_DIR, `${name}.json`);
  await writeFile(filepath, JSON.stringify(json, null, 2));
  return filepath;
}

async function fetchEndpoint(
  name: string,
  url: string,
): Promise<EndpointResult> {
  console.log(`\n→ ${name}`);
  console.log(`  GET ${url}`);
  const out = await rawFetch(url);
  if (out.ok) {
    const savedTo = await saveSample(name, out.json);
    const empty = out.size === 0;
    console.log(
      `  status: 200  ✓ saved → scripts/api-samples/${name}.json ` +
        `(${Array.isArray(out.json) ? `array(${out.size})` : typeof out.json})` +
        (empty ? "  ⚠ empty" : ""),
    );
    return { name, url, status: 200, ok: true, empty, savedTo };
  }
  console.log(`  status: ${out.status}  ✗ ${out.error}`);
  return { name, url, status: out.status, ok: false, error: out.error };
}

// Fetch with a fallback to (season - 1) when the current-season response is
// an empty array — useful for endpoints where the upcoming season's data
// isn't published yet (e.g., Schedules in May before the schedule release).
async function fetchWithSeasonFallback(
  name: string,
  buildUrl: (season: number | string) => string,
  primarySeason: number | string,
): Promise<EndpointResult> {
  const primary = await fetchEndpoint(name, buildUrl(primarySeason));
  if (primary.ok && !primary.empty) return primary;

  const fallbackSeason =
    typeof primarySeason === "number"
      ? primarySeason - 1
      : Number(primarySeason) - 1;
  if (Number.isNaN(fallbackSeason)) return primary;

  console.log(
    `  ↻ ${primary.empty ? "empty" : "failed"} for season=${primarySeason}, ` +
      `retrying with season=${fallbackSeason}`,
  );
  await sleep(DELAY_MS);
  return fetchEndpoint(`${name}-${fallbackSeason}`, buildUrl(fallbackSeason));
}

async function main() {
  await mkdir(SAMPLES_DIR, { recursive: true });

  const results: EndpointResult[] = [];

  // 1. Current season — drives the season value for downstream calls.
  const seasonResult = await fetchEndpoint(
    "current-season",
    "https://api.sportsdata.io/v3/nfl/scores/json/CurrentSeason",
  );
  results.push(seasonResult);

  let season: string | number = 2025;
  if (seasonResult.ok && seasonResult.savedTo) {
    try {
      const parsed = JSON.parse(await readFile(seasonResult.savedTo, "utf8"));
      if (typeof parsed === "number") season = parsed;
      else if (parsed && typeof parsed === "object") {
        season = parsed.Season ?? parsed.ApiSeason ?? parsed.season ?? season;
      }
    } catch {
      /* keep fallback */
    }
  }
  console.log(`\nℹ  Using season=${season} for downstream calls`);
  const week = 1;

  type Call = {
    name: string;
    url?: string;
    seasonFallback?: (season: number | string) => string;
  };

  const calls: Call[] = [
    { name: "teams", url: "https://api.sportsdata.io/v3/nfl/scores/json/Teams" },
    { name: "players", url: "https://api.sportsdata.io/v3/nfl/scores/json/Players" },
    {
      name: "schedules",
      seasonFallback: (s) =>
        `https://api.sportsdata.io/v3/nfl/scores/json/Schedules/${s}`,
    },
    {
      name: "player-season-projections",
      seasonFallback: (s) =>
        `https://api.sportsdata.io/v3/nfl/projections/json/PlayerSeasonProjectionStats/${s}`,
    },
    {
      // Note: endpoint is PlayerPropsByWeek, NOT BettingPlayerPropsByWeek.
      // For seasons whose week 1 hasn't happened yet the response is [].
      name: "player-props-by-week",
      seasonFallback: (s) =>
        `https://api.sportsdata.io/v3/nfl/odds/json/PlayerPropsByWeek/${s}/${week}`,
    },
    {
      name: "futures",
      seasonFallback: (s) =>
        `https://api.sportsdata.io/v3/nfl/odds/json/BettingFuturesBySeason/${s}`,
    },
  ];

  for (const call of calls) {
    await sleep(DELAY_MS);
    if (call.url) {
      results.push(await fetchEndpoint(call.name, call.url));
    } else if (call.seasonFallback) {
      results.push(
        await fetchWithSeasonFallback(call.name, call.seasonFallback, season),
      );
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    const tag = r.ok ? (r.empty ? "○" : "✓") : "✗";
    const note = r.empty ? " (empty array)" : "";
    console.log(`  ${tag} [${r.status}] ${r.name}${note}`);
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n  ${okCount}/${results.length} endpoints succeeded`);
  console.log(`  Samples saved in: scripts/api-samples/`);
}

main().catch((err) => {
  console.error("Unexpected fatal error:", err);
  process.exit(1);
});
