// Subset of the SportsDataIO BettingFuturesBySeason response that FF Council
// actually consumes. Fields kept loose (lots of optionals) so the same types
// describe both the mock data and the real (paid-tier) API response.

export type Sportsbook = {
  SportsbookID: number;
  Name: string;
};

export type BettingOutcome = {
  BettingOutcomeID: number;
  BettingMarketID: number;
  BettingOutcomeType?: string | null;
  /** American odds, e.g. -110 (favorite) or +150 (underdog) */
  PayoutAmerican: number;
  PayoutDecimal?: number | null;
  /** The line for Over/Under markets, or null for moneyline-style outcomes */
  Value: number | null;
  /** "Over" / "Under" for O/U markets; otherwise the participant name */
  Participant: string;
  IsAvailable?: boolean;
  IsAlternate?: boolean;
  PlayerID?: number | null;
  TeamID?: number | null;
  SportsBook?: Sportsbook;
};

export type BettingMarket = {
  BettingMarketID: number;
  BettingMarketType: string; // e.g. "Player Prop"
  /** The stat being bet on: "Passing Yards", "Rushing Yards", "Receptions", etc. */
  BettingBetType: string;
  Name: string | null;
  PlayerID: number | null;
  PlayerName: string | null;
  TeamKey: string | null;
  TeamID?: number | null;
  BettingOutcomes: BettingOutcome[];
  AvailableSportsbooks?: Sportsbook[];
};

export type BettingEvent = {
  BettingEventID: number;
  Name: string;
  Season: number;
  BettingEventType: string;
  StartDate?: string;
  BettingMarkets: BettingMarket[];
};

export type FuturesResponse = BettingEvent[];

// ---- FF Council domain types (downstream of the SportsDataIO shape) ----

export type ScoringSystem = "PPR" | "Half" | "Standard";

export type FantasyPosition = "QB" | "RB" | "WR" | "TE";

/** Stat means implied by the betting markets for one player, in season totals. */
export type ImpliedStats = {
  passingYards?: number;
  passingTouchdowns?: number;
  interceptions?: number;
  rushingYards?: number;
  rushingTouchdowns?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTouchdowns?: number;
};

/** One betting market's contribution to a player's projection. */
export type MarketContribution = {
  betType: string;
  line: number;
  overPayout: number;
  underPayout: number;
};

export type PlayerProjection = {
  playerId: number;
  name: string;
  team: string;
  position: FantasyPosition;
  /** Consensus ADP (Standard) — present when /Players supplied it */
  adp?: number;
  adpPPR?: number;
  impliedStats: ImpliedStats;
  /** Fantasy points by scoring system, season total */
  fantasyPoints: Record<ScoringSystem, number>;
  /**
   * Value-Based Drafting score: FPts above replacement-level player at the same
   * position, per scoring system. Replacement thresholds reflect a 12-team
   * league: QB12, RB24, WR30, TE12. This is the metric you actually want to
   * sort by for drafting — accounts for positional scarcity.
   */
  vbd: Record<ScoringSystem, number>;
  /** All markets that fed this player's projection, for the expand-on-click view */
  markets: MarketContribution[];
};

/** Replacement-level FPts at each position, per scoring system. */
export type ReplacementLevels = Record<
  FantasyPosition,
  Record<ScoringSystem, number>
>;
