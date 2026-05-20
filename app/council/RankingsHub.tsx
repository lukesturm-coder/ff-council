"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListOrdered, ListChecks, LayoutGrid } from "lucide-react";
import type { PlayerProjection } from "@/lib/types";
import RankClient from "./rank/RankClient";
import RankListEditor from "./RankListEditor";
import TierBoardEditor, {
  type ExistingRankings,
} from "./rankings/TierBoardEditor";

// "My Rankings" — one personal ranking, three ways to edit it. All three tools
// (List, Quick Rank, Tier Board) read and write the SAME underlying ranking
// (ranking_submissions / ranking_entries), so switching tools just gives you a
// different lens on the same list. Everyone's personal ranking aggregates into
// the Council consensus, which lives on the main /rankings page (not here).
//
// Only the active view is mounted: the editors own heavy auto-saving state and
// transitions we don't want running while hidden, and each re-hydrates from
// saved data on mount, so a remount on toggle is cheap and lossless.

export type HubView = "list" | "rank" | "board";

const VIEWS: Array<{ id: HubView; label: string; icon: typeof ListOrdered }> = [
  { id: "list", label: "List", icon: ListOrdered },
  { id: "rank", label: "Quick Rank", icon: ListChecks },
  { id: "board", label: "Tier Board", icon: LayoutGrid },
];

export default function RankingsHub({
  initialView,
  isLoggedIn,
  projections,
  existing,
}: {
  initialView: HubView;
  isLoggedIn: boolean;
  projections: PlayerProjection[];
  existing: ExistingRankings;
}) {
  const router = useRouter();
  const [view, setView] = useState<HubView>(initialView);

  const selectView = useCallback(
    (next: HubView) => {
      setView(next);
      // Reflect the active tool in the URL so it's deep-linkable and the
      // redirects from the old routes land on the right tool.
      const qs = next === "list" ? "" : `?view=${next}`;
      router.replace(`/council${qs}`, { scroll: false });
    },
    [router],
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold sm:text-xl">My Rankings</h2>
        <p className="text-xs text-zinc-400 sm:text-sm">
          Build your personal ranking — drag a list, tap quick head-to-heads, or
          drop players into tiers. All three edit the same ranking, which feeds
          the Council consensus.
        </p>
      </div>

      {/* Segmented toggle */}
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

      {/* Active tool */}
      {!isLoggedIn ? (
        <SignInPrompt view={view} />
      ) : view === "list" ? (
        <RankListEditor projections={projections} existingRankings={existing} />
      ) : view === "rank" ? (
        <RankClient projections={projections} existingRanks={existing} />
      ) : (
        <TierBoardEditor projections={projections} existingRankings={existing} />
      )}
    </div>
  );
}

function SignInPrompt({ view }: { view: HubView }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
      <h3 className="text-base font-semibold text-zinc-100">
        Sign in to build your rankings
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
        My Rankings is your personal ranking — sign in to start building. Your
        picks feed the Council consensus.
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
