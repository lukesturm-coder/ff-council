-- =====================================================================
-- FF Council — Phase 8: Collapse to a two-tier access model
--
-- Tier 1 (public, no sign-in): view rankings, submit trades, vote? (kept gated)
-- Tier 2 (signed-in = council member): submit personal rankings
--
-- Changes:
--   1. Sign-in auto-creates a council_members row again — but with
--      status='approved' (no admin gate). Undoes migration 007.
--   2. Existing 'pending' rows are bumped to 'approved'.
--   3. trade_submissions.submitter_id becomes nullable so anonymous
--      (not-signed-in) users can post trades to the court.
--   4. trade_submissions INSERT policy is widened to allow either
--      (signed-in user inserting their own row) OR (anonymous insert
--      with submitter_id IS NULL).
-- =====================================================================

-- 1) Auto-create council_members on signup (approved by default)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.council_members (user_id, display_name, status)
  values (
    new.id,
    coalesce(split_part(new.email, '@', 1), 'Member'),
    'approved'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Promote anyone currently pending — the new model has no review step.
update public.council_members
   set status = 'approved'
 where status = 'pending';

-- 3) Backfill: any existing auth.users that doesn't have a council_members
-- row (e.g. anyone who signed up while migration 007 was active) gets one
-- now, approved.
insert into public.council_members (user_id, display_name, status)
select u.id, coalesce(split_part(u.email, '@', 1), 'Member'), 'approved'
  from auth.users u
  left join public.council_members cm on cm.user_id = u.id
 where cm.user_id is null;

-- 4) Allow anonymous trade submissions: submitter_id may now be null.
alter table public.trade_submissions
  alter column submitter_id drop not null;

-- Replace the insert policy: either authenticated user inserting their
-- own row, OR an anonymous insert with no submitter set.
drop policy if exists "trade_submissions: authenticated insert own"
  on public.trade_submissions;

create policy "trade_submissions: open insert"
  on public.trade_submissions for insert
  with check (
    submitter_id is null
    or submitter_id = auth.uid()
  );
