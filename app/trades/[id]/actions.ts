"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type VoteInput = {
  tradeId: string;
  winner: "A" | "B" | "EVEN";
  fairnessTier:
    | "balanced"
    | "slight_edge"
    | "clear_advantage"
    | "major_advantage"
    | "extreme_imbalance";
  fairnessLean: "A" | "B" | null;
};

export type VoteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function castVote(input: VoteInput): Promise<VoteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous voting is allowed (engagement > attribution for now). Signed-in
  // users get one-vote-per-trade dedup via a partial unique index; anon votes
  // are dedup'd at the client via localStorage.
  const voter_id = user?.id ?? null;

  const lean =
    input.fairnessTier === "balanced" ? null : input.fairnessLean;
  if (input.fairnessTier !== "balanced" && !lean) {
    return { ok: false, error: "Pick which side benefits from the imbalance." };
  }

  const payload = {
    trade_id: input.tradeId,
    voter_id,
    winner: input.winner,
    fairness_tier: input.fairnessTier,
    fairness_lean: lean,
    updated_at: new Date().toISOString(),
  };

  // For signed-in users, upsert by (trade_id, voter_id) so re-votes update.
  // For anonymous, just insert — every anon vote is a new row.
  const { error } = voter_id
    ? await supabase
        .from("trade_votes")
        .upsert(payload, { onConflict: "trade_id,voter_id" })
    : await supabase.from("trade_votes").insert(payload);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trades/${input.tradeId}`);
  revalidatePath("/trades");
  revalidatePath("/");
  return { ok: true };
}
