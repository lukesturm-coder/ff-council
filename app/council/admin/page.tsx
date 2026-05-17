import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import Header from "@/app/_components/Header";
import AdminTable, { type AdminMemberRow } from "./AdminTable";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("council_members")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me?.is_admin) redirect("/");

  // Use service role to fetch all members + emails (auth.users isn't queryable
  // via the public schema for normal users, so we need admin privilege).
  const svc = createServiceClient();
  const [
    { data: members },
    { data: subs },
    { data: usersPage },
  ] = await Promise.all([
    svc
      .from("council_members")
      .select("user_id, display_name, bio, status, is_admin, joined_at")
      .order("joined_at", { ascending: true }),
    svc
      .from("ranking_submissions")
      .select("member_id, scoring_system, is_current")
      .eq("is_current", true),
    svc.auth.admin.listUsers(),
  ]);

  const emailByUserId = new Map<string, string>();
  for (const u of usersPage?.users ?? []) {
    if (u.email) emailByUserId.set(u.id, u.email);
  }

  const submissionCountByMember = new Map<string, Set<string>>();
  for (const s of subs ?? []) {
    const set =
      submissionCountByMember.get(s.member_id) ?? new Set<string>();
    set.add(s.scoring_system);
    submissionCountByMember.set(s.member_id, set);
  }

  const rows: AdminMemberRow[] = (members ?? []).map((m) => ({
    userId: m.user_id,
    email: emailByUserId.get(m.user_id) ?? "—",
    displayName: m.display_name,
    bio: m.bio,
    status: m.status,
    isAdmin: m.is_admin,
    joinedAt: m.joined_at,
    submittedScoringSystems: Array.from(
      submissionCountByMember.get(m.user_id) ?? [],
    ).sort(),
  }));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Header />
        <div className="mb-4 space-y-1">
          <h2 className="text-xl font-semibold">Admin — Members</h2>
          <p className="text-sm text-zinc-400">
            Approve tryout submissions, deactivate inactive members, and
            manage admins. Approved members&apos; rankings count toward the
            Council Consensus; pending and rejected members do not.
          </p>
        </div>

        <AdminTable rows={rows} currentUserId={user.id} />
      </div>
    </main>
  );
}
