import type { Metadata } from "next";
import { fetchPairBatch } from "./actions";
import RankClient from "./RankClient";

export const metadata: Metadata = {
  title: "Rank · FF Council",
  description:
    "Pick your favorite. The council's Elo ladder updates in real time.",
};

// Always render fresh — Elos shift with every vote, and the initial pair
// batch should reflect the current ladder, not a stale build snapshot.
export const dynamic = "force-dynamic";

export default async function RankPage() {
  // Default to PPR for the initial render; the client can switch and refetch
  // batches for Half/Standard via the URL-stateful scoring selector.
  const initialPairs = await fetchPairBatch({
    scoringSystem: "PPR",
    batchSize: 20,
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <RankClient initialPairs={initialPairs} initialScoring="PPR" />
      </div>
    </main>
  );
}
