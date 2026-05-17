import { promises as fs } from "node:fs";
import path from "node:path";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FantasyPosition,
  FuturesResponse,
  PlayerProjection,
} from "@/lib/types";
import MockDraft, { type DraftablePlayer } from "./MockDraft";

async function loadDraftablePlayers(): Promise<DraftablePlayer[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  const projections = projectionsFromFutures(futures, roster);
  return projections.map((p: PlayerProjection) => ({
    player_id: p.playerId,
    name: p.name,
    team: p.team,
    position: p.position as FantasyPosition,
    fpts: p.fantasyPoints,
    vbd: p.vbd,
  }));
}

export default async function DraftPage() {
  const players = await loadDraftablePlayers();
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">

        <div className="mb-4 border-b border-zinc-800 pb-3">
          <h2 className="text-xl font-semibold sm:text-2xl">Mock Draft</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Snake draft. AI opponents pick by Edge + position need. Test your
            strategy before the real thing.
          </p>
        </div>

        <MockDraft players={players} />
      </div>
    </main>
  );
}
