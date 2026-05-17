"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { VerdictPlayer, VerdictContext } from "./types";

// =====================================================================
// Server actions for /verdict
//
// submitVerdict — creates a new scenario from the submission form. The
// form posts JSON-serialized arrays via hidden inputs (same pattern as
// app/trades/new/TradeSubmissionForm.tsx).
//
// castVerdictVote — records (or updates) a single one-tap vote.
// Authed users: upsert on (scenario_id, voter_id). Anon users: plain
// insert; client-side dedup via localStorage.
// =====================================================================

export async function submitVerdict(formData: FormData) {
  const scenarioType = String(formData.get("scenario_type") ?? "");
  if (scenarioType !== "draft" && scenarioType !== "start_sit") return;

  const candidatesRaw = String(formData.get("candidates") ?? "[]");
  const rosterRaw = String(formData.get("roster") ?? "[]");
  const contextRaw = String(formData.get("context") ?? "{}");
  const notes = String(formData.get("notes") ?? "").trim();
  let imageUrl = String(formData.get("image_url") ?? "").trim();
  // image_url comes from a hidden form input, so a hostile client could post
  // any URL. Only accept URLs served from our own Supabase storage origin;
  // anything else gets cleared (the empty-string → null guard below handles it).
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (imageUrl && (!supabaseOrigin || !imageUrl.startsWith(supabaseOrigin))) {
    imageUrl = "";
  }

  let candidates: VerdictPlayer[] = [];
  let roster: VerdictPlayer[] = [];
  let context: VerdictContext = {};
  try {
    candidates = JSON.parse(candidatesRaw);
    roster = JSON.parse(rosterRaw);
    context = JSON.parse(contextRaw);
  } catch {
    return;
  }
  if (candidates.length < 2 || candidates.length > 5) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("verdict_scenarios")
    .insert({
      asker_id: user?.id ?? null,
      scenario_type: scenarioType,
      candidates,
      roster: roster.length > 0 ? roster : null,
      context,
      notes: notes || null,
      image_url: imageUrl || null,
    })
    .select("id")
    .single();

  if (error || !data) return;
  revalidatePath("/verdict");
  redirect(`/verdict/${data.id}`);
}

export type CastVerdictVoteInput = {
  scenarioId: string;
  pickPlayerId: number;
  reasoning?: string;
};

export type VerdictConsensus = {
  total: number;
  topPlayerId: number | null;
  topPct: number;
  byPlayer: Record<number, number>;
};

export type CastVerdictVoteResult =
  | { ok: true; consensus: VerdictConsensus }
  | { ok: false; error: string };

export async function castVerdictVote(
  input: CastVerdictVoteInput,
): Promise<CastVerdictVoteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const voter_id = user?.id ?? null;

  const payload = {
    scenario_id: input.scenarioId,
    voter_id,
    pick_player_id: input.pickPlayerId,
    reasoning: input.reasoning?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = voter_id
    ? await supabase
        .from("verdict_votes")
        .upsert(payload, { onConflict: "scenario_id,voter_id" })
    : await supabase.from("verdict_votes").insert(payload);

  if (error) return { ok: false, error: error.message };

  // Re-aggregate so the caller can render "you said X · council says Y 52%"
  // without an extra round-trip. Direct query against verdict_votes — no
  // dependency on any summary view.
  const { data: voteRows } = await supabase
    .from("verdict_votes")
    .select("pick_player_id")
    .eq("scenario_id", input.scenarioId);
  const byPlayer: Record<number, number> = {};
  for (const v of voteRows ?? []) {
    const pid = v.pick_player_id as number;
    byPlayer[pid] = (byPlayer[pid] ?? 0) + 1;
  }
  let total = 0;
  for (const n of Object.values(byPlayer)) total += n;
  let topPlayerId: number | null = null;
  let topCount = -1;
  for (const [pidStr, count] of Object.entries(byPlayer)) {
    if (count > topCount) {
      topCount = count;
      topPlayerId = Number(pidStr);
    }
  }
  const topPct = total > 0 ? Math.round((topCount / total) * 100) : 0;

  revalidatePath(`/verdict/${input.scenarioId}`);
  revalidatePath("/verdict");
  revalidatePath("/judge");
  revalidatePath("/me");
  return { ok: true, consensus: { total, topPlayerId, topPct, byPlayer } };
}
