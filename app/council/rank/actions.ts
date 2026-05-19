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
// We can't persist the S/A/B/C/D tier letter in the existing schema, so the
// flow keeps that purely as a client-session affordance. Global rank order
// across tiers (S before A before B…) is the canonical persisted artefact.
// ---------------------------------------------------------------------------

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
  ranks: Array<{ playerId: number; rank: number }>;
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
  const { error: entriesErr } = await supabase.from("ranking_entries").insert(
    ranks.map((r) => ({
      submission_id: submission.id,
      player_id: r.playerId,
      rank: r.rank,
    })),
  );
  if (entriesErr) return { ok: false, error: entriesErr.message };

  // The aggregated council_consensus view + the /council page both read from
  // these tables, so revalidate both.
  revalidatePath("/council/rank");
  revalidatePath("/council/rankings");
  revalidatePath("/council");
  return { ok: true, submissionId: submission.id };
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
