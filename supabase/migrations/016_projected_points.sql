-- =====================================================================
-- FF Council — add projected season fantasy points alongside ranks.
-- Each platform_rankings row already encodes a (player, source, type,
-- scoring) tuple; the rank captures their published rank, and now this
-- column captures the source's projected season FPts when available.
-- Nullable: some sources publish rank without points (Yahoo public
-- pre-rank), and Council is a pure rank with no projection.
-- =====================================================================

alter table public.platform_rankings
  add column if not exists projected_points numeric;
