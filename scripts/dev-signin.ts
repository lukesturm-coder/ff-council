/**
 * Dev-only: generate a magic-link token via service-role and construct a
 * localhost URL that hits OUR /auth/confirm route directly — bypassing
 * Supabase's email send AND the Site URL / Redirect URL whitelist.
 *
 *   npx tsx scripts/dev-signin.ts <email> [appUrl]
 *
 * Prints a URL — paste it into any browser to sign in.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv[2] || "").trim();
const appUrl = (process.argv[3] || "http://localhost:3001").replace(/\/$/, "");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing Supabase env vars in .env.local");
  process.exit(1);
}
if (!email) {
  console.error("Usage: npx tsx scripts/dev-signin.ts <email> [appUrl]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`→ Generating magiclink for ${email}`);

  // generateLink creates a verifiable hashed_token for this email.
  // type "magiclink" works whether or not the user already exists —
  // Supabase will create them on first verify if needed.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    console.error("❌ generateLink failed:", error.message);
    process.exit(1);
  }

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    console.error("❌ No hashed_token in response.");
    process.exit(1);
  }

  // Bypass Supabase's verify-then-redirect flow. Our /auth/confirm route
  // calls verifyOtp({ token_hash }) directly and sets the session cookie.
  const url = `${appUrl}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/`;

  console.log("\n✅ Open this URL in your browser to sign in:\n");
  console.log("    " + url + "\n");
  console.log("(Single-use, expires in ~1 hour.)");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
