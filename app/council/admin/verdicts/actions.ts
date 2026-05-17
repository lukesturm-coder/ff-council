"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// =====================================================================
// Server actions for /council/admin/verdicts.
//
// Admin manually grades a scenario by recording the actual winner. The
// row stays where it is — we just stamp three columns added in 014:
//   actual_winner_player_id, resolved_at, resolution_note.
//
// Unresolve nulls those columns (used when an admin marks the wrong
// winner and wants to re-grade).
//
// Both actions hard-gate on council_members.is_admin = true so a bored
// signed-in user can't grade their own bets.
// =====================================================================

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  const { data: me } = await supabase
    .from("council_members")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me?.is_admin) return { ok: false as const, error: "Not admin" };
  return { ok: true as const, supabase };
}

function revalidateResolutionSurfaces(scenarioId: string) {
  revalidatePath("/verdict");
  revalidatePath(`/verdict/${scenarioId}`);
  revalidatePath("/me");
  revalidatePath("/judge");
  revalidatePath("/council/admin/verdicts");
}

export async function resolveScenario(
  scenarioId: string,
  actualWinnerPlayerId: number,
  note: string,
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  // Defensive guards: scenarioId must be non-empty, winner id must be an
  // integer. The DB column is `integer not null` (conceptually); we don't
  // want the action to throw at the postgrest layer on malformed input.
  if (!scenarioId) return { ok: false as const, error: "Missing scenarioId" };
  if (!Number.isInteger(actualWinnerPlayerId)) {
    return { ok: false as const, error: "Winner id must be an integer" };
  }

  // Make sure the supplied winner is actually one of the candidates.
  // Otherwise an admin could fat-finger a random id and the UI would show
  // "Result: —" forever with no way to surface the typo.
  const { data: scenario } = await auth.supabase
    .from("verdict_scenarios")
    .select("candidates")
    .eq("id", scenarioId)
    .maybeSingle();
  if (!scenario) return { ok: false as const, error: "Scenario not found" };
  const candidates = (scenario.candidates ?? []) as { player_id: number }[];
  if (!candidates.some((c) => c.player_id === actualWinnerPlayerId)) {
    return {
      ok: false as const,
      error: "Winner must be one of the scenario's candidates",
    };
  }

  const trimmedNote = note.trim();
  const { error } = await auth.supabase
    .from("verdict_scenarios")
    .update({
      actual_winner_player_id: actualWinnerPlayerId,
      resolved_at: new Date().toISOString(),
      resolution_note: trimmedNote.length > 0 ? trimmedNote : null,
    })
    .eq("id", scenarioId);
  if (error) return { ok: false as const, error: error.message };

  revalidateResolutionSurfaces(scenarioId);
  return { ok: true as const };
}

export async function unresolveScenario(scenarioId: string) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!scenarioId) return { ok: false as const, error: "Missing scenarioId" };

  const { error } = await auth.supabase
    .from("verdict_scenarios")
    .update({
      actual_winner_player_id: null,
      resolved_at: null,
      resolution_note: null,
    })
    .eq("id", scenarioId);
  if (error) return { ok: false as const, error: error.message };

  revalidateResolutionSurfaces(scenarioId);
  return { ok: true as const };
}
