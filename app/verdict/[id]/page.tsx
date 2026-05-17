import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { FantasyPosition } from "@/lib/types";
import VerdictVotePanel from "../VerdictVotePanel";
import ShareButton from "./ShareButton";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "../types";

const SITE_URL = "https://www.ffcouncil.com";

// Build SEO/OG metadata from the scenario summary line — same one-liner
// that shows above the page ("Round 4 — RB needed" / "Start/Sit — Week 7
// FLEX") so social previews match what the user clicks into.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("verdict_scenarios")
    .select("scenario_type, context, candidates")
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    const title = "Verdict · FF Council";
    return {
      title,
      description: "Crowdsourced fantasy football verdict.",
      openGraph: {
        title,
        description: "Crowdsourced fantasy football verdict.",
        url: `${SITE_URL}/verdict/${id}`,
      },
    };
  }

  const summary = scenarioSummary(
    data.scenario_type as VerdictScenarioType,
    (data.context ?? {}) as VerdictContext,
  );
  const candidates = (data.candidates ?? []) as VerdictPlayer[];
  const names = candidates.map((c) => c.name).filter(Boolean);
  const candidateLine =
    names.length > 0 ? names.join(" vs ") : "Cast your verdict";
  const title = `${summary} · FF Council`;
  const description = `${candidateLine} — get the council's ruling.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/verdict/${id}`,
    },
  };
}

// =====================================================================
// /verdict/[id] — deep-link detail page for a single scenario.
// Mirrors app/trades/[id]/page.tsx: server component fetches the
// scenario, all votes, and (if signed in) the viewer's existing vote.
// Voting itself is delegated to <VerdictVotePanel /> (one-tap client
// component) so behavior matches the list-page modal.
// =====================================================================

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

const TYPE_LABEL: Record<VerdictScenarioType, string> = {
  draft: "Draft",
  start_sit: "Start/Sit",
};

// Compact relative time formatter — keeps the header lean ("3h ago",
// "2d ago"). Falls back to a date string after a week.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Build a one-line summary for the header — e.g. "Draft pick — RB needed"
// or "Start/Sit — Week 7 FLEX". Falls back gracefully when fields are
// missing from the context blob.
function scenarioSummary(
  type: VerdictScenarioType,
  ctx: VerdictContext,
): string {
  if (type === "draft") {
    const round = ctx.round ? `Round ${ctx.round}` : "Draft pick";
    const need = ctx.position_needed ? ` — ${ctx.position_needed} needed` : "";
    return `${round}${need}`;
  }
  const week = ctx.week ? `Week ${ctx.week}` : "Start/Sit";
  const slot = ctx.slot_type ? ` ${ctx.slot_type}` : "";
  return `Start/Sit — ${week}${slot}`.replace(/\s+/g, " ").trim();
}

type ScenarioRow = {
  id: string;
  asker_id: string | null;
  scenario_type: VerdictScenarioType;
  candidates: VerdictPlayer[] | null;
  roster: VerdictPlayer[] | null;
  context: VerdictContext | null;
  notes: string | null;
  image_url: string | null;
  created_at: string;
};

export default async function VerdictDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Single round-trip: scenario, all votes for that scenario, and
  // current auth state. The viewer's own vote needs the user id so it's
  // fetched separately below if signed in.
  const [scenarioRes, votesRes, authRes] = await Promise.all([
    supabase
      .from("verdict_scenarios")
      .select(
        "id, asker_id, scenario_type, candidates, roster, context, notes, image_url, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("verdict_votes")
      .select("pick_player_id, voter_id")
      .eq("scenario_id", id),
    supabase.auth.getUser(),
  ]);

  if (!scenarioRes.data) {
    notFound();
  }

  const scenario = scenarioRes.data as ScenarioRow;
  const candidates: VerdictPlayer[] = scenario.candidates ?? [];
  const roster: VerdictPlayer[] = scenario.roster ?? [];
  const context: VerdictContext = scenario.context ?? {};
  const user = authRes.data?.user ?? null;

  // Aggregate votes: { byPlayer, total }. Also remember the signed-in
  // viewer's existing pick (if any) so the panel can highlight it.
  const byPlayer: Record<number, number> = {};
  let total = 0;
  let myPickPlayerId: number | null = null;
  for (const v of votesRes.data ?? []) {
    const pid = v.pick_player_id as number;
    byPlayer[pid] = (byPlayer[pid] ?? 0) + 1;
    total += 1;
    if (user && (v.voter_id as string | null) === user.id) {
      myPickPlayerId = pid;
    }
  }

  // Look up submitter display name when the scenario isn't anonymous.
  // RLS allows public read of approved council members; if the asker
  // isn't a council member we just leave it as "Submitted by anon".
  let submitterName: string | null = null;
  if (scenario.asker_id) {
    const { data: memberRow } = await supabase
      .from("council_members")
      .select("display_name")
      .eq("user_id", scenario.asker_id)
      .maybeSingle();
    submitterName =
      (memberRow?.display_name as string | undefined) ?? null;
  }

  // Top-voted candidate for the verdict-summary highlight. Ties resolve
  // to whichever appears first in the array — a tiny, stable choice.
  let topPlayerId: number | null = null;
  let topCount = 0;
  for (const c of candidates) {
    const n = byPlayer[c.player_id] ?? 0;
    if (n > topCount) {
      topCount = n;
      topPlayerId = c.player_id;
    }
  }

  const summary = scenarioSummary(scenario.scenario_type, context);
  const submittedBy = submitterName ?? "anon";
  const created = relativeTime(scenario.created_at);

  // Context line: only render fields that are actually present in the
  // jsonb blob, joined with middle dots.
  const ctxBits: string[] = [];
  if (context.scoring) ctxBits.push(context.scoring);
  if (context.league_size) ctxBits.push(`${context.league_size}-team`);
  if (scenario.scenario_type === "draft") {
    if (context.round != null) ctxBits.push(`Round ${context.round}`);
    if (context.position_needed)
      ctxBits.push(`need ${context.position_needed}`);
  } else {
    if (context.week != null) ctxBits.push(`Week ${context.week}`);
    if (context.slot_type) ctxBits.push(context.slot_type);
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset ring-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                {TYPE_LABEL[scenario.scenario_type]}
              </span>
              <h2 className="text-xl font-semibold">{summary}</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Submitted by {submittedBy}
              {created ? ` · ${created}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ShareButton scenarioId={scenario.id} />
          </div>
        </div>

        {/* Context line */}
        {ctxBits.length > 0 && (
          <p className="mb-4 text-xs text-zinc-400 sm:text-sm">
            {ctxBits.join(" · ")}
          </p>
        )}

        {/* Screenshot */}
        {scenario.image_url && (
          <div className="mb-4 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={scenario.image_url}
              alt="Scenario screenshot"
              className="w-full object-contain"
            />
          </div>
        )}

        {/* Notes */}
        {scenario.notes && scenario.notes.trim().length > 0 && (
          <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-300">
              {scenario.notes}
            </p>
          </div>
        )}

        {/* Current roster (draft mode) */}
        {roster.length > 0 && (
          <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Current roster
            </h3>
            <div className="space-y-2">
              {roster.map((p, idx) => (
                <div
                  key={`r-${idx}-${p.player_id}`}
                  className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-sm sm:px-3"
                >
                  <span
                    className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
                  >
                    {p.position}
                  </span>
                  <span className="flex-1 truncate font-medium text-zinc-100">
                    {p.name}
                  </span>
                  <span className="w-10 text-right font-mono text-xs text-zinc-400">
                    {p.team}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FF Council Verdict — aggregate counts + top pick highlight.
           The headline result is the anchor of the page when votes exist,
           so it gets a gradient frame, oversized percentage, and a named
           winner before the per-candidate breakdown. */}
        {(() => {
          const topPct =
            total > 0 && topPlayerId != null
              ? Math.round((topCount / total) * 100)
              : 0;
          const topPlayer =
            topPlayerId != null
              ? candidates.find((c) => c.player_id === topPlayerId) ?? null
              : null;
          return (
            <div
              className={`mb-4 overflow-hidden rounded-lg border p-4 sm:p-5 ${
                total === 0
                  ? "border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900"
                  : "border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-zinc-900"
              }`}
            >
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300/90">
                FF Council Verdict
              </h3>
              {total === 0 ? (
                <div>
                  <p className="text-lg font-bold text-zinc-100">
                    Awaiting the council&apos;s ruling.
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    No votes yet — be the first to weigh in below.
                  </p>
                </div>
              ) : (
                <>
                  {topPlayer && (
                    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-4xl font-bold leading-none tabular-nums text-emerald-300 sm:text-5xl">
                        {topPct}%
                      </span>
                      <p className="text-sm text-zinc-300 sm:text-base">
                        favor{" "}
                        <span className="font-semibold text-zinc-50">
                          {topPlayer.name}
                        </span>
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {candidates.map((c) => {
                      const count = byPlayer[c.player_id] ?? 0;
                      const pct =
                        total > 0 ? Math.round((count / total) * 100) : 0;
                      const isTop = c.player_id === topPlayerId && count > 0;
                      return (
                        <div
                          key={`v-${c.player_id}`}
                          className={`relative overflow-hidden rounded-md border px-3 py-2 ${
                            isTop
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : "border-zinc-800 bg-zinc-950"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute inset-y-0 left-0 animate-bar-grow ${
                              isTop ? "bg-emerald-500/20" : "bg-zinc-700/30"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative flex items-center gap-2 text-sm">
                            <span
                              className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[c.position]}`}
                            >
                              {c.position}
                            </span>
                            <span
                              className={`flex-1 truncate ${
                                isTop
                                  ? "font-semibold text-emerald-100"
                                  : "font-medium text-zinc-100"
                              }`}
                            >
                              {c.name}
                            </span>
                            <span className="font-mono text-xs text-zinc-500">
                              {c.team}
                            </span>
                            <span
                              className={`ml-1 shrink-0 font-mono text-xs tabular-nums ${
                                isTop ? "font-semibold text-emerald-200" : "text-zinc-300"
                              }`}
                            >
                              {count} ({pct}%)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-xs text-zinc-500">
                      {total} vote{total === 1 ? "" : "s"} cast
                    </p>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* One-tap voting */}
        <VerdictVotePanel
          scenarioId={scenario.id}
          candidates={candidates}
          voteCounts={byPlayer}
          totalVotes={total}
          myPickPlayerId={myPickPlayerId}
        />

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between text-xs">
          <Link
            href="/verdict"
            className="text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← All verdicts
          </Link>
          <ShareButton scenarioId={scenario.id} />
        </div>
      </div>
    </main>
  );
}
