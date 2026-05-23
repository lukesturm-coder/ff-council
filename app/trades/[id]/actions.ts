"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  verdictFromCounts,
  type FairnessTier,
  type TradeVerdict,
} from "@/lib/trade-verdict";

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

// 5-bucket sentiment distribution for the reveal bars. "Strong" folds in the
// legacy major/extreme tiers; the new selector only emits slight (lean) and
// clear (strong), so going forward strong = clear.
export type SentimentDistribution = {
  strongA: number;
  leanA: number;
  even: number;
  leanB: number;
  strongB: number;
};

export type ControversyKey =
  | "consensus"
  | "divided"
  | "highly_divided";

export type TradeConsensus = {
  total: number;
  topWinner: "A" | "B" | "EVEN" | null;
  topPct: number;
  counts: { A: number; B: number; EVEN: number };
  // Weighted-verdict fields (from lib/trade-verdict) for the market reveal.
  score: number; // [-4,+4]; negative = A, positive = B
  leader: "A" | "B" | "EVEN";
  leaderPct: number;
  zoneLabel: string;
  headline: string; // market-framed, e.g. "Council slightly favors Team A"
  distribution: SentimentDistribution;
  controversy: ControversyKey;
  controversyLabel: string;
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

  revalidatePath(`/trades/${input.tradeId}`);
  revalidatePath("/trades");
  revalidatePath("/");
  revalidatePath("/judge");
  revalidatePath("/me");

  const consensus = await summarizeTrade(supabase, input.tradeId);
  return { ok: true, consensus };
}

// Read-only consensus fetch for already-voted users landing on the full trade
// page — lets the page render the post-vote reveal without a write.
export async function getTradeConsensus(
  tradeId: string,
): Promise<TradeConsensus> {
  const supabase = await createClient();
  return summarizeTrade(supabase, tradeId);
}

type SummaryRow = {
  total_votes: number;
  votes_a: number;
  votes_b: number;
  votes_even: number;
  a_slight_edge?: number;
  a_clear_advantage?: number;
  a_major_advantage?: number;
  a_extreme_imbalance?: number;
  b_slight_edge?: number;
  b_clear_advantage?: number;
  b_major_advantage?: number;
  b_extreme_imbalance?: number;
};

/**
 * Aggregate one trade's votes into the full market consensus. Reads a single
 * row from trade_vote_summary (exact + uncapped — selecting raw vote rows is
 * capped at ~1000 by PostgREST). Tries the post-019 shape with per-side tier
 * counts; falls back to base counts if that migration hasn't run yet.
 */
async function summarizeTrade(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tradeId: string,
): Promise<TradeConsensus> {
  const full = await supabase
    .from("trade_vote_summary")
    .select(
      "total_votes, votes_a, votes_b, votes_even, a_slight_edge, a_clear_advantage, a_major_advantage, a_extreme_imbalance, b_slight_edge, b_clear_advantage, b_major_advantage, b_extreme_imbalance",
    )
    .eq("trade_id", tradeId)
    .maybeSingle();

  let row = full.data as SummaryRow | null;
  let hasTiers = !full.error;
  if (full.error) {
    const base = await supabase
      .from("trade_vote_summary")
      .select("total_votes, votes_a, votes_b, votes_even")
      .eq("trade_id", tradeId)
      .maybeSingle();
    row = base.data as SummaryRow | null;
    hasTiers = false;
  }

  const r = row ?? { total_votes: 0, votes_a: 0, votes_b: 0, votes_even: 0 };
  const counts = {
    A: Number(r.votes_a) || 0,
    B: Number(r.votes_b) || 0,
    EVEN: Number(r.votes_even) || 0,
  };
  const total = Number(r.total_votes) || 0;

  let topWinner: "A" | "B" | "EVEN" | null = null;
  let topCount = -1;
  for (const w of ["A", "B", "EVEN"] as const) {
    if (counts[w] > topCount) {
      topCount = counts[w];
      topWinner = w;
    }
  }
  const topPct = total > 0 ? Math.round((topCount / total) * 100) : 0;

  const tiersA: Partial<Record<FairnessTier, number>> | undefined = hasTiers
    ? {
        slight_edge: Number(r.a_slight_edge) || 0,
        clear_advantage: Number(r.a_clear_advantage) || 0,
        major_advantage: Number(r.a_major_advantage) || 0,
        extreme_imbalance: Number(r.a_extreme_imbalance) || 0,
      }
    : undefined;
  const tiersB: Partial<Record<FairnessTier, number>> | undefined = hasTiers
    ? {
        slight_edge: Number(r.b_slight_edge) || 0,
        clear_advantage: Number(r.b_clear_advantage) || 0,
        major_advantage: Number(r.b_major_advantage) || 0,
        extreme_imbalance: Number(r.b_extreme_imbalance) || 0,
      }
    : undefined;

  const verdict = verdictFromCounts({
    votes_a: counts.A,
    votes_b: counts.B,
    votes_even: counts.EVEN,
    tiers_a: tiersA,
    tiers_b: tiersB,
  });

  const distribution: SentimentDistribution = {
    strongA: tiersA
      ? tiersA.clear_advantage! + tiersA.major_advantage! + tiersA.extreme_imbalance!
      : 0,
    leanA: tiersA ? tiersA.slight_edge! : counts.A,
    even: counts.EVEN,
    leanB: tiersB ? tiersB.slight_edge! : counts.B,
    strongB: tiersB
      ? tiersB.clear_advantage! + tiersB.major_advantage! + tiersB.extreme_imbalance!
      : 0,
  };

  const { key: controversy, label: controversyLabel } =
    controversyOf(distribution);

  return {
    total,
    topWinner,
    topPct,
    counts,
    score: verdict.score,
    leader: verdict.leader,
    leaderPct: verdict.winnerPct,
    zoneLabel: verdict.zoneLabel,
    headline: marketHeadline(verdict),
    distribution,
    controversy,
    controversyLabel,
  };
}

// Market-framed one-liner: "Council slightly favors Team A". No toxic copy.
function marketHeadline(v: TradeVerdict): string {
  if (v.leader === "EVEN") return "Council is split";
  const side = v.leader === "A" ? "Team A" : "Team B";
  const word =
    v.zone === "slight"
      ? "slightly favors"
      : v.zone === "clear"
        ? "favors"
        : v.zone === "major"
          ? "strongly favors"
          : v.zone === "fleece"
            ? "heavily favors"
            : "leans toward";
  return `Council ${word} ${side}`;
}

function controversyOf(d: SentimentDistribution): {
  key: ControversyKey;
  label: string;
} {
  const aDir = d.strongA + d.leanA;
  const bDir = d.strongB + d.leanB;
  const total = aDir + bDir + d.even;
  if (total < 4) {
    return { key: "consensus", label: total === 0 ? "No votes yet" : "Early" };
  }
  const maxSide = Math.max(aDir, bDir);
  const minSide = Math.min(aDir, bDir);
  if (aDir > 0 && bDir > 0 && maxSide > 0 && minSide / maxSide >= 0.6) {
    return { key: "highly_divided", label: "Highly Divided" };
  }
  const topShare = Math.max(aDir, bDir, d.even) / total;
  if (topShare >= 0.7) return { key: "consensus", label: "Strong Consensus" };
  return { key: "divided", label: "Divided" };
}

export type TradeComment = {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
};

/** Most-recent quick-take comments for a trade (public read). */
export async function getTradeComments(
  tradeId: string,
): Promise<TradeComment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trade_comments")
    .select("id, author_name, body, created_at")
    .eq("trade_id", tradeId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as TradeComment[];
}

export type PostCommentResult =
  | { ok: true; comment: TradeComment }
  | { ok: false; error: string };

/** Post a quick take on a trade. Sign-in required; 200-char cap. */
export async function postTradeComment(input: {
  tradeId: string;
  body: string;
}): Promise<PostCommentResult> {
  const body = input.body.trim();
  if (body.length === 0) return { ok: false, error: "Say something first." };
  if (body.length > 200) {
    return { ok: false, error: "Keep it under 200 characters." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to post a take." };

  const { data: member } = await supabase
    .from("council_members")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const authorName =
    (member?.display_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Member";

  const { data, error } = await supabase
    .from("trade_comments")
    .insert({
      trade_id: input.tradeId,
      author_id: user.id,
      author_name: authorName,
      body,
    })
    .select("id, author_name, body, created_at")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to post." };
  }
  revalidatePath(`/trades/${input.tradeId}`);
  return { ok: true, comment: data as TradeComment };
}
