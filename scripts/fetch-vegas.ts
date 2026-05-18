/**
 * Fetch NFL season-long player futures from OddsBlaze, de-vig the
 * Over/Under pairs, and write the result in the SportsDataIO BettingEvent
 * shape that `lib/projections.ts` already consumes. The output drops in
 * wherever `data/futures-mock.json` is read today.
 *
 * Usage:
 *   npm run fetch:vegas
 *
 * Requires ODDSBLAZE_API_KEY in .env.local. We pull from DraftKings since
 * (per the OddsBlaze catalog) they're the only book currently carrying the
 * Regular Season player stat markets in May 2026. If more books open these
 * markets later, the script can be extended to aggregate across books.
 */
import { config } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  fetchFutures,
  pairOverUnderByPlayer,
  type ObFuture,
  type PlayerLine,
} from "../lib/odds-blaze";
import type {
  BettingEvent,
  BettingMarket,
  BettingOutcome,
  FantasyPosition,
  FuturesResponse,
} from "../lib/types";
import type { PlayerRosterEntry } from "../lib/projections";

config({ path: path.join(process.cwd(), ".env.local") });

// OddsBlaze market name → SDIO BettingBetType used downstream. Anything not
// in this map is skipped (we don't currently model sacks, MVP, etc.).
const MARKET_MAP: Record<string, string> = {
  "Regular Season Passing Yards": "Passing Yards",
  "Regular Season Passing Touchdowns": "Passing Touchdowns",
  "Regular Season Rushing Yards": "Rushing Yards",
  "Regular Season Rushing Touchdowns": "Rushing Touchdowns",
  "Regular Season Receiving Yards": "Receiving Yards",
  "Regular Season Receiving Touchdowns": "Receiving Touchdowns",
  "Regular Season Receptions": "Receptions",
};

// Deterministic-ish ID generation so re-runs of the script produce stable
// BettingMarketID / BettingOutcomeID values.
function hashId(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

function toSdioPlayerId(player: PlayerLine["player"]): number | null {
  const sdio = player.mappings?.SportsDataIO?.id;
  if (!sdio) return null;
  const n = Number(sdio);
  return Number.isFinite(n) ? n : null;
}

function toBettingMarket(
  future: ObFuture,
  betType: string,
  playerLine: PlayerLine,
): BettingMarket | null {
  const playerId = toSdioPlayerId(playerLine.player);
  if (playerId == null) return null;

  const marketId = hashId(`${future.id}#${playerLine.player.id}`);
  const over: BettingOutcome = {
    BettingOutcomeID: hashId(`${marketId}#over`),
    BettingMarketID: marketId,
    BettingOutcomeType: "Over",
    PayoutAmerican: Number(playerLine.overPrice),
    Value: playerLine.line,
    Participant: "Over",
    IsAvailable: true,
    IsAlternate: false,
    PlayerID: playerId,
    SportsBook: { SportsbookID: 19, Name: "DraftKings" },
  };
  const under: BettingOutcome = {
    BettingOutcomeID: hashId(`${marketId}#under`),
    BettingMarketID: marketId,
    BettingOutcomeType: "Under",
    PayoutAmerican: Number(playerLine.underPrice),
    Value: playerLine.line,
    Participant: "Under",
    IsAvailable: true,
    IsAlternate: false,
    PlayerID: playerId,
    SportsBook: { SportsbookID: 19, Name: "DraftKings" },
  };
  return {
    BettingMarketID: marketId,
    BettingMarketType: "Player Prop",
    BettingBetType: betType,
    Name: `${playerLine.player.name} ${betType}`,
    PlayerID: playerId,
    PlayerName: playerLine.player.name,
    TeamKey: playerLine.player.team.abbreviation,
    BettingOutcomes: [over, under],
    AvailableSportsbooks: [{ SportsbookID: 19, Name: "DraftKings" }],
  };
}

async function main() {
  const res = await fetchFutures({ sportsbook: "draftkings", league: "nfl" });
  console.log(
    `OddsBlaze returned ${res.futures.length} futures markets for NFL @ DraftKings (updated ${res.updated})`,
  );

  const markets: BettingMarket[] = [];
  let skippedPlayers = 0;
  const breakdown: Record<string, number> = {};
  // Build a player roster as we go — every player that shows up in a
  // futures market gets a roster entry with their real SportsDataIO id +
  // position + team. Output goes to data/players-vegas.json.
  const rosterById = new Map<number, PlayerRosterEntry>();

  for (const future of res.futures) {
    const betType = MARKET_MAP[future.market];
    if (!betType) continue; // not a player-stat market we model

    const lines = pairOverUnderByPlayer(future);
    breakdown[future.market] = lines.length;

    for (const line of lines) {
      const m = toBettingMarket(future, betType, line);
      if (m) {
        markets.push(m);
        const sdio = toSdioPlayerId(line.player);
        const pos = line.player.position as FantasyPosition;
        if (
          sdio != null &&
          !rosterById.has(sdio) &&
          (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE")
        ) {
          rosterById.set(sdio, {
            PlayerID: sdio,
            Name: line.player.name,
            Team: line.player.team.abbreviation,
            FantasyPosition: pos,
          });
        }
      } else {
        skippedPlayers += 1;
      }
    }
  }

  const event: BettingEvent = {
    BettingEventID: 1627,
    Name: "NFL Futures 2026-27 (OddsBlaze)",
    Season: 2026,
    BettingEventType: "Future",
    StartDate: "2026-09-04T20:20:00",
    BettingMarkets: markets,
  };
  const out: FuturesResponse = [event];

  const futuresPath = path.join(process.cwd(), "data", "futures-vegas.json");
  const playersPath = path.join(process.cwd(), "data", "players-vegas.json");
  await fs.writeFile(futuresPath, JSON.stringify(out, null, 2));
  const roster = Array.from(rosterById.values()).sort((a, b) =>
    a.Name.localeCompare(b.Name),
  );
  await fs.writeFile(playersPath, JSON.stringify(roster, null, 2));

  console.log("");
  console.log("Markets per stat type:");
  for (const [k, v] of Object.entries(breakdown)) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }
  console.log("");
  console.log(`Total markets written: ${markets.length}`);
  console.log(`Unique players in roster: ${roster.length}`);
  if (skippedPlayers > 0) {
    console.log(`Skipped ${skippedPlayers} players (no SportsDataIO mapping)`);
  }
  console.log(`→ ${futuresPath}`);
  console.log(`→ ${playersPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
