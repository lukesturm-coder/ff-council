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
  const imageUrl = String(formData.get("image_url") ?? "").trim();

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

export type CastVerdictVoteResult =
  | { ok: true }
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

  revalidatePath(`/verdict/${input.scenarioId}`);
  revalidatePath("/verdict");
  return { ok: true };
}
