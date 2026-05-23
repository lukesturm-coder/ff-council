import { createClient } from "@/lib/supabase/server";

// Data layer for "Order in the Court" — the weekly start/sit accuracy contest.
// Read helpers live here; the pick mutation is a server action in
// app/court/actions.ts.

export type CourtPlayer = {
  player_id: number;
  name: string;
  team: string;
  position: string;
};

export type CourtCase = {
  id: string;
  order_index: number;
  player_a: CourtPlayer;
  player_b: CourtPlayer;
  winner_player_id: number | null;
};

export type CourtStatus = "draft" | "open" | "closed";

export type CourtWeek = {
  id: string;
  season: number;
  week: number;
  title: string | null;
  status: CourtStatus;
  locks_at: string | null;
};

export type CourtWeekWithCases = CourtWeek & { cases: CourtCase[] };

export type StandingRow = {
  userId: string;
  displayName: string;
  correct: number;
  graded: number;
  pct: number;
};

// The week members should see now: the newest published (open/closed) week.
// Admins building a draft week preview it from the admin tool instead.
export async function loadCurrentWeek(): Promise<CourtWeekWithCases | null> {
  const supabase = await createClient();
  const { data: week } = await supabase
    .from("court_weeks")
    .select("id, season, week, title, status, locks_at")
    .neq("status", "draft")
    .order("season", { ascending: false })
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!week) return null;

  const { data: cases } = await supabase
    .from("court_cases")
    .select("id, order_index, player_a, player_b, winner_player_id")
    .eq("week_id", week.id)
    .order("order_index", { ascending: true });

  return {
    ...(week as CourtWeek),
    cases: ((cases ?? []) as CourtCase[]),
  };
}

// caseId -> pickPlayerId for the signed-in member (empty when logged out).
export async function loadMyPicks(
  caseIds: string[],
  userId: string | null,
): Promise<Record<string, number>> {
  if (!userId || caseIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("court_picks")
    .select("case_id, pick_player_id")
    .eq("user_id", userId)
    .in("case_id", caseIds);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as {
    case_id: string;
    pick_player_id: number;
  }[]) {
    out[row.case_id] = row.pick_player_id;
  }
  return out;
}

// The Standings for a week — rank members by correct picks across graded
// cases. Returns [] until at least one case has a winner set.
export async function computeStandings(
  week: CourtWeekWithCases,
): Promise<StandingRow[]> {
  const graded = week.cases.filter((c) => c.winner_player_id != null);
  if (graded.length === 0) return [];
  const supabase = await createClient();

  const winnerByCase = new Map<string, number>();
  for (const c of graded) winnerByCase.set(c.id, c.winner_player_id as number);
  const gradedCount = graded.length;

  const { data: picks } = await supabase
    .from("court_picks")
    .select("case_id, user_id, pick_player_id")
    .in(
      "case_id",
      graded.map((c) => c.id),
    );

  const correctByUser = new Map<string, number>();
  for (const p of (picks ?? []) as {
    case_id: string;
    user_id: string;
    pick_player_id: number;
  }[]) {
    if (winnerByCase.get(p.case_id) === p.pick_player_id) {
      correctByUser.set(p.user_id, (correctByUser.get(p.user_id) ?? 0) + 1);
    } else if (!correctByUser.has(p.user_id)) {
      correctByUser.set(p.user_id, correctByUser.get(p.user_id) ?? 0);
    }
  }

  const userIds = Array.from(correctByUser.keys());
  if (userIds.length === 0) return [];

  const { data: members } = await supabase
    .from("council_members")
    .select("user_id, display_name")
    .in("user_id", userIds);
  const nameById = new Map<string, string>();
  for (const m of (members ?? []) as {
    user_id: string;
    display_name: string | null;
  }[]) {
    if (m.display_name) nameById.set(m.user_id, m.display_name);
  }

  return userIds
    .map((uid) => {
      const correct = correctByUser.get(uid) ?? 0;
      return {
        userId: uid,
        displayName: nameById.get(uid) ?? "Member",
        correct,
        graded: gradedCount,
        pct: Math.round((correct / gradedCount) * 100),
      };
    })
    .sort((a, b) => b.correct - a.correct || a.displayName.localeCompare(b.displayName));
}

export function isLocked(week: CourtWeek): boolean {
  if (week.status === "closed") return true;
  if (week.locks_at == null) return false;
  return new Date(week.locks_at).getTime() <= Date.now();
}
