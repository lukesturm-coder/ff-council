-- =====================================================================
-- FF Council — Phase 14: Verdict actuals
--
-- Foundation for "verdict-vs-result accuracy": when a scenario's outcome
-- is known (e.g. start/sit winner after the week settles, draft pick
-- whose season validated the call), an admin marks the actual winner.
-- The UI then grades the council's top-pick against reality, which is
-- the long-term retention moat.
--
-- For now, resolution is manual via /council/admin/verdicts. No external
-- stats feed is wired up yet, so admins set winners by hand. The schema
-- intentionally only stores the winning player id + a timestamp + a
-- short note, so once we automate resolution from a stats source the
-- writer side just becomes a cron/job populating these same columns.
--
-- Run this in the Supabase SQL editor manually.
-- =====================================================================

alter table public.verdict_scenarios
  add column if not exists actual_winner_player_id integer,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

-- Partial index: most reads are "give me the resolved ones, newest first"
-- (for /me accuracy stat + admin tooling's resolved-section). Filtering on
-- actual_winner_player_id IS NOT NULL keeps the index tiny while we have
-- few resolved scenarios.
create index if not exists verdict_scenarios_resolved_idx
  on public.verdict_scenarios (resolved_at desc)
  where actual_winner_player_id is not null;
