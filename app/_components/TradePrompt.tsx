import { createClient } from "@/lib/supabase/server";
import TradePromptClient from "./TradePromptClient";

type SidePlayer = { name: string; team: string; position: string };
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

/**
 * Server component: picks the freshest pending trade and hands it to the
 * client widget. Currently "freshest = most recent". Later we can prioritise
 * trades with the fewest votes to direct attention where the council needs
 * it most.
 */
export default async function TradePrompt() {
  const supabase = await createClient();
  const { data: trade } = await supabase
    .from("trade_submissions")
    .select("id, side_a, side_b, scoring, league_type")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!trade) return null;

  return (
    <TradePromptClient
      tradeId={trade.id as string}
      sideA={trade.side_a as Side}
      sideB={trade.side_b as Side}
      scoring={trade.scoring as string}
      leagueType={trade.league_type as string}
    />
  );
}
