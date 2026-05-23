-- =====================================================================
-- FF Council — Phase 21: Platform player stats (projection ingestion)
--
-- Per-source PROJECTED stat lines (receiving yards, receptions, TDs, rush,
-- pass, ...) so the rankings expand matrix can show what each app projects
-- per player — not just per-source rank/points. Raw stat values are
-- scoring-agnostic (yards/receptions/TDs are the same in PPR/Half/Std), so
-- there's no scoring dimension; projected POINTS per source already live in
-- platform_rankings (migration 016).
--
-- `week` is null for season-long projections; set it for week-by-week
-- projections later. `stat` matches the ImpliedStats keys in lib/types.ts:
--   passingYards, passingTouchdowns, interceptions, rushingYards,
--   rushingTouchdowns, receptions, receivingYards, receivingTouchdowns
--
-- Writers are the fetch:projections scripts running with the service role
-- (RLS-bypassing); the app only reads. Run this in the Supabase SQL editor.
-- =====================================================================

create table if not exists public.platform_player_stats (
  id uuid primary key default gen_random_uuid(),
  source text not null,            -- 'espn' | 'sleeper' | 'nfl' | 'yahoo' | 'vegas'
  player_id integer not null,      -- our mock PlayerID (after name+team mapping)
  stat text not null,              -- an ImpliedStats key
  value numeric not null,
  season integer not null default 2026,
  week integer,                    -- null = season-long
  captured_at timestamptz not null default now(),
  unique (source, player_id, stat, season, week)
);

create index if not exists platform_player_stats_player_idx
  on public.platform_player_stats (player_id);
create index if not exists platform_player_stats_lookup_idx
  on public.platform_player_stats (season, week, source);

alter table public.platform_player_stats enable row level security;

-- Public read; writes happen via the service role (which bypasses RLS), so no
-- public insert/update policy is granted.
create policy "platform_player_stats: public read"
  on public.platform_player_stats for select
  using (true);
