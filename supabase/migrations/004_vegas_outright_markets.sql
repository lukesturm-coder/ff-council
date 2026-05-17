-- =====================================================================
-- FF Council — Phase 4 Schema: Vegas outright / participant markets
--
-- Different shape from vegas_futures. Outright markets pick a single
-- winner from a field — each player gets one odds value (to win), no
-- over/under, no line.
--
-- Examples of markets:
--   "MVP"
--   "Offensive Player of the Year"
--   "Most Passing Yards"
--   "Most Rushing Yards"
--   "Most Receiving Yards"
--   "Most Touchdowns"
-- =====================================================================

create table public.vegas_outright_markets (
  player_id integer not null,
  source text not null
    check (source in (
      'draftkings', 'fanduel', 'betmgm', 'caesars',
      'fantasypros_aggregator', 'oddstrader', 'oddsshark', 'bettingpros'
    )),
  market text not null,
  odds integer not null,
  player_name text,
  player_team text,
  fetched_at timestamptz not null default now(),
  primary key (player_id, source, market)
);

create index vegas_outright_by_market_idx
  on public.vegas_outright_markets (market);
create index vegas_outright_by_player_idx
  on public.vegas_outright_markets (player_id);

alter table public.vegas_outright_markets enable row level security;

create policy "vegas_outright_markets public read"
  on public.vegas_outright_markets for select
  using (true);

-- Add the new sources to vegas_futures too (in case we find stat O/Us at
-- one of these aggregators later)
alter table public.vegas_futures
  drop constraint if exists vegas_futures_source_check;

alter table public.vegas_futures
  add constraint vegas_futures_source_check
  check (source in (
    'draftkings', 'fanduel', 'betmgm', 'caesars',
    'fantasypros_aggregator', 'oddstrader', 'oddsshark', 'bettingpros'
  ));
