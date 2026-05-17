-- =====================================================================
-- FF Council — Phase 6 Schema: Season-end actual results
--
-- Populated AFTER each NFL season ends. Used to score each council member's
-- preseason rankings against reality — the basis for member "accuracy" leaderboards.
-- =====================================================================

create table public.actual_results (
  player_id integer not null,
  season integer not null,
  scoring_system text not null
    check (scoring_system in ('PPR','Half','Standard')),
  final_fpts numeric not null,
  final_position_rank integer,  -- e.g. RB1, WR3 — useful for VBD calc
  -- Computed at upload time:
  primary key (player_id, season, scoring_system)
);

create index actual_results_by_season_idx
  on public.actual_results (season, scoring_system);

alter table public.actual_results enable row level security;
create policy "actual_results public read"
  on public.actual_results for select
  using (true);
-- Writes are gated to server-side (service role bypasses RLS).
