"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SubmitPickResult = { ok: true } | { ok: false; error: string };

// Lock in (or change) the member's pick for one head-to-head case. Auth
// required — picks are attributed for The Standings. RLS enforces that the
// week is open and unlocked, so a late pick is rejected at the DB.
export async function submitCourtPick(input: {
  caseId: string;
  pickPlayerId: number;
}): Promise<SubmitPickResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to enter Order in the Court." };
  }

  const { error } = await supabase.from("court_picks").upsert(
    {
      case_id: input.caseId,
      user_id: user.id,
      pick_player_id: input.pickPlayerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "case_id,user_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/court");
  return { ok: true };
}
