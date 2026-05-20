"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ScoringSystem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Server actions for the Beli-style council/rank flow.
//
// Persistence strategy (no schema migration required):
//   - Per-player rank: same tables as /council/rankings — `ranking_submissions`
//     (one current row per member × scoring system) + `ranking_entries`
//     (rank-per-player). Each time the user finalizes a player's slot, we
//     replace the entire current submission's entries with the new ordering.
//   - Per-comparison Elo signal: one row per pairwise tap into
//     `player_comparisons` (existing table, drives /rank Elos). A trigger on
//     that table updates `player_elo`.
//
// The S/A/B/C/D…/H tier letter is persisted on ranking_entries.tier (added
// in migration 018) so the /council/rankings tier board can reload with each
// player back in its row. Global rank order across tiers (S before A before
// B…) remains the canonical persisted artefact that feeds council_consensus.
// When migration 018 hasn't been applied yet we transparently fall back to
// inserting entries WITHOUT the tier column, so the flow keeps working.
// ---------------------------------------------------------------------------

export type TierLetter = "S" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type SavePersonalRankResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

/**
 * Persist the user's full ordered list for one scoring system. Replaces any
 * existing current submission for that (member, scoring_system) pair.
 *
 * The client calls this after every player is finalized (post-State-3), so
 * the source of truth survives crashes/refreshes. The write is wrapped in
 * useTransition on the client so the UI keeps moving while the network
 * round-trip completes.
 */
export async function savePersonalRank(input: {
  scoring: ScoringSystem;
  ranks: Array<{ playerId: number; rank: number; tier?: TierLetter | null }>;
  /**
   * Which surface is calling. We never revalidate the route the user is
   * actively editing on, because revalidatePath of the current route inside a
   * client useTransition wedges the transition queue (it froze the Beli flow
   * after a couple of saves). "rank" = the Beli tap-flow at /council/rank,
   * "board" = the tier board at /council/rankings. Defaults to "rank" to
   * preserve the original behaviour for existing callers.
   */
  from?: "rank" | "board";
}): Promise<SavePersonalRankResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { scoring, ranks } = input;
  if (ranks.length === 0) return { ok: false, error: "No rankings to save" };

  // Sanity: ranks must be unique. We don't enforce contiguity here — gaps are
  // theoretically possible if the caller is mid-flow, but in practice the
  // client always rebuilds ranks as 1..N from the ordered list.
  const seen = new Set<number>();
  for (const { rank } of ranks) {
    if (seen.has(rank)) return { ok: false, error: `Duplicate rank ${rank}` };
    seen.add(rank);
  }

  // Mark the existing current submission as not-current (if any).
  const { error: clearErr } = await supabase
    .from("ranking_submissions")
    .update({ is_current: false })
    .eq("member_id", user.id)
    .eq("scoring_system", scoring)
    .eq("is_current", true);
  if (clearErr) return { ok: false, error: clearErr.message };

  // Insert a fresh current submission.
  const { data: submission, error: insErr } = await supabase
    .from("ranking_submissions")
    .insert({
      member_id: user.id,
      scoring_system: scoring,
      is_current: true,
    })
    .select("id")
    .single();
  if (insErr || !submission) {
    return { ok: false, error: insErr?.message ?? "Submission insert failed" };
  }

  // Bulk-insert every entry. ranking_entries has FK to the submission, so
  // when the old submission flipped to is_current=false its entries are
  // preserved as history.
  //
  // We attempt the insert WITH the tier column first. If migration 018 hasn't
  // run yet, PostgREST rejects the unknown `tier` column — we detect that and
  // retry without it, so the order still persists (mirrors the
  // projected_points fallback in app/rankings/page.tsx#loadPlatformRankings).
  const baseRows = ranks.map((r) => ({
    submission_id: submission.id,
    player_id: r.playerId,
    rank: r.rank,
  }));
  const rowsWithTier = ranks.map((r, i) => ({
    ...baseRows[i],
    tier: r.tier ?? null,
  }));

  const withTier = await supabase.from("ranking_entries").insert(rowsWithTier);
  if (withTier.error) {
    if (isMissingTierColumn(withTier.error)) {
      const fallback = await supabase
        .from("ranking_entries")
        .insert(baseRows);
      if (fallback.error) return { ok: false, error: fallback.error.message };
    } else {
      return { ok: false, error: withTier.error.message };
    }
  }

  // Revalidate the OTHER surfaces that read these tables — but NEVER the route
  // the caller is actively editing on. Calling revalidatePath for the current
  // route inside the client's useTransition wedges the transition queue (the
  // flow freezes after a couple of saves). Each editor holds its working state
  // client-side, so it doesn't need a server refresh while the user is ranking.
  const from = input.from ?? "rank";
  if (from !== "board") revalidatePath("/council/rankings");
  // /council always reads fresh consensus and is never the editing surface.
  revalidatePath("/council");
  return { ok: true, submissionId: submission.id };
}

/**
 * PostgREST error shape when a column doesn't exist on the target table.
 * Postgres reports SQLSTATE 42703 (undefined_column); PostgREST surfaces the
 * code and a message mentioning the column. We check both to be safe across
 * PostgREST versions.
 */
function isMissingTierColumn(err: { code?: string; message?: string }): boolean {
  if (err.code === "42703") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("tier") && msg.includes("column");
}

export type RecordComparisonResult = { ok: true } | { ok: false; error: string };

/**
 * Record one pairwise "who would you rather have" tap. Feeds the same
 * `player_comparisons` table that /rank uses, so the existing Elo
 * aggregation engine picks up signal from this flow for free.
 *
 * Anonymous voter inserts (voter_id=null) are allowed by RLS; we still pass
 * the user id when available so /me shows the user's voting history.
 */
export async function recordComparison(input: {
  winnerId: number;
  loserId: number;
  scoring: ScoringSystem;
}): Promise<RecordComparisonResult> {
  if (input.winnerId === input.loserId) {
    return { ok: false, error: "Winner and loser must differ" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("player_comparisons").insert({
    voter_id: user?.id ?? null,
    winner_id: input.winnerId,
    loser_id: input.loserId,
    scoring_system: input.scoring,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
