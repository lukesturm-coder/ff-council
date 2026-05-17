-- =====================================================================
-- FF Council — Phase 3 Schema: Vegas player futures lines
-- One row per (player, source, stat). Holds the actual O/U line + odds,
-- which platform_rankings doesn't model (it's for ranks/ADPs, not lines).
-- =====================================================================

create table public.vegas_futures (
  player_id integer not null,
  source text not null
    check (source in (
      'draftkings', 'fanduel', 'betmgm', 'caesars', 'fantasypros_aggregator'
    )),
  stat text not null
    check (stat in (
      'Passing Yards', 'Passing Touchdowns', 'Interceptions Thrown',
      'Rushing Yards', 'Rushing Touchdowns',
      'Receiving Yards', 'Receptions', 'Receiving Touchdowns'
    )),
  line numeric not null,
  over_odds integer,
  under_odds integer,
  player_name text,
  player_team text,
  fetched_at timestamptz not null default now(),
  primary key (player_id, source, stat)
);

create index vegas_futures_by_source_idx
  on public.vegas_futures (source, stat);
create index vegas_futures_by_player_idx
  on public.vegas_futures (player_id);

alter table public.vegas_futures enable row level security;

create policy "vegas_futures public read"
  on public.vegas_futures for select
  using (true);

-- Writes are gated to server-side (service role bypasses RLS).
-- No authenticated/anon write policies — scrapers run server-side only.
