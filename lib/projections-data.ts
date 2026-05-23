import { promises as fs } from "node:fs";
import path from "node:path";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type { FuturesResponse, ImpliedStats, PlayerProjection } from "@/lib/types";

/**
 * Canonical ranking projections — every roster player, with their Vegas-derived
 * fantasy points where we have a market and a stub (zeros) where we don't.
 *
 * Strategy: build the Vegas projections off the SDIO-keyed Vegas roster (which
 * matches futures-vegas.json), then remap them onto the mock roster's synthetic
 * ids via name+team lookup. Mock players without a Vegas match get a stub so
 * they still appear (their Vegas column reads `—` per the "dashes, not hiding"
 * rule). Shared by the rankings page and the home trending board so both rank
 * players identically.
 */
export async function loadRankingProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [vegasFuturesRaw, vegasRosterRaw, mockRosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-vegas.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-vegas.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(vegasFuturesRaw);
  const vegasRoster: PlayerRosterEntry[] = JSON.parse(vegasRosterRaw);
  const mockRoster: PlayerRosterEntry[] = JSON.parse(mockRosterRaw);

  const vegasProjections = projectionsFromFutures(futures, vegasRoster);

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sdioByKey = new Map<string, number>();
  for (const p of vegasRoster) {
    sdioByKey.set(`${norm(p.Name)}|${norm(p.Team)}`, p.PlayerID);
    if (!sdioByKey.has(norm(p.Name))) sdioByKey.set(norm(p.Name), p.PlayerID);
  }
  const projBySdio = new Map(vegasProjections.map((p) => [p.playerId, p]));

  return mockRoster.map((mock) => {
    const sdio =
      sdioByKey.get(`${norm(mock.Name)}|${norm(mock.Team)}`) ??
      sdioByKey.get(norm(mock.Name)) ??
      null;
    const vegas = sdio != null ? projBySdio.get(sdio) ?? null : null;
    if (vegas) {
      return {
        ...vegas,
        playerId: mock.PlayerID,
        name: mock.Name,
        team: mock.Team,
        adp: mock.AverageDraftPosition,
        adpPPR: mock.AverageDraftPositionPPR,
      };
    }
    return {
      playerId: mock.PlayerID,
      name: mock.Name,
      team: mock.Team,
      position: mock.FantasyPosition,
      adp: mock.AverageDraftPosition,
      adpPPR: mock.AverageDraftPositionPPR,
      impliedStats: {},
      fantasyPoints: { PPR: 0, Half: 0, Standard: 0 },
      markets: [],
      vbd: { PPR: 0, Half: 0, Standard: 0 },
    };
  });
}

/**
 * Projected per-player stat means (receptions, yards, TDs, …) keyed by the same
 * mock PlayerID the rankings table uses. Built from the full mock futures set so
 * every player has a projected stat line for the expand-on-click view, even when
 * the sparse offseason Vegas markets don't yet cover them. Real Vegas implied
 * stats (on the player's own projection) take precedence in the UI; this is the
 * fallback so the line is never empty.
 */
export async function loadProjectedStats(): Promise<Record<number, ImpliedStats>> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  const out: Record<number, ImpliedStats> = {};
  for (const p of projectionsFromFutures(futures, roster)) {
    out[p.playerId] = p.impliedStats;
  }
  return out;
}
