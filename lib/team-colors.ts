// Muted, premium NFL team color map for charting player trend lines on near-black (#0a0a0a) backgrounds.

export const TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  ARI: { primary: "#c25b6e", secondary: "#d4b06a" }, // cardinal red / muted gold
  ATL: { primary: "#c45563", secondary: "#9aa0a6" }, // falcon red / silver
  BAL: { primary: "#7c6bb0", secondary: "#c2a45a" }, // muted purple / gold
  BUF: { primary: "#5b7fb5", secondary: "#c2606e" }, // steel royal / red
  CAR: { primary: "#4f9fc4", secondary: "#9aa0a6" }, // panther blue / silver
  CHI: { primary: "#a8623f", secondary: "#5a6b86" }, // navy-orange / steel navy
  CIN: { primary: "#cc7a45", secondary: "#8a8d92" }, // bengal orange / charcoal
  CLE: { primary: "#b56a40", secondary: "#7a5a40" }, // browns orange / brown
  DAL: { primary: "#5a6b86", secondary: "#9aa0a6" }, // steel navy / silver
  DEN: { primary: "#cc7340", secondary: "#5a6b86" }, // broncos orange / navy
  DET: { primary: "#5e8fc4", secondary: "#a7adb5" }, // honolulu blue / silver
  GB:  { primary: "#5f9479", secondary: "#c2a85a" }, // muted green / gold
  HOU: { primary: "#5a6b86", secondary: "#c25b6e" }, // deep steel navy / red
  IND: { primary: "#5b7fb5", secondary: "#9aa0a6" }, // colts blue / silver
  JAX: { primary: "#4f9fa8", secondary: "#c2a45a" }, // muted teal / gold
  KC:  { primary: "#c45563", secondary: "#d4b06a" }, // chiefs red / gold
  LAC: { primary: "#5fa3c0", secondary: "#d4b06a" }, // powder blue / gold
  LAR: { primary: "#5b7fb5", secondary: "#c2a45a" }, // rams blue / gold
  LV:  { primary: "#9aa0a6", secondary: "#7d8288" }, // silver / charcoal
  MIA: { primary: "#4faaa6", secondary: "#cc8a52" }, // aqua / orange
  MIN: { primary: "#8770b3", secondary: "#c2a85a" }, // muted purple / gold
  NE:  { primary: "#5a6b86", secondary: "#c2606e" }, // patriots navy / red
  NO:  { primary: "#c2a45a", secondary: "#8a8d92" }, // muted gold / charcoal
  NYG: { primary: "#5b7fb5", secondary: "#c2606e" }, // giants blue / red
  NYJ: { primary: "#5f9479", secondary: "#9aa0a6" }, // jets green / silver
  PHI: { primary: "#4f8278", secondary: "#a7adb5" }, // midnight green / silver
  PIT: { primary: "#cdb15c", secondary: "#8a8d92" }, // steeler gold / charcoal
  SEA: { primary: "#5e8fc4", secondary: "#7faa6a" }, // college navy-blue / action green
  SF:  { primary: "#c25b5b", secondary: "#c2a45a" }, // 49ers red / gold
  TB:  { primary: "#c2604f", secondary: "#8a7a4a" }, // buccaneer red / pewter
  TEN: { primary: "#5fa3c0", secondary: "#5a6b86" }, // titans blue / navy
  WAS: { primary: "#9a5a4f", secondary: "#c2a45a" }, // burgundy / gold
};

export const DEFAULT_TEAM_COLOR: { primary: string; secondary: string } = {
  primary: "#8a8f96",
  secondary: "#5c6066",
};

function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Assign each player a chart color from their NFL team: first player from a team
 * gets the team primary, a second from the same team gets the secondary, and
 * further same-team players get a progressively lightened tone so lines stay
 * distinct. Returns a playerId → hex map.
 */
export function assignTeamColors(
  players: Array<{ playerId: number; team: string }>,
): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const p of players) {
    const tc = TEAM_COLORS[p.team] ?? DEFAULT_TEAM_COLOR;
    const n = seen.get(p.team) ?? 0;
    seen.set(p.team, n + 1);
    const color =
      n === 0 ? tc.primary : n === 1 ? tc.secondary : lighten(tc.primary, 0.18 * (n - 1));
    out.set(p.playerId, color);
  }
  return out;
}
