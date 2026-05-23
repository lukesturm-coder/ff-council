import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadRankingProjections } from "@/lib/projections-data";
import type { CourtCase, CourtWeek } from "@/lib/court";
import AdminCourtClient, { type PickablePlayer } from "./AdminCourtClient";

// /council/admin/court — admin slate builder + grader for Order in the Court.
// Create a week, add head-to-head cases (manual player search or from the
// trending list), open it for picks, then grade winners after the games.

export default async function AdminCourtPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/council/admin/court");
  const { data: me } = await supabase
    .from("council_members")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me?.is_admin) redirect("/");

  const params = await searchParams;

  const { data: weeksData } = await supabase
    .from("court_weeks")
    .select("id, season, week, title, status, locks_at")
    .order("season", { ascending: false })
    .order("week", { ascending: false });
  const weeks = (weeksData ?? []) as CourtWeek[];

  const selectedId = params.week ?? weeks[0]?.id ?? null;
  let cases: CourtCase[] = [];
  if (selectedId) {
    const { data: caseData } = await supabase
      .from("court_cases")
      .select("id, order_index, player_a, player_b, winner_player_id")
      .eq("week_id", selectedId)
      .order("order_index", { ascending: true });
    cases = (caseData ?? []) as CourtCase[];
  }

  // Player pool for the case builder — top 240 by PPR keeps the payload small.
  const projections = await loadRankingProjections();
  const players: PickablePlayer[] = projections
    .filter((p) => p.fantasyPoints.PPR > 0)
    .sort((a, b) => b.fantasyPoints.PPR - a.fantasyPoints.PPR)
    .slice(0, 240)
    .map((p) => ({
      player_id: p.playerId,
      name: p.name,
      team: p.team,
      position: p.position,
    }));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold sm:text-2xl">
            Order in the Court — admin
          </h1>
          <Link
            href="/court"
            className="text-xs text-emerald-400 underline-offset-4 hover:underline"
          >
            View /court →
          </Link>
        </div>
        <AdminCourtClient
          weeks={weeks}
          selectedId={selectedId}
          cases={cases}
          players={players}
        />
      </div>
    </main>
  );
}
