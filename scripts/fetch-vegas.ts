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

// Books to pull from. OddsBlaze covers DraftKings + FanDuel for the
// season-long player stat markets; other books are not yet listing them.
// FanDuel carries Pass Yds / Pass TDs / Rec Yds but NOT Rush Yds — so for
// rush-yard markets the average effectively equals the DK line.
const BOOKS: Array<{ id: string; name: string; sportsbookId: number }> = [
  { id: "draftkings", name: "DraftKings", sportsbookId: 19 },
  { id: "fanduel", name: "FanDuel", sportsbookId: 18 },
];

type BookLine = {
  bookName: string;
  bookId: number;
  line: number;
  overPrice: string;
  underPrice: string;
};

async function main() {
  // Pull every book in parallel and bucket lines by (sdioPlayerId, betType).
  const responses = await Promise.all(
    BOOKS.map(async (b) => ({
      book: b,
      res: await fetchFutures({ sportsbook: b.id, league: "nfl" }),
    })),
  );
  for (const { book, res } of responses) {
    console.log(
      `OddsBlaze ${book.name}: ${res.futures.length} futures markets (updated ${res.updated})`,
    );
  }

  // Collect every book's line for each (player, betType) combo.
  type Bucket = {
    player: PlayerLine["player"];
    betType: string;
    lines: BookLine[];
  };
  const buckets = new Map<string, Bucket>(); // key = sdioId#betType
  const rosterById = new Map<number, PlayerRosterEntry>();
  const breakdown: Record<string, number> = {};
  let skippedPlayers = 0;

  for (const { book, res } of responses) {
    for (const future of res.futures) {
      const betType = MARKET_MAP[future.market];
      if (!betType) continue;

      const lines = pairOverUnderByPlayer(future);
      breakdown[future.market] = (breakdown[future.market] ?? 0) + lines.length;

      for (const line of lines) {
        const sdio = toSdioPlayerId(line.player);
        if (sdio == null) {
          skippedPlayers += 1;
          continue;
        }
        const key = `${sdio}#${betType}`;
        const bucket =
          buckets.get(key) ??
          ({ player: line.player, betType, lines: [] } as Bucket);
        bucket.lines.push({
          bookName: book.name,
          bookId: book.sportsbookId,
          line: line.line,
          overPrice: line.overPrice,
          underPrice: line.underPrice,
        });
        buckets.set(key, bucket);

        const pos = line.player.position as FantasyPosition;
        if (
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
      }
    }
  }

  // For each bucket, average the line + prices across the books that have
  // it. One BettingMarket per (player, betType); AvailableSportsbooks lists
  // every contributing book.
  const markets: BettingMarket[] = [];
  const coverageCounts = { both: 0, dkOnly: 0, fdOnly: 0 };

  for (const [, bucket] of Array.from(buckets.entries())) {
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const avgLine = avg(bucket.lines.map((l) => l.line));
    const avgOverPrice = Math.round(avg(bucket.lines.map((l) => Number(l.overPrice))));
    const avgUnderPrice = Math.round(avg(bucket.lines.map((l) => Number(l.underPrice))));

    const playerId = toSdioPlayerId(bucket.player)!;
    const marketId = hashId(`${playerId}#${bucket.betType}`);
    const contributingBooks = bucket.lines.map((l) => ({
      SportsbookID: l.bookId,
      Name: l.bookName,
    }));

    if (bucket.lines.length === 2) coverageCounts.both += 1;
    else if (bucket.lines[0].bookName === "DraftKings") coverageCounts.dkOnly += 1;
    else coverageCounts.fdOnly += 1;

    const over: BettingOutcome = {
      BettingOutcomeID: hashId(`${marketId}#over`),
      BettingMarketID: marketId,
      BettingOutcomeType: "Over",
      PayoutAmerican: avgOverPrice,
      Value: avgLine,
      Participant: "Over",
      IsAvailable: true,
      IsAlternate: false,
      PlayerID: playerId,
      SportsBook: contributingBooks[0],
    };
    const under: BettingOutcome = {
      BettingOutcomeID: hashId(`${marketId}#under`),
      BettingMarketID: marketId,
      BettingOutcomeType: "Under",
      PayoutAmerican: avgUnderPrice,
      Value: avgLine,
      Participant: "Under",
      IsAvailable: true,
      IsAlternate: false,
      PlayerID: playerId,
      SportsBook: contributingBooks[0],
    };
    markets.push({
      BettingMarketID: marketId,
      BettingMarketType: "Player Prop",
      BettingBetType: bucket.betType,
      Name: `${bucket.player.name} ${bucket.betType}`,
      PlayerID: playerId,
      PlayerName: bucket.player.name,
      TeamKey: bucket.player.team.abbreviation,
      BettingOutcomes: [over, under],
      AvailableSportsbooks: contributingBooks,
    });
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
  console.log("Markets per stat type (summed across books):");
  for (const [k, v] of Object.entries(breakdown)) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }
  console.log("");
  console.log(`Unique (player, market) combos: ${markets.length}`);
  console.log(`  Both books:    ${coverageCounts.both}`);
  console.log(`  DraftKings only: ${coverageCounts.dkOnly}`);
  console.log(`  FanDuel only:    ${coverageCounts.fdOnly}`);
  console.log(`Unique players in roster: ${roster.length}`);
  if (skippedPlayers > 0) {
    console.log(`Skipped ${skippedPlayers} odds rows (no SportsDataIO mapping)`);
  }
  console.log(`→ ${futuresPath}`);
  console.log(`→ ${playersPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
