import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSleeperLeague, getSleeperRosters } from "@/lib/sleeper";
import LeagueConnectClient, {
  type ConnectedLeagueSummary,
} from "./LeagueConnectClient";
import { SLEEPER_ACTIVE_SEASON } from "./constants";

export const metadata: Metadata = {
  title: "Connect Sleeper · FF Council",
  description:
    "Link your Sleeper account so FF Council can pull your league, roster, and league settings automatically.",
};

export default async function LeagueConnectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/league/connect");
  }

  // If they're already linked, prefetch the linked-league summary on the
  // server so the page renders Step 3 immediately on refresh (no flash).
  const { data: member } = await supabase
    .from("council_members")
    .select("sleeper_username, sleeper_user_id, sleeper_league_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let initialConnected: ConnectedLeagueSummary | null = null;
  if (
    member?.sleeper_user_id &&
    member?.sleeper_league_id &&
    typeof member.sleeper_user_id === "string" &&
    typeof member.sleeper_league_id === "string"
  ) {
    const sleeperUserId = member.sleeper_user_id;
    const leagueId = member.sleeper_league_id;
    const [league, rosters] = await Promise.all([
      getSleeperLeague(leagueId),
      getSleeperRosters(leagueId),
    ]);
    if (league) {
      const myRoster = rosters.find((r) => r.owner_id === sleeperUserId);
      initialConnected = {
        leagueId: league.league_id,
        leagueName: league.name,
        season: league.season,
        totalRosters: league.total_rosters,
        rosterPositions: league.roster_positions,
        scoringSummary: summarizeScoring(league.scoring_settings),
        playerCount: myRoster?.players?.length ?? 0,
        sleeperUsername:
          (member.sleeper_username as string | null | undefined) ?? null,
      };
    }
  }

  return (
    <LeagueConnectClient
      season={SLEEPER_ACTIVE_SEASON}
      initialConnected={initialConnected}
    />
  );
}

/**
 * Sleeper scoring is a flat key/value blob (rec: 1.0, pass_td: 4, …).
 * Boil it down to "PPR" / "Half" / "Standard" by looking at the rec key.
 */
function summarizeScoring(settings: Record<string, number>): string {
  const rec = settings?.rec ?? 0;
  if (rec >= 0.9) return "PPR";
  if (rec >= 0.4) return "Half-PPR";
  return "Standard";
}
