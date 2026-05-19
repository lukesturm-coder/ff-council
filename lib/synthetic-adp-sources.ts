/**
 * Source registry for the ADP-over-time chart on /player/[playerId].
 *
 * Colors mirror the existing source palette used throughout the app
 * (RankingsTable, source comparison chart) so users get a consistent
 * mental model: Council = emerald, Vegas = amber, ESPN = red, etc.
 */

export type SyntheticAdpSource =
  | "council"
  | "vegas"
  | "espn"
  | "fantasypros"
  | "sleeper"
  | "nfl"
  | "cbs"
  | "yahoo";

export type AdpSourceMeta = {
  key: SyntheticAdpSource;
  label: string;
  /** Hex color matching the Tailwind shade used elsewhere in the app. */
  color: string;
  /** Default visibility on first paint. */
  defaultVisible: boolean;
};

// Hex equivalents of Tailwind 400-weight shades, picked to match the rest
// of the app's source palette (RankingsTable, SourceComparisonChart).
export const ADP_SOURCES: AdpSourceMeta[] = [
  { key: "council", label: "Council", color: "#34d399", defaultVisible: true },
  { key: "vegas", label: "Vegas", color: "#fbbf24", defaultVisible: true },
  { key: "espn", label: "ESPN", color: "#f87171", defaultVisible: true },
  { key: "fantasypros", label: "FantasyPros", color: "#2dd4bf", defaultVisible: false },
  { key: "sleeper", label: "Sleeper", color: "#22d3ee", defaultVisible: false },
  { key: "nfl", label: "NFL", color: "#60a5fa", defaultVisible: false },
  { key: "cbs", label: "CBS", color: "#818cf8", defaultVisible: false },
  { key: "yahoo", label: "Yahoo", color: "#c084fc", defaultVisible: false },
];
