/**
 * Fuzzy player matching between external sources (ESPN/Yahoo/etc.) and our
 * SportsDataIO-shaped roster. Strategy:
 *   1. Normalize names (lowercase, strip punctuation, drop suffixes)
 *   2. Try exact match on (name, team)
 *   3. Try exact match on (name) alone — handles trades where teams differ
 *   4. Try last-name + team match — handles initial/nickname variations
 *   5. Fail → caller stashes in platform_rankings_unmapped for manual review
 */

export type RosterPlayer = {
  PlayerID: number;
  Name: string;
  Team: string;
  FantasyPosition?: string;
};

export type ExternalPlayer = {
  name: string;
  team: string | null;
};

export type MatchResult =
  | { matched: true; playerId: number; confidence: "exact" | "name_only" | "lastname_team" }
  | { matched: false };

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/['.,]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam(team: string | null | undefined): string {
  if (!team) return "";
  return team.toUpperCase().trim();
}

function lastName(name: string): string {
  const parts = normalize(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

export class PlayerMatcher {
  private byNameTeam = new Map<string, RosterPlayer>();
  private byName = new Map<string, RosterPlayer[]>();
  private byLastNameTeam = new Map<string, RosterPlayer[]>();

  constructor(roster: RosterPlayer[]) {
    for (const p of roster) {
      const nName = normalize(p.Name);
      const nTeam = normalizeTeam(p.Team);

      this.byNameTeam.set(`${nName}|${nTeam}`, p);

      const namesList = this.byName.get(nName) ?? [];
      namesList.push(p);
      this.byName.set(nName, namesList);

      const lnKey = `${lastName(p.Name)}|${nTeam}`;
      const lnList = this.byLastNameTeam.get(lnKey) ?? [];
      lnList.push(p);
      this.byLastNameTeam.set(lnKey, lnList);
    }
  }

  match(external: ExternalPlayer): MatchResult {
    const nName = normalize(external.name);
    const nTeam = normalizeTeam(external.team);

    // 1. exact (name, team)
    const exact = this.byNameTeam.get(`${nName}|${nTeam}`);
    if (exact) {
      return {
        matched: true,
        playerId: exact.PlayerID,
        confidence: "exact",
      };
    }

    // 2. name alone — but only if unambiguous
    const nameMatches = this.byName.get(nName);
    if (nameMatches && nameMatches.length === 1) {
      return {
        matched: true,
        playerId: nameMatches[0].PlayerID,
        confidence: "name_only",
      };
    }

    // 3. last-name + team — handles "A.J. Brown" vs "AJ Brown" etc.
    if (nTeam) {
      const lnMatches = this.byLastNameTeam.get(`${lastName(external.name)}|${nTeam}`);
      if (lnMatches && lnMatches.length === 1) {
        return {
          matched: true,
          playerId: lnMatches[0].PlayerID,
          confidence: "lastname_team",
        };
      }
    }

    return { matched: false };
  }
}
