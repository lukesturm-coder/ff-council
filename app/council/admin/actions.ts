"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type MemberStatus = "pending" | "approved" | "inactive" | "rejected";

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
  return { ok: true as const, userId: user.id };
}

export async function setMemberStatus(
  targetUserId: string,
  status: MemberStatus,
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  if (targetUserId === auth.userId && status !== "approved") {
    return { ok: false as const, error: "You cannot deactivate yourself" };
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("council_members")
    .update({ status })
    .eq("user_id", targetUserId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/council/admin");
  revalidatePath("/council");
  return { ok: true as const };
}

export async function toggleAdmin(targetUserId: string, makeAdmin: boolean) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  if (targetUserId === auth.userId && !makeAdmin) {
    return { ok: false as const, error: "You cannot demote yourself" };
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("council_members")
    .update({ is_admin: makeAdmin })
    .eq("user_id", targetUserId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/council/admin");
  return { ok: true as const };
}
