import type { SleeperLeague, SleeperUser } from "@/lib/sleeper";

/**
 * The active NFL season FF Council points the Sleeper sync at. Bump this
 * each spring when leagues redraft. Lives in a non-"use server" file so it
 * can be imported by both server actions and client components (server
 * actions files can only export async functions).
 */
export const SLEEPER_ACTIVE_SEASON = "2026";

export type LookupResult =
  | { ok: true; user: SleeperUser; leagues: SleeperLeague[] }
  | { ok: false; error: string };

export type LinkResult = { ok: true } | { ok: false; error: string };
