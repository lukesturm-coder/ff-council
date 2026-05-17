-- =====================================================================
-- FF Council — Phase 5 Schema: Trade Review System ("trade court")
--
-- Users submit fantasy trades; community votes on who won + fairness.
-- Each submission is a public page. Comments / discussion deferred to v2.
-- =====================================================================

-- Side payload shape (stored as JSONB):
--   {
--     "players": [{"player_id": 17959, "name": "Saquon Barkley", "team": "PHI", "position": "RB"}, ...],
--     "picks":   [{"year": 2027, "round": 2, "slot": null}, ...]
--   }
-- player_id may be null when the player isn't in our roster yet
-- (free-text submissions allowed; matching happens on view).

create table public.trade_submissions (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references auth.users(id) on delete cascade,
  league_type text not null
    check (league_type in ('redraft', 'dynasty', 'keeper')),
  scoring text not null
    check (scoring in ('PPR', 'Half', 'Standard', 'Superflex', 'TEPremium')),
  team_count integer not null default 12 check (team_count between 4 and 32),
  -- Optional context fields
  context_note text,           -- "I'm a contender", "rebuilding", etc.
  league_note text,            -- league-specific rules / commissioner notes
  side_a jsonb not null,       -- {"players": [...], "picks": [...]}
  side_b jsonb not null,       -- {"players": [...], "picks": [...]}
  created_at timestamptz not null default now()
);

create index trade_submissions_recent_idx
  on public.trade_submissions (created_at desc);

create index trade_submissions_by_scoring_idx
  on public.trade_submissions (scoring, league_type, created_at desc);

-- Votes: one per (trade, voter). Recasting overwrites.
create table public.trade_votes (
  trade_id uuid not null references public.trade_submissions(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  -- Who won: A, B, or roughly even
  winner text not null check (winner in ('A', 'B', 'EVEN')),
  -- Fairness tier and (when not balanced) which side benefits
  fairness_tier text not null
    check (fairness_tier in (
      'balanced',
      'slight_edge',
      'clear_advantage',
      'major_advantage',
      'extreme_imbalance'
    )),
  fairness_lean text
    check (fairness_lean in ('A', 'B') or fairness_lean is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trade_id, voter_id)
);

create index trade_votes_by_trade_idx
  on public.trade_votes (trade_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.trade_submissions enable row level security;
alter table public.trade_votes enable row level security;

-- Submissions: anyone can read, authenticated users can insert their own.
create policy "trade_submissions public read"
  on public.trade_submissions for select
  using (true);

create policy "trade_submissions: authenticated insert own"
  on public.trade_submissions for insert
  with check (submitter_id = auth.uid());

create policy "trade_submissions: submitter can update own"
  on public.trade_submissions for update
  using (submitter_id = auth.uid())
  with check (submitter_id = auth.uid());

create policy "trade_submissions: submitter can delete own"
  on public.trade_submissions for delete
  using (submitter_id = auth.uid());

-- Votes: anyone can read aggregate (we'll aggregate in queries).
-- Authenticated users can insert/update their own.
create policy "trade_votes public read"
  on public.trade_votes for select
  using (true);

create policy "trade_votes: authenticated cast own"
  on public.trade_votes for insert
  with check (voter_id = auth.uid());

create policy "trade_votes: authenticated update own"
  on public.trade_votes for update
  using (voter_id = auth.uid())
  with check (voter_id = auth.uid());

create policy "trade_votes: voter can delete own"
  on public.trade_votes for delete
  using (voter_id = auth.uid());

-- =====================================================================
-- Consensus view — vote aggregates per trade
-- =====================================================================
create or replace view public.trade_vote_summary as
select
  t.id as trade_id,
  count(v.voter_id) as total_votes,
  count(*) filter (where v.winner = 'A') as votes_a,
  count(*) filter (where v.winner = 'B') as votes_b,
  count(*) filter (where v.winner = 'EVEN') as votes_even,
  count(*) filter (where v.fairness_tier = 'balanced') as tier_balanced,
  count(*) filter (where v.fairness_tier = 'slight_edge') as tier_slight_edge,
  count(*) filter (where v.fairness_tier = 'clear_advantage') as tier_clear_advantage,
  count(*) filter (where v.fairness_tier = 'major_advantage') as tier_major_advantage,
  count(*) filter (where v.fairness_tier = 'extreme_imbalance') as tier_extreme_imbalance,
  count(*) filter (where v.fairness_lean = 'A') as lean_a,
  count(*) filter (where v.fairness_lean = 'B') as lean_b
from public.trade_submissions t
left join public.trade_votes v on v.trade_id = t.id
group by t.id;
