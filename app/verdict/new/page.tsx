import { promises as fs } from "node:fs";
import path from "node:path";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type { FantasyPosition, FuturesResponse } from "@/lib/types";
import VerdictSubmissionForm, {
  type PickablePlayer,
} from "./VerdictSubmissionForm";

// Same loader as app/trades/new/page.tsx — denormalises the futures-based
// projections into the lightweight PickablePlayer shape used by the form's
// search dropdown.
async function loadPlayers(): Promise<PickablePlayer[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  const projections = projectionsFromFutures(futures, roster);
  return projections.map((p) => ({
    player_id: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position as FantasyPosition,
    vegasFptsPPR: p.fantasyPoints.PPR,
  }));
}

export default async function NewVerdictPage() {
  const players = await loadPlayers();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-2xl font-semibold">Ask the Council</h2>
          <p className="text-sm text-zinc-400">
            Stuck on a draft pick or a start/sit? Drop 2-5 candidates and the
            crowd will vote one-tap on who they&apos;d take. No sign-in needed
            to ask or to vote.
          </p>
        </div>

        <VerdictSubmissionForm players={players} />
      </div>
    </main>
  );
}
