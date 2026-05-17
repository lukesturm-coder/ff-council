-- =====================================================================
-- FF Council — Phase 1 Schema
-- Council members, ranking submissions, ranking entries, consensus view,
-- and the RLS policies that keep it honest.
-- =====================================================================

-- ---------- council_members ----------
-- One row per registered user. Extends auth.users with profile + tryout status.
create table public.council_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  bio text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'inactive', 'rejected')),
  is_admin boolean not null default false,
  joined_at timestamptz not null default now()
);

-- ---------- ranking_submissions ----------
-- Each row is one member's set of rankings for one scoring system.
-- is_current flags the latest submission per (member, scoring_system).
create table public.ranking_submissions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.council_members(user_id) on delete cascade,
  scoring_system text not null check (scoring_system in ('PPR','Half','Standard')),
  created_at timestamptz not null default now(),
  is_current boolean not null default true
);
-- At most one current submission per (member, scoring_system)
create unique index ranking_submissions_one_current_idx
  on public.ranking_submissions (member_id, scoring_system)
  where is_current;

-- ---------- ranking_entries ----------
-- Individual player ranks within a submission.
create table public.ranking_entries (
  submission_id uuid not null references public.ranking_submissions(id) on delete cascade,
  player_id integer not null,
  rank integer not null check (rank > 0),
  primary key (submission_id, player_id),
  unique (submission_id, rank)  -- no rank ties within a single submission
);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.council_members enable row level security;
alter table public.ranking_submissions enable row level security;
alter table public.ranking_entries enable row level security;

-- council_members: read access — approved members are visible to everyone,
-- and you can always read your own row (even while pending).
create policy "approved members visible to all"
  on public.council_members for select
  using (status = 'approved' or user_id = auth.uid());

-- Self-insert (new signup creates own row via trigger; this fallback allows
-- a logged-in user to insert their own row if the trigger doesn't fire).
create policy "users can create own member row"
  on public.council_members for insert
  with check (user_id = auth.uid());

-- Self-update — but you cannot promote yourself to admin or change your own status.
create policy "members update own profile fields"
  on public.council_members for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and is_admin = (select cm.is_admin from public.council_members cm where cm.user_id = auth.uid())
    and status   = (select cm.status   from public.council_members cm where cm.user_id = auth.uid())
  );

-- ranking_submissions: read your own + everyone-approved's.
create policy "submissions: own + approved-members visible"
  on public.ranking_submissions for select
  using (
    member_id = auth.uid()
    or exists (
      select 1 from public.council_members cm
      where cm.user_id = ranking_submissions.member_id and cm.status = 'approved'
    )
  );

create policy "submissions: insert own"
  on public.ranking_submissions for insert
  with check (member_id = auth.uid());

create policy "submissions: update own"
  on public.ranking_submissions for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ranking_entries: inherit visibility from the parent submission.
create policy "entries: follow submission visibility"
  on public.ranking_entries for select
  using (
    exists (
      select 1
      from public.ranking_submissions rs
      join public.council_members cm on cm.user_id = rs.member_id
      where rs.id = ranking_entries.submission_id
        and (rs.member_id = auth.uid() or cm.status = 'approved')
    )
  );

create policy "entries: manage own"
  on public.ranking_entries for all
  using (
    exists (
      select 1 from public.ranking_submissions rs
      where rs.id = ranking_entries.submission_id and rs.member_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ranking_submissions rs
      where rs.id = ranking_entries.submission_id and rs.member_id = auth.uid()
    )
  );

-- =====================================================================
-- Auto-create council_members row on signup
-- =====================================================================
-- When a new auth.users row appears, create the matching council_members
-- row in 'pending' status. SECURITY DEFINER lets the trigger bypass RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.council_members (user_id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Council Consensus view
-- =====================================================================
-- Average / median / spread of each player's rank across approved members'
-- current submissions, per scoring system. The Council page reads from this.
create or replace view public.council_consensus as
select
  rs.scoring_system,
  re.player_id,
  count(distinct rs.member_id)                                       as ranker_count,
  avg(re.rank::numeric)                                              as avg_rank,
  percentile_cont(0.5) within group (order by re.rank)               as median_rank,
  stddev(re.rank::numeric)                                           as stddev_rank,
  min(re.rank)                                                       as min_rank,
  max(re.rank)                                                       as max_rank
from public.ranking_entries re
join public.ranking_submissions rs on rs.id = re.submission_id
join public.council_members cm    on cm.user_id = rs.member_id
where rs.is_current and cm.status = 'approved'
group by rs.scoring_system, re.player_id;
