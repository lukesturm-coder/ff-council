-- =====================================================================
-- FF Council — Phase 12: Fix trade_vote_summary total_votes
--
-- The original definition used count(v.voter_id), which ignores NULLs.
-- After enabling anonymous voting (migration 009) voter_id can be NULL,
-- so anon votes never counted toward total_votes — producing nonsensical
-- percentages like "22900% favor Team A · 1 vote".
--
-- count(v.id) counts the actual vote rows. The LEFT JOIN still produces
-- NULL v.id for trades with zero votes; count() correctly returns 0 in
-- that case.
-- =====================================================================

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
  count(*) filter (where v.fairness_lean = 'B') as lean_b
from public.trade_submissions t
left join public.trade_votes v on v.trade_id = t.id
group by t.id;
