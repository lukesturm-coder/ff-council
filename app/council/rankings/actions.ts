"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ScoringSystem } from "@/lib/types";

export type SaveResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

/**
 * Save (or replace) the member's current ranking for one scoring system.
 *
 * Strategy: mark any existing current submission as not-current, insert a
 * new submission, then insert all ranking_entries. Not strictly atomic;
 * good enough for v1.
 */
export async function saveRanking(input: {
  scoring: ScoringSystem;
  ranks: Array<{ playerId: number; rank: number }>;
}): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { scoring, ranks } = input;
  if (ranks.length === 0) {
    return { ok: false, error: "No rankings to save" };
  }

  // Sanity: ranks must be 1..N with no gaps and no duplicates.
  const seen = new Set<number>();
  for (const { rank } of ranks) {
    if (seen.has(rank)) {
      return { ok: false, error: `Duplicate rank ${rank}` };
    }
    seen.add(rank);
  }

  // 1. Mark any current submission as not-current.
  const { error: clearErr } = await supabase
    .from("ranking_submissions")
    .update({ is_current: false })
    .eq("member_id", user.id)
    .eq("scoring_system", scoring)
    .eq("is_current", true);
  if (clearErr) return { ok: false, error: clearErr.message };

  // 2. Insert the new submission.
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

  // 3. Insert all ranking_entries.
  const { error: entriesErr } = await supabase.from("ranking_entries").insert(
    ranks.map((r) => ({
      submission_id: submission.id,
      player_id: r.playerId,
      rank: r.rank,
    })),
  );
  if (entriesErr) {
    return { ok: false, error: entriesErr.message };
  }

  revalidatePath("/council/rankings");
  revalidatePath("/council");
  return { ok: true, submissionId: submission.id };
}
