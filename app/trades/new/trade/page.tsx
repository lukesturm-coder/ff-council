import { promises as fs } from "node:fs";
import path from "node:path";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FantasyPosition,
  FuturesResponse,
} from "@/lib/types";
import TradeSubmissionForm, {
  type PickablePlayer,
} from "./TradeSubmissionForm";

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

export default async function NewTradePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    a?: string; // prefill from trade calculator
    b?: string;
  }>;
}) {
  const params = await searchParams;
  const players = await loadPlayers();

  // Parse pre-fill from trade calculator (URL-encoded player IDs)
  const prefillA = (params.a ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const prefillB = (params.b ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-2xl font-semibold">Submit a Trade for Council Review</h2>
          <p className="text-sm text-zinc-400">
            Trade gets a public page. Anyone can submit — no sign-in needed.
            Signed-in members can then vote which side won and rate the
            fairness. Consensus emerges from the crowd.
          </p>
        </div>

        {params.error && (
          <p className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">
            {decodeURIComponent(params.error)}
          </p>
        )}

        <TradeSubmissionForm
          players={players}
          prefillA={prefillA}
          prefillB={prefillB}
        />
      </div>
    </main>
  );
}
