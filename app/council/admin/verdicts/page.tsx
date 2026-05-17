import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "@/app/verdict/types";
import AdminVerdictsClient, {
  type AdminVerdictRow,
} from "./AdminVerdictsClient";

// =====================================================================
// /council/admin/verdicts — admin-only tool for grading verdict
// scenarios against the actual outcome.
//
// Two sections:
//   1. Unresolved scenarios (most recent first, paginated 50/page) —
//      pick the winning candidate, optionally leave a note, mark resolved.
//   2. Resolved scenarios (collapsible) — review past calls, unresolve
//      to fix mistakes.
//
// Hard auth gate: signed-in + council_members.is_admin = true. Anyone
// else gets bounced to /.
//
// Pagination via ?page=N — keeps server work small once we have a few
// hundred scenarios.
// =====================================================================

const PAGE_SIZE = 50;

export default async function AdminVerdictsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/council/admin/verdicts");

  const { data: me } = await supabase
    .from("council_members")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me?.is_admin) redirect("/");

  const params = await searchParams;
  const rawPage = parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const offset = (page - 1) * PAGE_SIZE;

  // Unresolved: most recent first, capped to PAGE_SIZE. Count for paginator.
  // Resolved list: just the most recent 50 (the section is collapsed by
  // default; an admin reviewing history can iterate further later if needed).
  const [unresolvedRes, resolvedRes] = await Promise.all([
    supabase
      .from("verdict_scenarios")
      .select(
        "id, scenario_type, candidates, context, notes, created_at, actual_winner_player_id, resolved_at, resolution_note",
        { count: "exact" },
      )
      .is("actual_winner_player_id", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1),
    supabase
      .from("verdict_scenarios")
      .select(
        "id, scenario_type, candidates, context, notes, created_at, actual_winner_player_id, resolved_at, resolution_note",
      )
      .not("actual_winner_player_id", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(50),
  ]);

  function toRow(s: {
    id: string;
    scenario_type: VerdictScenarioType;
    candidates: VerdictPlayer[] | null;
    context: VerdictContext | null;
    notes: string | null;
    created_at: string;
    actual_winner_player_id: number | null;
    resolved_at: string | null;
    resolution_note: string | null;
  }): AdminVerdictRow {
    return {
      id: s.id,
      scenarioType: s.scenario_type,
      candidates: s.candidates ?? [],
      context: s.context ?? {},
      notes: s.notes,
      createdAt: s.created_at,
      actualWinnerPlayerId: s.actual_winner_player_id,
      resolvedAt: s.resolved_at,
      resolutionNote: s.resolution_note,
    };
  }

  const unresolved: AdminVerdictRow[] = (unresolvedRes.data ?? []).map(toRow);
  const resolved: AdminVerdictRow[] = (resolvedRes.data ?? []).map(toRow);
  const totalUnresolved = unresolvedRes.count ?? unresolved.length;
  const totalPages = Math.max(1, Math.ceil(totalUnresolved / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="mb-5 border-b border-zinc-800 pb-3">
          <h2 className="text-xl font-semibold">Admin — Verdict outcomes</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Grade the council against reality. Pick the actual winner for
            each scenario once the outcome is known. This drives the
            accuracy stats and the trust loop.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            <Link
              href="/council/admin"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              ← Member admin
            </Link>
          </p>
        </div>

        <AdminVerdictsClient
          unresolved={unresolved}
          resolved={resolved}
          page={page}
          totalPages={totalPages}
          totalUnresolved={totalUnresolved}
        />
      </div>
    </main>
  );
}
