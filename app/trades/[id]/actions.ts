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

export type TradeConsensus = {
  total: number;
  topWinner: "A" | "B" | "EVEN" | null;
  topPct: number;
  counts: { A: number; B: number; EVEN: number };
};

export type VoteResult =
  | { ok: true; consensus: TradeConsensus }
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

  // Re-aggregate the current consensus so the caller (e.g. /judge) can
  // immediately show "you said A · council says B 73%" feedback without a
  // second round-trip. Hits trade_votes directly to avoid depending on the
  // trade_vote_summary view (which has had its own counting bugs).
  const { data: voteRows } = await supabase
    .from("trade_votes")
    .select("winner")
    .eq("trade_id", input.tradeId);
  const counts = { A: 0, B: 0, EVEN: 0 };
  for (const v of voteRows ?? []) {
    const w = v.winner as "A" | "B" | "EVEN";
    if (w === "A" || w === "B" || w === "EVEN") counts[w] += 1;
  }
  const total = counts.A + counts.B + counts.EVEN;
  let topWinner: "A" | "B" | "EVEN" | null = null;
  let topCount = -1;
  for (const w of ["A", "B", "EVEN"] as const) {
    if (counts[w] > topCount) {
      topCount = counts[w];
      topWinner = w;
    }
  }
  const topPct = total > 0 ? Math.round((topCount / total) * 100) : 0;

  revalidatePath(`/trades/${input.tradeId}`);
  revalidatePath("/trades");
  revalidatePath("/");
  revalidatePath("/judge");
  revalidatePath("/me");
  return { ok: true, consensus: { total, topWinner, topPct, counts } };
}
