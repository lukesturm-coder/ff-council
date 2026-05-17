/**
 * Sleeper API client. Sleeper exposes a free, no-auth public API for any
 * public league. Docs: https://docs.sleeper.com/
 *
 * Endpoints used:
 *   /v1/league/{id}                      — league settings + roster positions
 *   /v1/league/{id}/users                — owners (display_name, avatar)
 *   /v1/league/{id}/rosters              — each team's roster (player_ids)
 *   /v1/players/nfl                      — all NFL players (~5MB, cache!)
 */

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  status: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  settings: Record<string, unknown>;
  sport: string;
};

export type SleeperUser = {
  user_id: string;
  /** Present on /v1/user/{username}; absent on /v1/league/{id}/users responses. */
  username?: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string };
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null; // sleeper player_ids
  starters: string[] | null;
  settings: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
  };
};

export type SleeperPlayer = {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name?: string;
  team: string | null;
  position: string | null;
  fantasy_positions: string[] | null;
  status?: string;
  /** "1998-02-09" or null. We compute age from this. */
  birth_date?: string | null;
  /** Sleeper sometimes also exposes a pre-computed age field. */
  age?: number | null;
  years_exp?: number | null;
};

const BASE = "https://api.sleeper.app/v1";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Sleeper rate limit is generous (1000/min); cache for 60s in the Next.js
    // fetch cache to keep page loads fast.
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Sleeper ${url} → ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchLeague(leagueId: string): Promise<SleeperLeague> {
  return getJson<SleeperLeague>(`${BASE}/league/${leagueId}`);
}

export async function fetchLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  return getJson<SleeperUser[]>(`${BASE}/league/${leagueId}/users`);
}

export async function fetchLeagueRosters(
  leagueId: string,
): Promise<SleeperRoster[]> {
  return getJson<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`);
}

/**
 * Fetch the global NFL player table (~5MB JSON). Sleeper recommends caching
 * this — it updates daily, not per-request. The Next.js `revalidate` keeps
 * one copy hot per server worker for an hour.
 */
export async function fetchAllPlayers(): Promise<
  Record<string, SleeperPlayer>
> {
  const res = await fetch(`${BASE}/players/nfl`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 }, // 1 hour
  });
  if (!res.ok) throw new Error(`Sleeper players → ${res.status}`);
  return (await res.json()) as Record<string, SleeperPlayer>;
}

/**
 * Roughly verify a league ID looks plausible before we hit the API.
 * Sleeper league IDs are 18-19 digit numeric strings.
 */
export function looksLikeSleeperLeagueId(input: string): boolean {
  return /^\d{15,20}$/.test(input.trim());
}

// ---------------------------------------------------------------------------
// Non-throwing convenience wrappers used by the /league/connect flow.
//
// The "fetch* throw on non-2xx" functions above are convenient when failure
// should surface as a 5xx page (the league analyzer). For the connect flow
// we want 404s — "no such Sleeper user" — to render an inline form error,
// so these variants resolve to null / [] on any non-2xx response.
// ---------------------------------------------------------------------------

const CONNECT_REVALIDATE_SECONDS = 600;

async function getJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: CONNECT_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Look up a Sleeper account by username. Returns null if not found. */
export async function getSleeperUser(
  username: string,
): Promise<SleeperUser | null> {
  const trimmed = username.trim();
  if (!trimmed) return null;
  return getJsonOrNull<SleeperUser>(
    `${BASE}/user/${encodeURIComponent(trimmed)}`,
  );
}

/** All NFL leagues this user is in for a given season. Returns [] on error. */
export async function getSleeperLeagues(
  userId: string,
  season: string,
): Promise<SleeperLeague[]> {
  const result = await getJsonOrNull<SleeperLeague[]>(
    `${BASE}/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
  );
  return result ?? [];
}

/** Single-league settings lookup. Null if the league is missing or private. */
export async function getSleeperLeague(
  leagueId: string,
): Promise<SleeperLeague | null> {
  return getJsonOrNull<SleeperLeague>(`${BASE}/league/${leagueId}`);
}

/** Rosters in a league. Returns [] on error. */
export async function getSleeperRosters(
  leagueId: string,
): Promise<SleeperRoster[]> {
  const result = await getJsonOrNull<SleeperRoster[]>(
    `${BASE}/league/${leagueId}/rosters`,
  );
  return result ?? [];
}
