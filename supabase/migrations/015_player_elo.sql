create table if not exists public.player_comparisons (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid references auth.users(id) on delete set null,
  winner_id integer not null,
  loser_id integer not null,
  scoring_system text not null check (scoring_system in ('PPR', 'Half', 'Standard')),
  created_at timestamptz not null default now()
);
create index if not exists player_comparisons_voter_idx on public.player_comparisons (voter_id, created_at desc);
create index if not exists player_comparisons_winner_idx on public.player_comparisons (winner_id);

create table if not exists public.player_elo (
  player_id integer not null,
  scoring_system text not null check (scoring_system in ('PPR', 'Half', 'Standard')),
  elo numeric not null default 1500,
  games_played integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, scoring_system)
);

alter table public.player_comparisons enable row level security;
alter table public.player_elo enable row level security;

create policy "player_comparisons: public read" on public.player_comparisons for select using (true);
create policy "player_comparisons: open insert" on public.player_comparisons for insert
  with check (voter_id is null or voter_id = auth.uid());
create policy "player_elo: public read" on public.player_elo for select using (true);

-- Trigger function: applies Elo math on each new comparison.
-- K=32 is the classic Elo K-factor (chess uses K=10-40 depending on level).
create or replace function public.update_elo_on_comparison()
returns trigger
language plpgsql
security definer
as $$
declare
  k constant numeric := 32;
  winner_elo numeric;
  loser_elo numeric;
  expected_winner numeric;
begin
  insert into public.player_elo (player_id, scoring_system)
  values (new.winner_id, new.scoring_system), (new.loser_id, new.scoring_system)
  on conflict (player_id, scoring_system) do nothing;
  select elo into winner_elo from public.player_elo
    where player_id = new.winner_id and scoring_system = new.scoring_system;
  select elo into loser_elo from public.player_elo
    where player_id = new.loser_id and scoring_system = new.scoring_system;
  expected_winner := 1.0 / (1.0 + power(10.0, (loser_elo - winner_elo) / 400.0));
  update public.player_elo
    set elo = elo + k * (1 - expected_winner),
        games_played = games_played + 1,
        updated_at = now()
    where player_id = new.winner_id and scoring_system = new.scoring_system;
  update public.player_elo
    set elo = elo - k * (1 - expected_winner),
        games_played = games_played + 1,
        updated_at = now()
    where player_id = new.loser_id and scoring_system = new.scoring_system;
  return new;
end;
$$;

drop trigger if exists trg_update_elo_on_comparison on public.player_comparisons;
create trigger trg_update_elo_on_comparison
after insert on public.player_comparisons
for each row execute function public.update_elo_on_comparison();
