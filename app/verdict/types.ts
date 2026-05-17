import type { FantasyPosition } from "@/lib/types";

// Snapshot of a player at submit time, denormalised into the scenario row.
export type VerdictPlayer = {
  player_id: number;
  name: string;
  team: string;
  position: FantasyPosition;
};

export type VerdictScenarioType = "draft" | "start_sit";

// Free-form context payload — fields are mode-dependent.
export type VerdictContext = {
  scoring?: string;
  week?: number | null;
  position_needed?: string | null;
  league_size?: number | null;
  slot_type?: string | null;
  round?: number | null;
};

export type VerdictScenario = {
  id: string;
  asker_id: string | null;
  scenario_type: VerdictScenarioType;
  candidates: VerdictPlayer[];
  roster: VerdictPlayer[] | null;
  context: VerdictContext;
  notes: string | null;
  created_at: string;
};

export type VerdictVoteSummary = {
  byPlayer: Record<number, number>; // player_id → vote count
  total: number;
};
