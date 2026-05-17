"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
  if (!user) {
    redirect("/login?error=Sign+in+to+vote");
  }

  // Sanity: if tier is "balanced", no lean. Otherwise lean is required.
  const lean =
    input.fairnessTier === "balanced" ? null : input.fairnessLean;
  if (input.fairnessTier !== "balanced" && !lean) {
    return { ok: false, error: "Pick which side benefits from the imbalance." };
  }

  const { error } = await supabase.from("trade_votes").upsert(
    {
      trade_id: input.tradeId,
      voter_id: user.id,
      winner: input.winner,
      fairness_tier: input.fairnessTier,
      fairness_lean: lean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trade_id,voter_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trades/${input.tradeId}`);
  revalidatePath("/trades");
  return { ok: true };
}
