import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import VerdictListClient, {
  type VerdictCardData,
} from "./VerdictListClient";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "./types";

export const metadata: Metadata = {
  title: "Verdict · FF Council",
  description:
    "Submit your toughest start/sit and draft calls — get a fast council ruling on the tough call.",
};

// =====================================================================
// /verdict — list page for the crowdsourced "tough call" tool.
// Mirrors /trades/page.tsx: server component loads recent scenarios
// + per-scenario vote tallies, then hands off to a client component
// for the card grid + modal voting flow.
//
// Filter state lives in URL search params so links are shareable.
//   ?type=all|draft|start_sit
//   ?scoring=all|PPR|Half|Standard
// =====================================================================

type TypeFilter = "all" | VerdictScenarioType;
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "start_sit", label: "Start/Sit" },
];

const SCORING_FILTERS = ["all", "PPR", "Half", "Standard"] as const;
type ScoringFilter = (typeof SCORING_FILTERS)[number];

type SortMode = "recent" | "controversial" | "popular";
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "controversial", label: "Most controversial" },
  { value: "popular", label: "Most voted" },
];

// Minimum vote threshold for an item to qualify for the controversial /
// popular sort. Anything below this falls to the bottom so a 1-1 2-vote
// split doesn't trump a real split with 200 votes.
const MIN_VOTES_FOR_RANKED_SORT = 10;

export default async function VerdictIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; scoring?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const typeFilter: TypeFilter =
    TYPE_FILTERS.find((o) => o.value === params.type)?.value ?? "all";
  const scoringFilter: ScoringFilter =
    (SCORING_FILTERS as readonly string[]).includes(params.scoring ?? "")
      ? (params.scoring as ScoringFilter)
      : "all";
  const sortMode: SortMode =
    SORT_OPTIONS.find((o) => o.value === params.sort)?.value ?? "recent";

  const supabase = await createClient();

  let query = supabase
    .from("verdict_scenarios")
    .select(
      "id, asker_id, scenario_type, candidates, roster, context, notes, image_url, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (typeFilter !== "all") {
    query = query.eq("scenario_type", typeFilter);
  }

  const { data: scenarios } = await query;
  const rowsRaw = scenarios ?? [];

  // Scoring filter is applied client-side because it lives inside the
  // jsonb context blob (not its own column). Cheap at 100-row scale.
  const filteredScenarios = rowsRaw.filter((s) => {
    if (scoringFilter === "all") return true;
    const ctx = (s.context as VerdictContext | null) ?? {};
    return ctx.scoring === scoringFilter;
  });

  const ids = filteredScenarios.map((s) => s.id as string);

  // Fetch all votes for these scenarios in a single query, then aggregate
  // per scenario into { byPlayer, total }.
  const tallyByScenario = new Map<
    string,
    { byPlayer: Record<number, number>; total: number }
  >();
  if (ids.length > 0) {
    const { data: votes } = await supabase
      .from("verdict_votes")
      .select("scenario_id, pick_player_id")
      .in("scenario_id", ids);
    for (const v of votes ?? []) {
      const sid = v.scenario_id as string;
      const pid = v.pick_player_id as number;
      const t = tallyByScenario.get(sid) ?? { byPlayer: {}, total: 0 };
      t.byPlayer[pid] = (t.byPlayer[pid] ?? 0) + 1;
      t.total += 1;
      tallyByScenario.set(sid, t);
    }
  }

  const rows: VerdictCardData[] = filteredScenarios.map((s) => ({
    id: s.id as string,
    scenario_type: s.scenario_type as VerdictScenarioType,
    candidates: (s.candidates as VerdictPlayer[]) ?? [],
    roster: (s.roster as VerdictPlayer[] | null) ?? null,
    context: (s.context as VerdictContext) ?? {},
    notes: (s.notes as string | null) ?? null,
    image_url: (s.image_url as string | null) ?? null,
    created_at: s.created_at as string,
    tally: tallyByScenario.get(s.id as string) ?? { byPlayer: {}, total: 0 },
  }));

  // Apply derived-metric sorts in-app. Default ordering (recent) was set by
  // the DB query above so we only re-sort for the other modes.
  if (sortMode === "popular") {
    rows.sort((a, b) => b.tally.total - a.tally.total);
  } else if (sortMode === "controversial") {
    // Controversy = 1 - (top share - runner-up share). Requires >= 2
    // candidates with actual votes and total >= threshold; ineligible rows
    // score -1 so they sort to the bottom (newer first within them).
    const controversyScore = (r: VerdictCardData): number => {
      if (r.tally.total < MIN_VOTES_FOR_RANKED_SORT) return -1;
      const shares = Object.values(r.tally.byPlayer)
        .filter((c) => c > 0)
        .map((c) => c / r.tally.total)
        .sort((a, b) => b - a);
      if (shares.length < 2) return -1;
      return 1 - (shares[0] - shares[1]);
    };
    rows.sort((a, b) => {
      const diff = controversyScore(b) - controversyScore(a);
      if (diff !== 0) return diff;
      return a.created_at < b.created_at ? 1 : -1;
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Verdict</h2>
            <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
              Stuck on a tough call? Post your draft pick or start/sit. The
              council votes one-tap.
            </p>
          </div>
          <Link
            href="/verdict/new"
            className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 sm:self-auto"
          >
            <Send className="h-3.5 w-3.5" />
            Post a tough call
          </Link>
        </div>

        {/* Filters bar — pill rows for sort + type + scoring */}
        <div className="mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto text-xs sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterPillRow
            label="Sort"
            options={SORT_OPTIONS}
            current={sortMode}
            param="sort"
            otherParams={{ type: typeFilter, scoring: scoringFilter }}
          />
          <FilterPillRow
            label="Type"
            options={TYPE_FILTERS}
            current={typeFilter}
            param="type"
            otherParams={{ scoring: scoringFilter, sort: sortMode }}
          />
          <FilterPillRow
            label="Scoring"
            options={SCORING_FILTERS.map((s) => ({
              value: s,
              label: s === "all" ? "All scoring" : s,
            }))}
            current={scoringFilter}
            param="scoring"
            otherParams={{ type: typeFilter, sort: sortMode }}
          />
          <span className="ml-auto shrink-0 text-zinc-500">
            {rows.length} scenario{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-10 text-center">
            {rowsRaw.length === 0 ? (
              <>
                <p className="text-lg font-bold text-emerald-300">
                  No verdicts yet.
                </p>
                <p className="mt-2 text-sm text-zinc-300">
                  Post the first tough call. The council will weigh in.
                </p>
                <Link
                  href="/verdict/new"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30"
                >
                  <Send className="h-3.5 w-3.5" />
                  Post a tough call
                </Link>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                No scenarios match these filters yet.
              </p>
            )}
          </div>
        ) : (
          <VerdictListClient scenarios={rows} />
        )}
      </div>
    </main>
  );
}

function FilterPillRow({
  label,
  options,
  current,
  param,
  otherParams,
}: {
  label: string;
  options: { value: string; label: string }[];
  current: string;
  param: string;
  otherParams: Record<string, string>;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
      <span className="px-1.5 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {options.map((opt) => {
        const allParams = { ...otherParams, [param]: opt.value };
        const qs = new URLSearchParams(allParams).toString();
        const isActive = current === opt.value;
        return (
          <Link
            key={opt.value}
            href={`/verdict?${qs}`}
            className={`rounded px-2 py-0.5 text-xs font-medium transition ${
              isActive
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
