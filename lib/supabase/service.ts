import { createClient as createServiceClientImpl } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS — use ONLY in server contexts
 * after verifying the caller is authorized (e.g., checked is_admin).
 *
 * NEVER import this in a Client Component file. SUPABASE_SERVICE_ROLE_KEY
 * is server-only and Next.js will throw at build time if you try.
 */
export function createServiceClient() {
  return createServiceClientImpl(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
