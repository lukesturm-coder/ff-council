"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Flame, Loader2, SkipForward, Sparkles } from "lucide-react";
import { castVote } from "@/app/trades/[id]/actions";
import { castVerdictVote } from "@/app/verdict/actions";

// Streak milestones — each one gets a little celebratory toast in the
// post-vote flash. Tiered so the dopamine keeps coming as you go deeper.
const STREAK_MILESTONES: Record<number, string> = {
  3: "Hot start.",
  5: "5 in a row.",
  10: "Council regular.",
  15: "On a tear.",
  25: "Verdict machine.",
  50: "Council elder.",
  100: "Cementing your seat.",
};

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

type VerdictCandidate = {
  player_id: number;
  name: string;
  team: string;
  position: string;
};

export type JudgeTradeItem = {
  kind: "trade";
  id: string;
  league_type: string;
  scoring: string;
  side_a: Side;
  side_b: Side;
  created_at: string;
};

export type JudgeVerdictItem = {
  kind: "verdict";
  id: string;
  scenario_type: "draft" | "start_sit";
  candidates: VerdictCandidate[];
  roster: VerdictCandidate[] | null;
  context: Record<string, unknown>;
  notes: string | null;
  image_url: string | null;
  created_at: string;
};

export type JudgeItem = JudgeTradeItem | JudgeVerdictItem;

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

function pickLabel(p: SidePick): string {
  return `${p.year} R${p.round}${
    p.slot ? `.${String(p.slot).padStart(2, "0")}` : ""
  }`;
}

export default function JudgeFeed({
  feed,
  // signedIn is unused for now — kept so the page can pass it along if we
  // later want to gate features (e.g. streak tracking server-side).
  signedIn: _signedIn,
}: {
  feed: JudgeItem[];
  signedIn: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [judged, setJudged] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [flashSub, setFlashSub] = useState<string | null>(null);
  // Track which option the user just picked so we can ring-pulse it
  // before the card advances. Cleared on advance().
  const [justPicked, setJustPicked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = feed[index];
  const remaining = feed.length - index;

  function advance() {
    setIndex((i) => i + 1);
    setJustPicked(null);
  }

  function skip() {
    setSkipped((s) => s + 1);
    advance();
  }

  function flashAndAdvance(msg: string, pickKey: string) {
    setJustPicked(pickKey);
    setFlashMsg(msg);
    // Compute streak milestone for the soon-to-be-incremented count.
    const nextJudged = judged + 1;
    setFlashSub(STREAK_MILESTONES[nextJudged] ?? null);
    setJudged(nextJudged);
    // Snappier than before (was 600ms). 350ms keeps it crisp without
    // skipping the visual confirmation.
    setTimeout(() => {
      setFlashMsg(null);
      setFlashSub(null);
      advance();
    }, 380);
  }

  function tradeQuickVote(tradeId: string, winner: "A" | "B" | "EVEN") {
    if (pending) return;
    startTransition(async () => {
      const res = await castVote({
        tradeId,
        winner,
        fairnessTier: winner === "EVEN" ? "balanced" : "slight_edge",
        fairnessLean: winner === "EVEN" ? null : winner,
      });
      if (res.ok) flashAndAdvance("Vote recorded", `trade:${winner}`);
      else setFlashMsg(`Error: ${res.error}`);
    });
  }

  function verdictQuickVote(scenarioId: string, pickPlayerId: number) {
    if (pending) return;
    startTransition(async () => {
      const res = await castVerdictVote({ scenarioId, pickPlayerId });
      if (res.ok)
        flashAndAdvance("Vote recorded", `verdict:${pickPlayerId}`);
      else setFlashMsg(`Error: ${res.error}`);
    });
  }

  // End state
  if (!current) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-zinc-900 p-8 text-center">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
          <Sparkles className="h-6 w-6 text-emerald-300" />
        </div>
        <p className="text-3xl font-bold text-emerald-300 tabular-nums">
          {judged}
        </p>
        <p className="mt-1 text-sm font-medium text-zinc-200">
          verdict{judged === 1 ? "" : "s"} rendered.
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          That&apos;s every open scenario in the queue.
        </p>
        {skipped > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            Skipped {skipped} along the way.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/trades"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Browse Trade Court
          </Link>
          <Link
            href="/verdict"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Browse Verdict
          </Link>
          <Link
            href="/verdict/new"
            className="rounded-md bg-emerald-500/20 px-4 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30"
          >
            Post your own tough call
          </Link>
        </div>
      </div>
    );
  }

  // Compute the upcoming streak milestone hint, shown in the header so the
  // user can see the next reward without it being shoved in their face.
  const nextMilestone = (() => {
    const keys = Object.keys(STREAK_MILESTONES)
      .map(Number)
      .sort((a, b) => a - b);
    for (const k of keys) if (k > judged) return k;
    return null;
  })();

  return (
    <div className="space-y-3">
      {/* Header stats */}
      <div className="flex items-center justify-between text-xs">
        <div
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ring-1 transition ${
            judged > 0
              ? "bg-amber-500/10 ring-amber-500/30"
              : "bg-zinc-900 ring-zinc-800"
          }`}
        >
          <Flame
            className={`h-3.5 w-3.5 ${judged > 0 ? "text-amber-400" : "text-zinc-600"}`}
          />
          <span className="text-zinc-300">Judged</span>
          <span
            className={`font-mono tabular-nums ${
              judged > 0 ? "font-semibold text-amber-200" : "text-zinc-100"
            }`}
          >
            {judged}
          </span>
          {nextMilestone != null && judged > 0 && (
            <span className="hidden text-[10px] text-zinc-500 sm:inline">
              → {nextMilestone}
            </span>
          )}
        </div>
        <div className="text-zinc-500 tabular-nums">{remaining} left</div>
      </div>

      {/* The card */}
      <div className="relative rounded-2xl border border-zinc-700/60 bg-zinc-900 p-4 shadow-xl shadow-emerald-900/5 sm:p-6">
        {flashMsg && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-500/10 backdrop-blur-sm">
            {!flashMsg.startsWith("Error") && (
              <span className="inline-flex h-10 w-10 animate-pop-in items-center justify-center rounded-full bg-emerald-500/30 ring-2 ring-emerald-400/60">
                <Check className="h-5 w-5 text-emerald-100" strokeWidth={3} />
              </span>
            )}
            <span
              className={`text-base font-semibold ${
                flashMsg.startsWith("Error")
                  ? "text-rose-300"
                  : "text-emerald-100"
              }`}
            >
              {flashMsg}
            </span>
            {flashSub && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-200 ring-1 ring-amber-500/40">
                <Flame className="h-3 w-3" />
                {flashSub}
              </span>
            )}
          </div>
        )}

        {current.kind === "trade" ? (
          <TradeCard
            item={current}
            pending={pending}
            justPicked={justPicked}
            onPick={(w) => tradeQuickVote(current.id, w)}
          />
        ) : (
          <VerdictCard
            item={current}
            pending={pending}
            justPicked={justPicked}
            onPick={(pid) => verdictQuickVote(current.id, pid)}
          />
        )}

        {/* Skip + view-full footer */}
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500">
          <button
            type="button"
            onClick={skip}
            disabled={pending}
            className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-zinc-300 hover:underline disabled:opacity-50"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </button>
          <Link
            href={
              current.kind === "trade"
                ? `/trades/${current.id}`
                : `/verdict/${current.id}`
            }
            className="underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            See full scenario →
          </Link>
        </div>
      </div>
    </div>
  );
}

function TradeCard({
  item,
  pending,
  justPicked,
  onPick,
}: {
  item: JudgeTradeItem;
  pending: boolean;
  justPicked: string | null;
  onPick: (w: "A" | "B" | "EVEN") => void;
}) {
  const pickedA = justPicked === "trade:A";
  const pickedB = justPicked === "trade:B";
  const pickedEven = justPicked === "trade:EVEN";
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200 ring-1 ring-inset ring-amber-500/30">
          Trade
        </span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          {item.league_type} · {item.scoring}
        </span>
      </div>

      <p className="mb-3 text-sm text-zinc-300">
        <span className="font-semibold text-zinc-100">Who won?</span>{" "}
        <span className="text-zinc-500">Tap a side.</span>
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onPick("A")}
          className={`min-h-[44px] cursor-pointer rounded-lg border p-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
            pickedA
              ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/10"
              : "border-zinc-800 bg-zinc-950/60 hover:border-rose-500/50 hover:bg-rose-500/5"
          }`}
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-300">
            Team A wins
          </div>
          <SideBody side={item.side_a} />
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onPick("B")}
          className={`min-h-[44px] cursor-pointer rounded-lg border p-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
            pickedB
              ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/10"
              : "border-zinc-800 bg-zinc-950/60 hover:border-sky-500/50 hover:bg-sky-500/5"
          }`}
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-sky-300">
            Team B wins
          </div>
          <SideBody side={item.side_b} />
        </button>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => onPick("EVEN")}
        className={`mt-2 min-h-[44px] w-full rounded-lg border px-3 py-2.5 text-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
          pickedEven
            ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/10 text-emerald-100"
            : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/40"
        }`}
      >
        {pending ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        ) : (
          "Even — balanced trade"
        )}
      </button>
    </div>
  );
}

function VerdictCard({
  item,
  pending,
  justPicked,
  onPick,
}: {
  item: JudgeVerdictItem;
  pending: boolean;
  justPicked: string | null;
  onPick: (playerId: number) => void;
}) {
  const ctx = item.context as {
    scoring?: string;
    week?: number | null;
    position_needed?: string | null;
    league_size?: number | null;
    slot_type?: string | null;
    round?: number | null;
  };
  const meta: string[] = [];
  if (ctx.scoring) meta.push(String(ctx.scoring));
  if (item.scenario_type === "draft") {
    if (ctx.round != null) meta.push(`Round ${ctx.round}`);
    if (ctx.position_needed) meta.push(`needs ${ctx.position_needed}`);
    if (ctx.league_size != null) meta.push(`${ctx.league_size}-team`);
  } else {
    if (ctx.slot_type) meta.push(String(ctx.slot_type));
    if (ctx.week != null) meta.push(`Week ${ctx.week}`);
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200 ring-1 ring-inset ring-emerald-500/30">
          {item.scenario_type === "draft" ? "Draft" : "Start / Sit"}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          {meta.join(" · ")}
        </span>
      </div>

      <p className="mb-3 text-sm text-zinc-300">
        <span className="font-semibold text-zinc-100">
          {item.scenario_type === "draft"
            ? "Who do you draft?"
            : "Who do you start?"}
        </span>{" "}
        <span className="text-zinc-500">Tap your pick.</span>
      </p>

      {item.image_url && (
        <div className="mb-3 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.image_url}
            alt="Scenario screenshot"
            className="max-h-[40vh] w-full object-contain"
          />
        </div>
      )}

      {item.notes && item.notes.trim().length > 0 && (
        <p className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 text-sm text-zinc-300">
          {item.notes}
        </p>
      )}

      {item.roster && item.roster.length > 0 && (
        <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Current roster
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {item.roster.map((p) => (
              <div key={`r-${p.player_id}`} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                    POSITION_STYLES[p.position] ??
                    "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
                  }`}
                >
                  {p.position}
                </span>
                <span className="text-sm text-zinc-200">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {item.candidates.map((c) => {
          const isPicked = justPicked === `verdict:${c.player_id}`;
          return (
            <button
              key={c.player_id}
              type="button"
              disabled={pending}
              onClick={() => onPick(c.player_id)}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
                isPicked
                  ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-950/60 hover:border-emerald-500/40 hover:bg-emerald-500/5"
              }`}
            >
              <span
                className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                  POSITION_STYLES[c.position] ??
                  "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
                }`}
              >
                {c.position}
              </span>
              <span className="flex-1 font-medium text-zinc-100">{c.name}</span>
              <span className="font-mono text-xs text-zinc-500">{c.team}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SideBody({ side }: { side: Side }) {
  const items: { key: string; node: React.ReactNode }[] = [];
  side.players.slice(0, 4).forEach((p, idx) =>
    items.push({
      key: `p-${idx}`,
      node: (
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
              POSITION_STYLES[p.position] ??
              "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
            }`}
          >
            {p.position}
          </span>
          <span className="truncate text-zinc-100">{p.name}</span>
          <span className="ml-auto font-mono text-xs text-zinc-500">{p.team}</span>
        </div>
      ),
    }),
  );
  side.picks.slice(0, 3).forEach((p, idx) =>
    items.push({
      key: `pk-${idx}`,
      node: (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="inline-flex shrink-0 rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
            pick
          </span>
          <span className="font-mono">{pickLabel(p)}</span>
        </div>
      ),
    }),
  );
  const overflow =
    side.players.length + side.picks.length - items.length;
  return (
    <div className="space-y-1.5">
      {items.length === 0 ? (
        <span className="text-xs text-zinc-600">—</span>
      ) : (
        items.map(({ key, node }) => <div key={key}>{node}</div>)
      )}
      {overflow > 0 && (
        <p className="text-[10px] text-zinc-500">+ {overflow} more</p>
      )}
    </div>
  );
}
