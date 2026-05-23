"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CourtPlayer } from "@/lib/court";

// Server actions for /council/admin/court — the slate builder + grader for
// Order in the Court. Every action hard-gates on council_members.is_admin.

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

function revalidate() {
  revalidatePath("/court");
  revalidatePath("/council/admin/court");
}

export async function createCourtWeek(input: {
  season: number;
  week: number;
  title: string;
  locksAt: string | null;
}): Promise<{ ok: true; weekId: string } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!Number.isInteger(input.season) || !Number.isInteger(input.week)) {
    return { ok: false, error: "Season and week must be numbers." };
  }
  const { data, error } = await auth.supabase
    .from("court_weeks")
    .insert({
      season: input.season,
      week: input.week,
      title: input.title.trim() || null,
      status: "draft",
      locks_at: input.locksAt,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, weekId: data.id as string };
}

export async function addCourtCase(input: {
  weekId: string;
  playerA: CourtPlayer;
  playerB: CourtPlayer;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (input.playerA.player_id === input.playerB.player_id) {
    return { ok: false, error: "Pick two different players." };
  }
  const { count } = await auth.supabase
    .from("court_cases")
    .select("id", { count: "exact", head: true })
    .eq("week_id", input.weekId);
  const { error } = await auth.supabase.from("court_cases").insert({
    week_id: input.weekId,
    order_index: (count ?? 0) + 1,
    player_a: input.playerA,
    player_b: input.playerB,
    source: "manual",
  });
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteCourtCase(
  caseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { error } = await auth.supabase
    .from("court_cases")
    .delete()
    .eq("id", caseId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function setCourtWeekStatus(input: {
  weekId: string;
  status: "draft" | "open" | "closed";
  locksAt?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.locksAt !== undefined) patch.locks_at = input.locksAt;
  const { error } = await auth.supabase
    .from("court_weeks")
    .update(patch)
    .eq("id", input.weekId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function gradeCourtCase(input: {
  caseId: string;
  winnerPlayerId: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  if (input.winnerPlayerId != null) {
    const { data: row } = await auth.supabase
      .from("court_cases")
      .select("player_a, player_b")
      .eq("id", input.caseId)
      .maybeSingle();
    if (!row) return { ok: false, error: "Case not found." };
    const a = (row.player_a as CourtPlayer).player_id;
    const b = (row.player_b as CourtPlayer).player_id;
    if (input.winnerPlayerId !== a && input.winnerPlayerId !== b) {
      return { ok: false, error: "Winner must be one of the two players." };
    }
  }

  const { error } = await auth.supabase
    .from("court_cases")
    .update({ winner_player_id: input.winnerPlayerId })
    .eq("id", input.caseId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteCourtWeek(
  weekId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { error } = await auth.supabase
    .from("court_weeks")
    .delete()
    .eq("id", weekId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
