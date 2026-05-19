/**
 * Expand data/players-mock.json from ~80 players to ~300 by pulling from
 * Sleeper's free public player metadata + ADP CSV.
 *
 *   npx tsx scripts/expand-roster.ts
 *
 * Strategy:
 *   1. Load the existing roster (synthetic IDs 30001-30080).
 *   2. Fetch Sleeper's full player directory (/v1/players/nfl, ~5MB) and the
 *      regular-season ADP CSV (try current year first, fall back to prior).
 *   3. Build a candidate list of QB/RB/WR/TE players ranked by PPR ADP (best
 *      first); skip kickers/defenses (different ID schemes).
 *   4. For each candidate not already in the roster (matched by normalized
 *      name + team via lib/player-matching), append a synthetic-ID entry.
 *   5. Stop once total roster reaches TARGET_SIZE (~300). Sort by PlayerID and
 *      write back.
 *
 * Idempotent: re-running won't duplicate; the matcher rejects existing rows.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PlayerMatcher, type RosterPlayer } from "@/lib/player-matching";

const SLEEPER_BASE = "https://api.sleeper.app";
const TARGET_SIZE = 300;
const ALLOWED_POS = new Set(["QB", "RB", "WR", "TE"]);

type SleeperPlayer = {
  player_id: string;
  full_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  team?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  status?: string | null;
};

type AdpRow = {
  player_id: string;
  player: string;
  team: string;
  position: string;
  ppr?: number;
  std?: number;
  half_ppr?: number;
};

// Mirrors scripts/fetch-sleeper-adp.ts parseCsv — handles quoted commas.
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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchAdp(season: number): Promise<AdpRow[]> {
  const url = `${SLEEPER_BASE}/players/nfl/adp_csv/regular/${season}`;
  const res = await fetch(url, {
    headers: {
      Accept: "text/csv,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`Sleeper ADP ${season} → ${res.status}`);
  }
  const text = await res.text();
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error(`Sleeper ADP ${season}: empty CSV`);
  const header = parsed[0];
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    idx[h.trim()] = i;
  });
  const numOrUndef = (row: string[], col: string): number | undefined => {
    const raw = row[idx[col]];
    if (!raw || !raw.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const out: AdpRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const r = parsed[i];
    if (r.length < 4 || !r[idx.player_id]) continue;
    out.push({
      player_id: r[idx.player_id].trim(),
      player: (r[idx.player] ?? "").trim(),
      team: (r[idx.team] ?? "").trim(),
      position: (r[idx.position] ?? "").trim(),
      ppr: numOrUndef(r, "ppr"),
      std: numOrUndef(r, "std"),
      half_ppr: numOrUndef(r, "half_ppr"),
    });
  }
  return out;
}

async function fetchPlayerDirectory(): Promise<
  Record<string, SleeperPlayer>
> {
  const res = await fetch(`${SLEEPER_BASE}/v1/players/nfl`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Sleeper /v1/players/nfl → ${res.status}`);
  return (await res.json()) as Record<string, SleeperPlayer>;
}

async function fetchAdpWithRetry(season: number): Promise<AdpRow[]> {
  try {
    return await fetchAdp(season);
  } catch (err) {
    console.log(
      `  Retry after error: ${err instanceof Error ? err.message : String(err)}`,
    );
    await new Promise((r) => setTimeout(r, 2000));
    return fetchAdp(season);
  }
}

// Full RosterPlayer entry as used by data/players-mock.json. The fetch scripts
// only require PlayerID/Name/Team/FantasyPosition, but we keep the existing
// schema so the JSON stays consistent with the original 80 rows.
type RosterRow = {
  PlayerID: number;
  Team: string;
  FirstName: string;
  LastName: string;
  Name: string;
  Position: string;
  FantasyPosition: string;
  Status: string;
  Active: boolean;
  AverageDraftPosition?: number;
  AverageDraftPositionPPR?: number;
};

function fantasyPosOf(p: SleeperPlayer): string | null {
  // Prefer fantasy_positions[0] (e.g. "WR" for a slot receiver listed as WR);
  // fall back to position.
  if (p.fantasy_positions && p.fantasy_positions.length > 0) {
    return p.fantasy_positions[0];
  }
  return p.position ?? null;
}

function fullNameOf(p: SleeperPlayer): string | null {
  if (p.full_name && p.full_name.trim()) return p.full_name.trim();
  if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
  return null;
}

async function main() {
  const rosterPath = path.join(process.cwd(), "data", "players-mock.json");
  const raw = await fs.readFile(rosterPath, "utf8");
  const roster = JSON.parse(raw) as RosterRow[];
  console.log(`→ Loaded existing roster: ${roster.length} players`);

  if (roster.length >= TARGET_SIZE) {
    console.log(
      `  Roster already at/above target (${TARGET_SIZE}); nothing to do.`,
    );
    return;
  }

  const seasons = [new Date().getFullYear(), new Date().getFullYear() - 1];
  let adp: AdpRow[] = [];
  let usedSeason = 0;
  for (const s of seasons) {
    try {
      console.log(`→ Fetching Sleeper ADP CSV for season ${s}…`);
      const rows = await fetchAdpWithRetry(s);
      const withPpr = rows.filter((r) => r.ppr != null);
      console.log(
        `  Got ${rows.length} rows; ${withPpr.length} have PPR ADP`,
      );
      if (withPpr.length > 0) {
        adp = rows;
        usedSeason = s;
        break;
      }
    } catch (err) {
      console.log(
        `  Season ${s} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (adp.length === 0) {
    throw new Error("No usable Sleeper ADP data");
  }
  console.log(`  Using ADP from season ${usedSeason}`);

  console.log(`→ Fetching Sleeper player directory (~5MB)…`);
  const dir = await fetchPlayerDirectory();
  console.log(`  Loaded ${Object.keys(dir).length} player metadata records`);

  // Rank candidates by PPR ADP ascending. Filter to QB/RB/WR/TE.
  type Candidate = {
    sleeperId: string;
    fullName: string;
    team: string;
    fantasyPos: string;
    ppr: number;
    std?: number;
    half_ppr?: number;
  };
  const candidates: Candidate[] = [];
  for (const r of adp) {
    if (r.ppr == null) continue;
    const meta = dir[r.player_id];
    const fp = (meta ? fantasyPosOf(meta) : r.position) ?? r.position;
    if (!fp || !ALLOWED_POS.has(fp)) continue;
    const name = (meta ? fullNameOf(meta) : null) ?? r.player;
    if (!name) continue;
    const team = (meta?.team ?? r.team) || "FA";
    candidates.push({
      sleeperId: r.player_id,
      fullName: name,
      team,
      fantasyPos: fp,
      ppr: r.ppr,
      std: r.std,
      half_ppr: r.half_ppr,
    });
  }
  candidates.sort((a, b) => a.ppr - b.ppr);
  console.log(
    `  Built ${candidates.length} QB/RB/WR/TE candidates ranked by PPR ADP`,
  );

  // Build matcher off existing roster — we re-build after each insert so a
  // newly-added candidate doesn't get re-added by a fuzzy variant downstream.
  let matcher = new PlayerMatcher(roster as unknown as RosterPlayer[]);
  let nextId = roster.reduce((m, p) => Math.max(m, p.PlayerID), 30000) + 1;
  const added: RosterRow[] = [];
  const sampleNames: string[] = [];

  for (const c of candidates) {
    if (roster.length + added.length >= TARGET_SIZE) break;
    const match = matcher.match({ name: c.fullName, team: c.team });
    if (match.matched) continue;

    // Split name for FirstName/LastName fields.
    const parts = c.fullName.split(/\s+/);
    const firstName = parts.shift() ?? c.fullName;
    const lastName = parts.join(" ") || firstName;

    const row: RosterRow = {
      PlayerID: nextId++,
      Team: c.team,
      FirstName: firstName,
      LastName: lastName,
      Name: c.fullName,
      Position: c.fantasyPos,
      FantasyPosition: c.fantasyPos,
      Status: "Active",
      Active: true,
      AverageDraftPosition: c.std ?? c.ppr,
      AverageDraftPositionPPR: c.ppr,
    };
    added.push(row);
    if (sampleNames.length < 5) {
      sampleNames.push(`${c.fullName} (${c.team}, ${c.fantasyPos})`);
    }
    // Re-seed matcher with the new entry so subsequent fuzzy hits skip it.
    matcher = new PlayerMatcher([
      ...(roster as unknown as RosterPlayer[]),
      ...(added as unknown as RosterPlayer[]),
    ]);
  }

  const merged = [...roster, ...added].sort(
    (a, b) => a.PlayerID - b.PlayerID,
  );

  await fs.writeFile(
    rosterPath,
    JSON.stringify(merged, null, 2) + "\n",
    "utf8",
  );

  console.log(
    `\n✅ Added ${added.length} players. Roster: ${roster.length} → ${merged.length}`,
  );
  if (sampleNames.length > 0) {
    console.log(`   Samples: ${sampleNames.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
