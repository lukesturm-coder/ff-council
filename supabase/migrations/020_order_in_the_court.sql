-- =====================================================================
-- FF Council — Phase 20: Order in the Court
--
-- The marquee weekly competition. Each week an admin publishes ~10
-- head-to-head start/sit calls ("which player scores more this week?").
-- Members lock their picks before kickoff; after the games an admin marks
-- each case's winner ("Case Closed"); members are then ranked by accuracy
-- in The Standings (weekly Chief Justice, season Head of the Council).
--
-- Three tables:
--   court_weeks  — one contest per NFL week (draft → open → closed)
--   court_cases  — the head-to-head matchups in a week
--   court_picks  — a member's pick per case (authed; one per case)
--
-- Picks are hidden from other members until the week locks, so nobody can
-- copy the crowd. Run this in the Supabase SQL editor manually.
-- =====================================================================

-- ---------- court_weeks ----------
create table if not exists public.court_weeks (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null,
  title text,
  -- draft  = admin still building (hidden from members)
  -- open   = accepting picks
  -- closed = locked + graded; results + standings visible
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed')),
  locks_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, week)
);

create index if not exists court_weeks_status_idx
  on public.court_weeks (status, season desc, week desc);

-- ---------- court_cases ----------
create table if not exists public.court_cases (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.court_weeks(id) on delete cascade,
  order_index integer not null default 0,
  -- player_a / player_b: { player_id, name, team, position }
  player_a jsonb not null,
  player_b jsonb not null,
  -- winner_player_id: null until the admin grades it after the games
  winner_player_id integer,
  source text not null default 'manual' check (source in ('manual', 'trending')),
  created_at timestamptz not null default now()
);

create index if not exists court_cases_week_idx
  on public.court_cases (week_id, order_index);

-- ---------- court_picks ----------
create table if not exists public.court_picks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.court_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pick_player_id integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, user_id)
);

create index if not exists court_picks_case_idx
  on public.court_picks (case_id);
create index if not exists court_picks_user_idx
  on public.court_picks (user_id);

-- ---------- RLS ----------
alter table public.court_weeks enable row level security;
alter table public.court_cases enable row level security;
alter table public.court_picks enable row level security;

-- Reusable admin predicate is inlined per-policy (no helper fn to keep this
-- migration self-contained):
--   exists (select 1 from council_members cm
--           where cm.user_id = auth.uid() and cm.is_admin)

-- court_weeks: members see published weeks; admins see everything.
create policy "court_weeks: read published or admin"
  on public.court_weeks for select
  using (
    status <> 'draft'
    or exists (
      select 1 from public.council_members cm
      where cm.user_id = auth.uid() and cm.is_admin
    )
  );

create policy "court_weeks: admin write"
  on public.court_weeks for all
  using (
    exists (
      select 1 from public.council_members cm
      where cm.user_id = auth.uid() and cm.is_admin
    )
  )
  with check (
    exists (
      select 1 from public.council_members cm
      where cm.user_id = auth.uid() and cm.is_admin
    )
  );

-- court_cases: readable when their week is published (or to admins).
create policy "court_cases: read published or admin"
  on public.court_cases for select
  using (
    exists (
      select 1 from public.court_weeks w
      where w.id = week_id and w.status <> 'draft'
    )
    or exists (
      select 1 from public.council_members cm
      where cm.user_id = auth.uid() and cm.is_admin
    )
  );

create policy "court_cases: admin write"
  on public.court_cases for all
  using (
    exists (
      select 1 from public.council_members cm
      where cm.user_id = auth.uid() and cm.is_admin
    )
  )
  with check (
    exists (
      select 1 from public.council_members cm
      where cm.user_id = auth.uid() and cm.is_admin
    )
  );

-- court_picks: you always see your own; everyone else's only after the week
-- locks (status closed, or locks_at has passed) so the crowd can't be copied.
create policy "court_picks: read own or after lock"
  on public.court_picks for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.court_cases c
      join public.court_weeks w on w.id = c.week_id
      where c.id = case_id
        and (w.status = 'closed' or (w.locks_at is not null and w.locks_at <= now()))
    )
  );

-- Insert/update only your own pick, only while the week is open and unlocked.
create policy "court_picks: insert own before lock"
  on public.court_picks for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.court_cases c
      join public.court_weeks w on w.id = c.week_id
      where c.id = case_id
        and w.status = 'open'
        and (w.locks_at is null or w.locks_at > now())
    )
  );

create policy "court_picks: update own before lock"
  on public.court_picks for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.court_cases c
      join public.court_weeks w on w.id = c.week_id
      where c.id = case_id
        and w.status = 'open'
        and (w.locks_at is null or w.locks_at > now())
    )
  );

-- =====================================================================
-- DEMO SEED (optional) — one open week with 10 head-to-heads so /court is
-- clickable immediately. Safe to delete once you publish a real week:
--   delete from public.court_weeks where title = 'Demo Week';
-- The player_ids here are placeholders for the demo only.
-- =====================================================================
with w as (
  insert into public.court_weeks (season, week, title, status, locks_at)
  values (2026, 1, 'Demo Week', 'open', now() + interval '120 days')
  on conflict (season, week) do nothing
  returning id
)
insert into public.court_cases (week_id, order_index, player_a, player_b, source)
select w.id, v.idx, v.a::jsonb, v.b::jsonb, 'manual'
from w,
  (values
    (1,  '{"player_id":900001,"name":"Ja''Marr Chase","team":"CIN","position":"WR"}', '{"player_id":900002,"name":"Justin Jefferson","team":"MIN","position":"WR"}'),
    (2,  '{"player_id":900003,"name":"Bijan Robinson","team":"ATL","position":"RB"}', '{"player_id":900004,"name":"Jahmyr Gibbs","team":"DET","position":"RB"}'),
    (3,  '{"player_id":900005,"name":"CeeDee Lamb","team":"DAL","position":"WR"}', '{"player_id":900006,"name":"Amon-Ra St. Brown","team":"DET","position":"WR"}'),
    (4,  '{"player_id":900007,"name":"Josh Allen","team":"BUF","position":"QB"}', '{"player_id":900008,"name":"Jalen Hurts","team":"PHI","position":"QB"}'),
    (5,  '{"player_id":900009,"name":"Saquon Barkley","team":"PHI","position":"RB"}', '{"player_id":900010,"name":"Christian McCaffrey","team":"SF","position":"RB"}'),
    (6,  '{"player_id":900011,"name":"Puka Nacua","team":"LAR","position":"WR"}', '{"player_id":900012,"name":"A.J. Brown","team":"PHI","position":"WR"}'),
    (7,  '{"player_id":900013,"name":"Brock Bowers","team":"LV","position":"TE"}', '{"player_id":900014,"name":"Trey McBride","team":"ARI","position":"TE"}'),
    (8,  '{"player_id":900015,"name":"De''Von Achane","team":"MIA","position":"RB"}', '{"player_id":900016,"name":"Ashton Jeanty","team":"LV","position":"RB"}'),
    (9,  '{"player_id":900017,"name":"Malik Nabers","team":"NYG","position":"WR"}', '{"player_id":900018,"name":"Brian Thomas Jr.","team":"JAX","position":"WR"}'),
    (10, '{"player_id":900019,"name":"Lamar Jackson","team":"BAL","position":"QB"}', '{"player_id":900020,"name":"Joe Burrow","team":"CIN","position":"QB"}')
  ) as v(idx, a, b);
