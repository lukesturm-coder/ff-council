-- =====================================================================
-- FF Council — Phase 7: Make council membership opt-in
--
-- Previously sign-up auto-created a council_members row. Now signing in
-- creates only an auth.users row. Users must explicitly visit /council/join
-- to become a member (status='pending' until admin approves).
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- Existing council_members rows are preserved. Only new auth signups are
-- affected — they get an auth.users row but NO council_members row.
