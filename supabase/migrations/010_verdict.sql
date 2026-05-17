-- =====================================================================
-- FF Council — Phase 10: Verdict
--
-- Crowdsourced "tough call" tool: a user posts a scenario (draft pick
-- OR start/sit) with 2-5 candidate players, and the public votes
-- one-tap on which player they'd take. Mirrors Trade Court's anon-
-- friendly pattern: regular unique constraint on (scenario_id,
-- voter_id) so PostgREST upsert.onConflict can target it; NULLs are
-- distinct in Postgres uniqueness so anon votes still go through.
-- =====================================================================

create table if not exists public.verdict_scenarios (
  id uuid primary key default gen_random_uuid(),
  asker_id uuid references auth.users(id) on delete set null,
  scenario_type text not null check (scenario_type in ('draft', 'start_sit')),
  -- candidates: [{ player_id, name, team, position }, ...] (2-5 items)
  candidates jsonb not null,
  -- roster: [{ player_id, name, team, position }, ...] (used for draft mode)
  roster jsonb,
  -- context: { scoring, week, position_needed, league_size, slot_type, round, ... }
  context jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists verdict_scenarios_created_at_idx
  on public.verdict_scenarios (created_at desc);

create table if not exists public.verdict_votes (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null
    references public.verdict_scenarios(id) on delete cascade,
  voter_id uuid references auth.users(id) on delete set null,
  pick_player_id integer not null,
  reasoning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verdict_votes_authed_unique unique (scenario_id, voter_id)
);

create index if not exists verdict_votes_scenario_idx
  on public.verdict_votes (scenario_id);

alter table public.verdict_scenarios enable row level security;
alter table public.verdict_votes enable row level security;

create policy "verdict_scenarios: public read"
  on public.verdict_scenarios for select
  using (true);

create policy "verdict_scenarios: open insert"
  on public.verdict_scenarios for insert
  with check (asker_id is null or asker_id = auth.uid());

create policy "verdict_votes: public read"
  on public.verdict_votes for select
  using (true);

create policy "verdict_votes: open insert"
  on public.verdict_votes for insert
  with check (voter_id is null or voter_id = auth.uid());

create policy "verdict_votes: update own"
  on public.verdict_votes for update
  using (voter_id = auth.uid())
  with check (voter_id = auth.uid());
