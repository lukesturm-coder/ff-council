/**
 * Promote a Supabase user to FF Council admin + approved status.
 * Uses the service-role key — must NEVER be exposed to the browser.
 *
 *   npx tsx scripts/promote-admin.ts <email>
 *   # or:
 *   npx tsx scripts/promote-admin.ts                 # defaults to env: ADMIN_EMAIL
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv[2] || process.env.ADMIN_EMAIL || "").trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing Supabase env vars. Check .env.local.");
  process.exit(1);
}
if (!email) {
  console.error("❌ Pass the email of the user to promote:");
  console.error("   npx tsx scripts/promote-admin.ts you@example.com");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`→ Looking up auth user: ${email}`);
  const { data: pageData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("❌ Failed to list users:", listErr.message);
    process.exit(1);
  }
  const user = pageData.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!user) {
    console.error(
      `❌ No auth user found with email ${email}. Sign in once via /login first, then re-run.`,
    );
    process.exit(1);
  }
  console.log(`  ✓ Found user id: ${user.id}`);

  console.log("→ Promoting to admin + approved");
  const { error: updateErr } = await supabase
    .from("council_members")
    .update({ is_admin: true, status: "approved" })
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("❌ Update failed:", updateErr.message);
    process.exit(1);
  }

  // Read back to confirm
  const { data: row, error: readErr } = await supabase
    .from("council_members")
    .select("display_name, status, is_admin, joined_at")
    .eq("user_id", user.id)
    .single();

  if (readErr || !row) {
    console.error("❌ Could not read back row:", readErr?.message);
    process.exit(1);
  }

  console.log("\n✅ Done.");
  console.log(`   display_name: ${row.display_name}`);
  console.log(`   status:       ${row.status}`);
  console.log(`   is_admin:     ${row.is_admin}`);
  console.log("\nReload the page — the Admin nav link should now appear.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
