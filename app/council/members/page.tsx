import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Header from "@/app/_components/Header";

type MemberRow = {
  user_id: string;
  display_name: string;
  bio: string | null;
  is_admin: boolean;
  joined_at: string;
  submission_count: number;
};

export default async function CouncilMembersPage() {
  const supabase = await createClient();

  // Get approved members
  const { data: members } = await supabase
    .from("council_members")
    .select("user_id, display_name, bio, is_admin, joined_at")
    .eq("status", "approved")
    .order("joined_at", { ascending: true });

  // Count their current submissions
  const userIds = (members ?? []).map((m) => m.user_id);
  const submissionCountByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: subs } = await supabase
      .from("ranking_submissions")
      .select("member_id, scoring_system")
      .eq("is_current", true)
      .in("member_id", userIds);
    for (const s of subs ?? []) {
      const id = s.member_id as string;
      submissionCountByUser.set(id, (submissionCountByUser.get(id) ?? 0) + 1);
    }
  }

  const rows: MemberRow[] = (members ?? []).map((m) => ({
    user_id: m.user_id as string,
    display_name: m.display_name as string,
    bio: m.bio as string | null,
    is_admin: m.is_admin as boolean,
    joined_at: m.joined_at as string,
    submission_count: submissionCountByUser.get(m.user_id as string) ?? 0,
  }));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Header />

        <div className="mb-4 border-b border-zinc-800 pb-3">
          <h2 className="text-2xl font-semibold">The Council</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Approved council members whose rankings feed the consensus.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-center text-sm text-zinc-400">
            No council members yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((m) => (
              <Link
                key={m.user_id}
                href={`/council/members/${m.user_id}`}
                className="block rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
              >
                <div className="flex items-baseline gap-2">
                  <h3 className="font-medium text-zinc-100">{m.display_name}</h3>
                  {m.is_admin && (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                      admin
                    </span>
                  )}
                </div>
                {m.bio && (
                  <p className="mt-2 line-clamp-2 text-xs text-zinc-400">
                    {m.bio}
                  </p>
                )}
                <p className="mt-3 text-xs text-zinc-500">
                  {m.submission_count} ranking
                  {m.submission_count === 1 ? "" : "s"} submitted ·{" "}
                  {new Date(m.joined_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
