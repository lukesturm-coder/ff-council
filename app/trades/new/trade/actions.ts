"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SubmittedPlayer = {
  player_id: number;
  name: string;
  team: string;
  position: string;
};

export type SubmittedPick = {
  year: number;
  round: number;
  slot: number | null; // null = unknown / "team's pick"
};

export async function submitTrade(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Anonymous submissions allowed — submitter_id is nullable.
  const submitter_id = user?.id ?? null;

  const league_type = String(formData.get("league_type") || "redraft");
  const scoring = String(formData.get("scoring") || "PPR");
  const team_count = Number(formData.get("team_count") || 12);
  const context_note = String(formData.get("context_note") || "").trim() || null;
  const league_note = String(formData.get("league_note") || "").trim() || null;
  const side_a_raw = String(formData.get("side_a") || "");
  const side_b_raw = String(formData.get("side_b") || "");

  let side_a: { players: SubmittedPlayer[]; picks: SubmittedPick[] };
  let side_b: { players: SubmittedPlayer[]; picks: SubmittedPick[] };
  try {
    side_a = JSON.parse(side_a_raw);
    side_b = JSON.parse(side_b_raw);
  } catch {
    redirect("/trades/new/trade?error=Invalid+trade+payload");
  }

  if (
    side_a!.players.length + side_a!.picks.length === 0 ||
    side_b!.players.length + side_b!.picks.length === 0
  ) {
    redirect("/trades/new/trade?error=Both+sides+need+at+least+one+player+or+pick");
  }

  const { data, error } = await supabase
    .from("trade_submissions")
    .insert({
      submitter_id,
      league_type,
      scoring,
      team_count,
      context_note,
      league_note,
      side_a: side_a!,
      side_b: side_b!,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(
      `/trades/new/trade?error=${encodeURIComponent(error?.message ?? "Submission failed")}`,
    );
  }

  redirect(`/trades/${data.id}`);
}
