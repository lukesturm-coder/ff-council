"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getSleeperLeague,
  getSleeperLeagues,
  getSleeperUser,
} from "@/lib/sleeper";
import {
  SLEEPER_ACTIVE_SEASON,
  type LinkResult,
  type LookupResult,
} from "./constants";

/**
 * Step 1 of /league/connect: take a Sleeper username, return the matching
 * Sleeper account + their leagues for the current season. Returns a tagged
 * union so the client can render inline errors without throwing.
 */
export async function lookupSleeperUser(
  username: string,
): Promise<LookupResult> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a Sleeper username." };
  }

  const user = await getSleeperUser(trimmed);
  if (!user) {
    return {
      ok: false,
      error: `No Sleeper account named "${trimmed}". Double-check the spelling.`,
    };
  }

  const leagues = await getSleeperLeagues(user.user_id, SLEEPER_ACTIVE_SEASON);
  return { ok: true, user, leagues };
}

/**
 * Step 2 of /league/connect: persist the chosen Sleeper user + league to
 * the signed-in member's council_members row. We re-look up the user to
 * stash the canonical username (since the form only carries the user_id).
 */
export async function linkSleeperLeague(
  sleeperUserId: string,
  leagueId: string,
): Promise<LinkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You need to sign in first." };
  }

  if (!sleeperUserId || !leagueId) {
    return { ok: false, error: "Missing Sleeper user or league." };
  }

  // Validate the league actually exists and belongs to this Sleeper user.
  // (Cheap sanity check — keeps random IDs out of the DB.)
  const league = await getSleeperLeague(leagueId);
  if (!league) {
    return {
      ok: false,
      error: "Couldn't load that league from Sleeper. Try again?",
    };
  }

  // Re-fetch the user record so we can store the canonical username.
  const leagues = await getSleeperLeagues(
    sleeperUserId,
    SLEEPER_ACTIVE_SEASON,
  );
  const inThisLeague = leagues.some((l) => l.league_id === leagueId);
  if (!inThisLeague) {
    return {
      ok: false,
      error: "That league isn't on the selected Sleeper account.",
    };
  }

  // We don't have username from the league endpoints; pull it back from
  // /league/{id}/users so we can persist a human-readable handle. Fall
  // back to display_name if username is somehow blank.
  const usersInLeague = await fetch(
    `https://api.sleeper.app/v1/league/${leagueId}/users`,
    { next: { revalidate: 600 } },
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const me = Array.isArray(usersInLeague)
    ? (usersInLeague as Array<{
        user_id: string;
        username?: string;
        display_name?: string;
      }>).find((u) => u.user_id === sleeperUserId)
    : undefined;
  const username = me?.username ?? me?.display_name ?? null;

  const { error } = await supabase
    .from("council_members")
    .update({
      sleeper_username: username,
      sleeper_user_id: sleeperUserId,
      sleeper_league_id: leagueId,
    })
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  // Invalidate pages that read the linked league.
  revalidatePath("/league/connect");
  revalidatePath("/me");
  revalidatePath("/league");

  return { ok: true };
}
