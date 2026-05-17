-- =====================================================================
-- FF Council — Phase 2 Schema: external platform rankings
-- One row per (player_id, source, ranking_type, scoring_system).
-- Sources: espn, yahoo, sleeper, nfl, cbs, fantasypros.
-- Ranking types: editorial (their staff's published rank) or adp (real
-- draft consensus).
-- =====================================================================

create table public.platform_rankings (
  player_id integer not null,
  source text not null
    check (source in ('espn','yahoo','sleeper','nfl','cbs','fantasypros')),
  ranking_type text not null
    check (ranking_type in ('editorial','adp')),
  scoring_system text not null
    check (scoring_system in ('PPR','Half','Standard')),
  rank_value numeric not null check (rank_value > 0),
  player_name text,           -- snapshot for display/debug at fetch time
  player_team text,           -- snapshot
  fetched_at timestamptz not null default now(),
  primary key (player_id, source, ranking_type, scoring_system)
);

-- Read-fast indexes
create index platform_rankings_by_source_idx
  on public.platform_rankings (source, ranking_type, scoring_system);

create index platform_rankings_by_player_idx
  on public.platform_rankings (player_id, scoring_system);

-- Anyone can read external rankings — they're public data
alter table public.platform_rankings enable row level security;

create policy "platform_rankings public read"
  on public.platform_rankings for select
  using (true);

-- Writes are gated to server-side (service-role bypasses RLS).
-- No insert/update/delete policies for authenticated/anon — they're locked out.

-- =====================================================================
-- Unmapped players: when a platform's player can't be name+team matched
-- to our SportsDataIO roster, we stash the raw record here for review.
-- =====================================================================
create table public.platform_rankings_unmapped (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  ranking_type text not null,
  scoring_system text not null,
  raw_name text not null,
  raw_team text,
  rank_value numeric not null,
  fetched_at timestamptz not null default now()
);

alter table public.platform_rankings_unmapped enable row level security;
-- Only service role reads/writes this table (no policies = no access for
-- authenticated/anon clients).
