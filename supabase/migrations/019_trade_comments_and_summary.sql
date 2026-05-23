-- =====================================================================
-- FF Council — Phase 19: Trade quick-take comments + per-side tier summary
--
-- Two changes that power the redesigned (Polymarket-style) trade voting:
--
-- 1. trade_comments — fast "quick take" comments under a trade's consensus
--    reveal. Sign-in required to post (one row per take, no threading);
--    public read. Author display name is snapshotted so reads need no join.
--
-- 2. trade_vote_summary gains per-SIDE tier counts (a_*, b_*). The weighted
--    verdict (lib/trade-verdict verdictFromCounts) and the 5-bucket sentiment
--    distribution need the tier×winner cross-tab, which the old summary didn't
--    expose. Reading one summary row per trade is exact and uncapped — unlike
--    selecting raw vote rows, which PostgREST caps at ~1000.
-- =====================================================================

-- ---- trade_comments ----------------------------------------------------
create table if not exists public.trade_comments (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trade_submissions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists trade_comments_by_trade_idx
  on public.trade_comments (trade_id, created_at desc);

alter table public.trade_comments enable row level security;

create policy "trade_comments public read"
  on public.trade_comments for select
  using (true);

create policy "trade_comments author insert"
  on public.trade_comments for insert
  with check (author_id = auth.uid());

create policy "trade_comments author delete"
  on public.trade_comments for delete
  using (author_id = auth.uid());

-- ---- trade_vote_summary: add per-side tier counts ----------------------
create or replace view public.trade_vote_summary as
select
  t.id as trade_id,
  count(v.id) as total_votes,
  count(*) filter (where v.winner = 'A') as votes_a,
  count(*) filter (where v.winner = 'B') as votes_b,
  count(*) filter (where v.winner = 'EVEN') as votes_even,
  count(*) filter (where v.fairness_tier = 'balanced') as tier_balanced,
  count(*) filter (where v.fairness_tier = 'slight_edge') as tier_slight_edge,
  count(*) filter (where v.fairness_tier = 'clear_advantage') as tier_clear_advantage,
  count(*) filter (where v.fairness_tier = 'major_advantage') as tier_major_advantage,
  count(*) filter (where v.fairness_tier = 'extreme_imbalance') as tier_extreme_imbalance,
  count(*) filter (where v.fairness_lean = 'A') as lean_a,
  count(*) filter (where v.fairness_lean = 'B') as lean_b,
  -- Per-side tier cross-tab (drives the weighted verdict + sentiment buckets).
  count(*) filter (where v.winner = 'A' and v.fairness_tier = 'slight_edge') as a_slight_edge,
  count(*) filter (where v.winner = 'A' and v.fairness_tier = 'clear_advantage') as a_clear_advantage,
  count(*) filter (where v.winner = 'A' and v.fairness_tier = 'major_advantage') as a_major_advantage,
  count(*) filter (where v.winner = 'A' and v.fairness_tier = 'extreme_imbalance') as a_extreme_imbalance,
  count(*) filter (where v.winner = 'B' and v.fairness_tier = 'slight_edge') as b_slight_edge,
  count(*) filter (where v.winner = 'B' and v.fairness_tier = 'clear_advantage') as b_clear_advantage,
  count(*) filter (where v.winner = 'B' and v.fairness_tier = 'major_advantage') as b_major_advantage,
  count(*) filter (where v.winner = 'B' and v.fairness_tier = 'extreme_imbalance') as b_extreme_imbalance
from public.trade_submissions t
left join public.trade_votes v on v.trade_id = t.id
group by t.id;
