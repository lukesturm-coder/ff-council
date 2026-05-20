-- =====================================================================
-- FF Council — persist the tier letter on each ranking entry.
--
-- The /council/rankings tier board lets a member drag players into tier
-- rows (S/A/B/C/D/E/F/G/H). The global rank order (S players first, then
-- A, …) is still the canonical artefact that feeds council_consensus, but
-- we also store the tier letter so the board can reload with each player
-- sitting back in the row they were dropped into.
--
-- Nullable: legacy entries (and entries written by the Beli tap-flow,
-- which doesn't always know a tier) have no tier letter. Those players are
-- re-clustered/sent to the unranked pool on load — the board never crashes
-- on a null tier.
-- =====================================================================

alter table public.ranking_entries
  add column if not exists tier text
    check (tier is null or tier in ('S','A','B','C','D','E','F','G','H'));
