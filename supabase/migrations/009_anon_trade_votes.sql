-- =====================================================================
-- FF Council — Phase 9: Allow anonymous trade votes
--
-- The home-page "vote on a trade" prompt should work without sign-in. We
-- relax trade_votes so voter_id can be null (anonymous), keep uniqueness
-- per (trade, voter) for signed-in users only, and widen the INSERT policy.
-- =====================================================================

-- Drop the existing primary key first (which currently includes voter_id);
-- Postgres won't let you drop NOT NULL on a PK column.
alter table public.trade_votes
  drop constraint trade_votes_pkey;

alter table public.trade_votes
  alter column voter_id drop not null;

-- Add a synthetic id and re-create the primary key on it.
alter table public.trade_votes
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.trade_votes
  add constraint trade_votes_pkey primary key (id);

-- Re-enforce one-vote-per-trade for signed-in users only. Anon votes are
-- dedup'd at the client via localStorage; we accept some sloppiness for
-- engagement.
create unique index if not exists trade_votes_authed_unique
  on public.trade_votes (trade_id, voter_id)
  where voter_id is not null;

-- Replace the auth-only insert policy with one that allows anonymous too.
drop policy if exists "trade_votes: authenticated cast own"
  on public.trade_votes;

create policy "trade_votes: open insert"
  on public.trade_votes for insert
  with check (
    voter_id is null
    or voter_id = auth.uid()
  );
