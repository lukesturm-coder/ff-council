"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, LayoutGrid, Users } from "lucide-react";
import type { PlayerProjection, ScoringSystem } from "@/lib/types";
import ConsensusView, { type ConsensusRow } from "./ConsensusView";
import RankClient from "./rank/RankClient";
import TierBoardEditor, {
  type ExistingRankings,
} from "./rankings/TierBoardEditor";

// One unified rankings surface. A segmented toggle switches between the public
// council consensus and the two personal builders (the Beli tap-flow and the
// drag tier board). Replaces the old separate /council, /council/rank, and
// /council/rankings tabs — those routes now redirect here with ?view=.
//
// Only the active view is mounted: the builders own heavy auto-saving state and
// transitions we don't want running while hidden, and both re-hydrate from
// saved data on mount, so a remount on toggle is cheap and lossless.

export type HubView = "council" | "rank" | "board";

const VIEWS: Array<{
  id: HubView;
  label: string;
  icon: typeof Users;
  // Builders need auth; council is public.
  requiresAuth: boolean;
}> = [
  { id: "council", label: "Council", icon: Users, requiresAuth: false },
  { id: "rank", label: "Quick Rank", icon: ListChecks, requiresAuth: true },
  { id: "board", label: "Tier Board", icon: LayoutGrid, requiresAuth: true },
];

export default function RankingsHub({
  initialView,
  isLoggedIn,
  projections,
  existing,
  consensusByScoring,
  totalApprovedMembers,
}: {
  initialView: HubView;
  isLoggedIn: boolean;
  projections: PlayerProjection[];
  existing: ExistingRankings;
  consensusByScoring: Record<ScoringSystem, ConsensusRow[]>;
  totalApprovedMembers: number;
}) {
  const router = useRouter();
  const [view, setView] = useState<HubView>(initialView);

  const selectView = useCallback(
    (next: HubView) => {
      setView(next);
      // Reflect the active view in the URL (shallow) so it's deep-linkable and
      // the redirects from the old routes land on the right tool.
      const qs = next === "council" ? "" : `?view=${next}`;
      router.replace(`/council${qs}`, { scroll: false });
    },
    [router],
  );

  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <div className="space-y-5">
      {/* Segmented toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const isActive = v.id === view;
            return (
              <button
                key={v.id}
                onClick={() => selectView(v.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
                  isActive
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active view */}
      {view === "council" && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold sm:text-xl">
              Council Consensus
            </h2>
            <p className="text-xs text-zinc-400 sm:text-sm">
              Average ranking across {totalApprovedMembers} council member
              {totalApprovedMembers === 1 ? "" : "s"}&apos; current submissions.
              The <span className="text-zinc-200">spread</span> column shows
              disagreement — high spread = controversial pick. The Edge vs Vegas
              column compares Council consensus to the Vegas Edge ranking.
            </p>
          </div>
          <ConsensusView
            consensusByScoring={consensusByScoring}
            projections={projections}
          />
        </section>
      )}

      {view === "rank" &&
        (isLoggedIn ? (
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold sm:text-xl">
                Quick Rank
              </h2>
              <p className="text-xs text-zinc-400 sm:text-sm">
                Drop each player into a tier, answer a few quick head-to-heads,
                and your full ordered list builds itself. Feeds the Council
                consensus.
              </p>
            </div>
            <RankClient projections={projections} existingRanks={existing} />
          </section>
        ) : (
          <SignInPrompt view="rank" label={active.label} />
        ))}

      {view === "board" &&
        (isLoggedIn ? (
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold sm:text-xl">Tier Board</h2>
              <p className="text-xs text-zinc-400 sm:text-sm">
                Drag players from the pool into tier rows. S holds your best
                across every position; H is droppable. Order within a row
                matters. Auto-saves and feeds the Council consensus.
              </p>
            </div>
            <TierBoardEditor
              projections={projections}
              existingRankings={existing}
            />
          </section>
        ) : (
          <SignInPrompt view="board" label={active.label} />
        ))}
    </div>
  );
}

function SignInPrompt({ view, label }: { view: HubView; label: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
      <h3 className="text-base font-semibold text-zinc-100">
        Sign in to build your rankings
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
        {label} is a personal ranking tool for council members. Sign in to start
        building — your picks feed the Council consensus.
      </p>
      <Link
        href={`/login?redirect=${encodeURIComponent(`/council?view=${view}`)}`}
        className="mt-4 inline-flex rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30"
      >
        Sign in
      </Link>
    </div>
  );
}
