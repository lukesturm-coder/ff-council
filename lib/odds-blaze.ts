/**
 * OddsBlaze API client — pulls sportsbook futures markets.
 *
 * Endpoints used:
 *   - https://futures.oddsblaze.com/?key=…&sportsbook=…&league=…
 *     Returns season-long futures (player props + outrights) for one book/league.
 *   - https://active.futures.markets.oddsblaze.com/?key=…
 *     Catalog endpoint — lists which markets are currently active by league.
 *
 * Auth: query-string `key` param. We read from `process.env.ODDSBLAZE_API_KEY`.
 *
 * Rate limit on the entry plan: 30 req/min. Our scripted fetch hits the API
 * once per (sportsbook, league) so we stay well under.
 */

const FUTURES_BASE = "https://futures.oddsblaze.com/";
const CATALOG_BASE = "https://active.futures.markets.oddsblaze.com/";

export type ObTeam = {
  id: string;
  name: string;
  abbreviation: string;
};

export type ObPlayer = {
  id: string;
  name: string;
  position: string;
  number?: string;
  team: ObTeam;
  mappings?: {
    SportsDataIO?: { id: string };
    [key: string]: { id: string } | undefined;
  };
};

export type ObFutureOdd = {
  id: string;
  /** Outcome description, e.g. "Matthew Stafford Over 3999.5". Line is embedded — see parseOverUnder. */
  name: string;
  /** American price as a string, e.g. "-110" or "+100". */
  price: string;
  /** Present on player markets; absent on outrights like "Buffalo Bills" for AFC East Winner. */
  player?: ObPlayer;
  links?: { desktop?: string; mobile?: string };
};

export type ObFuture = {
  /** Market id, e.g. "nfl-regular-season-passing-yards". */
  id: string;
  /** Human-readable market, e.g. "Regular Season Passing Yards". */
  market: string;
  date: string;
  live: boolean;
  odds: ObFutureOdd[];
};

export type ObFuturesResponse = {
  updated: string;
  league: { id: string; name: string; sport: string };
  sportsbook: { id: string; name: string };
  futures: ObFuture[];
};

export type ObCatalogMarket = {
  id: string;
  name: string;
  sportsbooks: string[];
};

export type ObCatalogResponse = {
  updated: string;
  leagues: Array<{
    id: string;
    name: string;
    sport: string;
    markets: ObCatalogMarket[];
  }>;
};

function getKey(): string {
  const k = process.env.ODDSBLAZE_API_KEY;
  if (!k) throw new Error("ODDSBLAZE_API_KEY not set in .env.local");
  return k;
}

export async function fetchFutures(opts: {
  sportsbook: string;
  league: string;
  /** Optional market id filter (from the catalog). */
  market?: string;
}): Promise<ObFuturesResponse> {
  const url = new URL(FUTURES_BASE);
  url.searchParams.set("key", getKey());
  url.searchParams.set("sportsbook", opts.sportsbook);
  url.searchParams.set("league", opts.league);
  if (opts.market) url.searchParams.set("market", opts.market);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `OddsBlaze futures ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  return res.json();
}

export async function fetchCatalog(): Promise<ObCatalogResponse> {
  const url = new URL(CATALOG_BASE);
  url.searchParams.set("key", getKey());
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`OddsBlaze catalog ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Helpers — pricing math + line parsing
// ---------------------------------------------------------------------------

/** Convert an American price string ("-110", "+100") to implied probability. */
export function americanToImpliedProb(price: string): number {
  const n = Number(price);
  if (!Number.isFinite(n)) throw new Error(`bad price: ${price}`);
  if (n < 0) return -n / (-n + 100);
  return 100 / (n + 100);
}

/**
 * De-vig an Over/Under pair. Returns the fair probability the over hits
 * once the book's juice is removed. For a symmetric two-way market this
 * also implies the fair line equals the posted line.
 */
export function devigOverUnder(overPrice: string, underPrice: string): number {
  const pO = americanToImpliedProb(overPrice);
  const pU = americanToImpliedProb(underPrice);
  const sum = pO + pU;
  if (sum <= 0) return 0.5;
  return pO / sum;
}

/** Parse "Matthew Stafford Over 3999.5" → { name, side: "Over", line: 3999.5 }. */
export function parseOverUnder(
  name: string,
): { playerName: string; side: "Over" | "Under"; line: number } | null {
  const m = name.match(/^(.+?)\s+(Over|Under)\s+([\d.]+)\s*$/i);
  if (!m) return null;
  const side = m[2].toLowerCase() === "over" ? "Over" : "Under";
  const line = Number(m[3]);
  if (!Number.isFinite(line)) return null;
  return { playerName: m[1].trim(), side, line };
}

/**
 * Group a market's odds by player and pair Over/Under. Returns one entry
 * per player with both prices + the line.
 */
export type PlayerLine = {
  player: ObPlayer;
  line: number;
  overPrice: string;
  underPrice: string;
  /** Fair probability of the over hitting after de-vig. */
  fairOverProb: number;
};

export function pairOverUnderByPlayer(future: ObFuture): PlayerLine[] {
  type Half = { over?: ObFutureOdd; under?: ObFutureOdd; line?: number };
  const by = new Map<string, Half>(); // keyed by player id

  for (const o of future.odds) {
    if (!o.player) continue;
    const parsed = parseOverUnder(o.name);
    if (!parsed) continue;
    const h = by.get(o.player.id) ?? {};
    if (parsed.side === "Over") h.over = o;
    else h.under = o;
    h.line = parsed.line;
    by.set(o.player.id, h);
  }

  const out: PlayerLine[] = [];
  Array.from(by.values()).forEach((h) => {
    if (!h.over || !h.under || h.line == null) return;
    out.push({
      player: h.over.player!,
      line: h.line,
      overPrice: h.over.price,
      underPrice: h.under.price,
      fairOverProb: devigOverUnder(h.over.price, h.under.price),
    });
  });
  return out;
}
