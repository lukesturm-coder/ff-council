-- =====================================================================
-- FF Council — Phase 13: Sleeper account link
--
-- Persist the signed-in user's Sleeper handle + selected league so we can
-- (a) show their roster context across the app and (b) hydrate trade /
-- verdict drafts from real league data. Read-only Sleeper API — no tokens
-- stored, just the public identifiers.
--
-- Run this in the Supabase SQL editor manually.
-- =====================================================================

alter table public.council_members
  add column if not exists sleeper_username text,
  add column if not exists sleeper_user_id text,
  add column if not exists sleeper_league_id text;

create index if not exists council_members_sleeper_idx
  on public.council_members (sleeper_user_id);
