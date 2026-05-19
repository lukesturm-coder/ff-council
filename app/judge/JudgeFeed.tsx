"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Flame, Loader2, Scale, Sparkles } from "lucide-react";
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

export default function JudgeFeed({ feed }: { feed: JudgeItem[] }) {
  const [index, setIndex] = useState(0);
  const [judged, setJudged] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [flashSub, setFlashSub] = useState<string | null>(null);
  // After a successful vote: "you said X · council says Y, 73%" feedback
  // shown in the flash. Null when there are no other votes yet (you're
  // the first to weigh in).
  const [flashAgreement, setFlashAgreement] = useState<{
    matched: boolean;
    topLabel: string;
    pct: number;
  } | null>(null);
  // Track which option the user just picked so we can ring-pulse it
  // before the card advances. Cleared on advance().
  const [justPicked, setJustPicked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = feed[index];
  const remaining = feed.length - index;

  function advance() {
    // Drop focus from any just-tapped button so its :focus / :hover
    // (sticky on iOS) state doesn't visually bleed onto the next card.
    if (typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
    }
    setIndex((i) => i + 1);
    setJustPicked(null);
  }

  function skip() {
    setSkipped((s) => s + 1);
    advance();
  }

  function flashAndAdvance(
    msg: string,
    pickKey: string,
    agreement: { matched: boolean; topLabel: string; pct: number } | null,
  ) {
    setJustPicked(pickKey);
    setFlashMsg(msg);
    setFlashAgreement(agreement);
    // Compute streak milestone for the soon-to-be-incremented count.
    const nextJudged = judged + 1;
    setFlashSub(STREAK_MILESTONES[nextJudged] ?? null);
    setJudged(nextJudged);
    // Hold longer when there's a consensus line to read.
    const duration = agreement ? 1100 : 420;
    setTimeout(() => {
      setFlashMsg(null);
      setFlashSub(null);
      setFlashAgreement(null);
      advance();
    }, duration);
  }

  // Short label for trade winners (Team A / Even / Team B). Used in both the
  // user's pick line and the council line.
  function tradeLabel(w: "A" | "B" | "EVEN" | null): string {
    if (w === "A") return "Team A";
    if (w === "B") return "Team B";
    if (w === "EVEN") return "Even";
    return "—";
  }

  // Last name only for verdict candidates — keeps the flash compact.
  // Falls back to the full name when there's no whitespace to split on.
  function shortPlayerName(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : name;
  }

  // Trade voting on /judge is true one-click: each cell in the 3-column grid
  //   [ Team A wins + slight/clear/major/extreme ] [ Even ] [ Team B wins + … ]
  // immediately submits with (winner, tier). One tap = a complete verdict.
  function submitTradeVote(
    tradeId: string,
    winner: "A" | "B" | "EVEN",
    tier:
      | "balanced"
      | "slight_edge"
      | "clear_advantage"
      | "major_advantage"
      | "extreme_imbalance",
  ) {
    if (pending) return;
    startTransition(async () => {
      const res = await castVote({
        tradeId,
        winner,
        fairnessTier: tier,
        fairnessLean: winner === "EVEN" ? null : winner,
      });
      if (res.ok) {
        const c = res.consensus;
        const userLabel = tradeLabel(winner);
        const agreement =
          c.total > 0
            ? {
                matched: c.topWinner === winner,
                topLabel: tradeLabel(c.topWinner),
                pct: c.topPct,
              }
            : null;
        flashAndAdvance(
          `You said ${userLabel}`,
          `trade:${winner}:${tier}`,
          agreement,
        );
      } else {
        setFlashMsg(`Error: ${res.error}`);
      }
    });
  }

  function verdictQuickVote(scenarioId: string, pickPlayerId: number) {
    if (pending || !current || current.kind !== "verdict") return;
    const candidates = current.candidates;
    const userPick = candidates.find((c) => c.player_id === pickPlayerId);
    const userLabel = userPick ? shortPlayerName(userPick.name) : "—";
    startTransition(async () => {
      const res = await castVerdictVote({ scenarioId, pickPlayerId });
      if (res.ok) {
        const c = res.consensus;
        const topCandidate = candidates.find(
          (x) => x.player_id === c.topPlayerId,
        );
        const agreement =
          c.total > 0 && topCandidate
            ? {
                matched: c.topPlayerId === pickPlayerId,
                topLabel: shortPlayerName(topCandidate.name),
                pct: c.topPct,
              }
            : null;
        flashAndAdvance(
          `You said ${userLabel}`,
          `verdict:${pickPlayerId}`,
          agreement,
        );
      } else {
        setFlashMsg(`Error: ${res.error}`);
      }
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
          That&apos;s every open question in the queue.
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
            Browse trades
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
            {flashAgreement && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                  flashAgreement.matched
                    ? "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40"
                    : "bg-amber-500/15 text-amber-200 ring-amber-500/40"
                }`}
              >
                {flashAgreement.matched
                  ? `Council agrees · ${flashAgreement.pct}%`
                  : `Council says ${flashAgreement.topLabel} · ${flashAgreement.pct}%`}
              </span>
            )}
            {flashSub && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-200 ring-1 ring-amber-500/40">
                <Flame className="h-3 w-3" />
                {flashSub}
              </span>
            )}
          </div>
        )}

        {/* key={current.id} forces React to remount the card on advance —
            kills iOS "sticky hover" where the last-tapped button stays
            visually highlighted on the next scenario. */}
        {current.kind === "trade" ? (
          <TradeCard
            key={current.id}
            item={current}
            pending={pending}
            justPicked={justPicked}
            onVote={(winner, tier) =>
              submitTradeVote(current.id, winner, tier)
            }
          />
        ) : (
          <VerdictCard
            key={current.id}
            item={current}
            pending={pending}
            justPicked={justPicked}
            onPick={(pid) => verdictQuickVote(current.id, pid)}
          />
        )}

        {/* Skip-only footer — the trade headline at the top of the card is
            now itself a link to /trades/[id] or /verdict/[id], so the
            "See full scenario" CTA was redundant. */}
        <button
          type="button"
          onClick={skip}
          disabled={pending}
          className="mx-auto mt-4 block text-sm text-zinc-600 underline-offset-4 hover:text-zinc-400 hover:underline disabled:opacity-50"
        >
          Skip →
        </button>
      </div>
    </div>
  );
}

const MAGNITUDE_TIERS: Array<{
  value: "slight_edge" | "clear_advantage" | "major_advantage" | "extreme_imbalance";
  label: string;
  description: string;
}> = [
  { value: "slight_edge", label: "Slight edge", description: "Marginally ahead — close to fair." },
  { value: "clear_advantage", label: "Clear advantage", description: "Noticeably better deal for the winning side." },
  { value: "major_advantage", label: "Major advantage", description: "Strongly favors one side." },
  { value: "extreme_imbalance", label: "Extreme imbalance", description: "Commissioner is corrupt." },
];

type TradeTier =
  | "balanced"
  | "slight_edge"
  | "clear_advantage"
  | "major_advantage"
  | "extreme_imbalance";

function TradeCard({
  item,
  pending,
  justPicked,
  onVote,
}: {
  item: JudgeTradeItem;
  pending: boolean;
  justPicked: string | null;
  onVote: (winner: "A" | "B" | "EVEN", tier: TradeTier) => void;
}) {
  // One-click 3-column grid:
  //   [ Team A wins · 4 magnitudes ]  [ Even ]  [ Team B wins · 4 magnitudes ]
  // Each tier button submits the full (winner, tier) vote and advances.
  // No second-step / staged state — keeps Judge truly one-tap.

  function pickedKey(winner: "A" | "B" | "EVEN", tier: TradeTier): string {
    return `trade:${winner}:${tier}`;
  }

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

      {/* THE TRADE — the headline. Big, scannable, anchored at the top so
          the voter sees WHAT they're judging before they see the columns.
          Wrapped in a Link so tapping the headline jumps to the full
          /trades/[id] page (replaces the old "See full scenario" footer). */}
      <Link
        href={`/trades/${item.id}`}
        className="mb-4 block rounded-xl transition hover:ring-1 hover:ring-emerald-500/20"
      >
        <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <JudgeTradeHeadlineSide label="Team A" side={item.side_a} accent="rose" />
          <div className="flex items-center justify-center text-2xl text-zinc-600 sm:text-3xl">
            ↔
          </div>
          <JudgeTradeHeadlineSide label="Team B" side={item.side_b} accent="sky" />
        </div>
      </Link>

      <p className="mb-3 text-sm text-zinc-300">
        <span className="font-semibold text-zinc-100">Who won?</span>{" "}
        <span className="text-zinc-500">One tap — the council records your verdict.</span>
      </p>

      {/* 3-column voting grid. Each side column wears a faint team-color
          wash + ring at rest so column identity reads before tap. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
        {/* Team A column */}
        <div className="flex flex-col gap-2 rounded-xl bg-rose-500/[0.03] p-2 ring-1 ring-inset ring-rose-500/10">
          <div className="px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-rose-300">
            Team A wins by…
          </div>
          {MAGNITUDE_TIERS.map((t) => (
            <JudgeMagnitudeButton
              key={`A-${t.value}`}
              tier={t}
              team="A"
              picked={justPicked === pickedKey("A", t.value)}
              disabled={pending}
              onClick={() => onVote("A", t.value)}
            />
          ))}
        </div>

        {/* Even column — quiet fulcrum between the towers */}
        <div className="flex items-center sm:min-w-[112px]">
          <button
            type="button"
            disabled={pending}
            onClick={() => onVote("EVEN", "balanced")}
            className={`group flex w-full min-h-[68px] sm:min-h-0 sm:w-28 items-center justify-center rounded-xl border px-3 py-4 text-sm font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
              justPicked === pickedKey("EVEN", "balanced")
                ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/10 text-emerald-100"
                : "border-zinc-800 bg-zinc-950/60 text-zinc-200 hover:scale-[1.02] hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-100"
            }`}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="flex flex-col items-center gap-1">
                <Scale
                  className="h-4 w-4 text-zinc-500 transition group-hover:text-emerald-300"
                  strokeWidth={2}
                />
                <span>Even</span>
                <span className="text-[10px] font-normal text-zinc-500">
                  Balanced
                </span>
              </span>
            )}
          </button>
        </div>

        {/* Team B column */}
        <div className="flex flex-col gap-2 rounded-xl bg-sky-500/[0.03] p-2 ring-1 ring-inset ring-sky-500/10">
          <div className="px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
            Team B wins by…
          </div>
          {MAGNITUDE_TIERS.map((t) => (
            <JudgeMagnitudeButton
              key={`B-${t.value}`}
              tier={t}
              team="B"
              picked={justPicked === pickedKey("B", t.value)}
              disabled={pending}
              onClick={() => onVote("B", t.value)}
            />
          ))}
        </div>
      </div>
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

// One magnitude button on the /judge feed. All four tiers render at the
// same shade so visual weight doesn't bias the click — the label text is
// the only differentiator between Slight edge and Extreme imbalance.
// `picked` swaps to the emerald pulse for "just voted" feedback before
// the card advances.
function JudgeMagnitudeButton({
  tier,
  team,
  picked,
  disabled,
  onClick,
}: {
  tier: { value: string; label: string; description: string };
  team: "A" | "B";
  picked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const restClasses =
    team === "A"
      ? "border-rose-500/25 bg-rose-500/[0.06] hover:border-rose-400/60 hover:bg-rose-500/15"
      : "border-sky-500/25 bg-sky-500/[0.06] hover:border-sky-400/60 hover:bg-sky-500/15";
  const labelColor = team === "A" ? "text-rose-100" : "text-sky-100";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group/btn relative min-h-[56px] rounded-lg border p-2.5 text-left shadow-sm transition-all duration-150 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
        picked
          ? "animate-ring-pulse border-emerald-400/70 bg-emerald-500/10"
          : `${restClasses} hover:scale-[1.015] hover:shadow-md`
      }`}
    >
      <div
        className={`text-sm font-semibold ${
          picked ? "text-emerald-100" : labelColor
        }`}
      >
        {tier.label}
      </div>
      <div
        className={`mt-0.5 text-[11px] ${
          picked
            ? "text-emerald-200/80"
            : "text-zinc-400 group-hover/btn:text-zinc-300"
        }`}
      >
        {tier.description}
      </div>
    </button>
  );
}

// Prominent player + pick display for each side at the top of the /judge
// trade card. Mirrors TradeHeadlineSide in TradeListClient — kept in
// lockstep so the modal and the feed look identical.
function JudgeTradeHeadlineSide({
  label,
  side,
  accent,
}: {
  label: string;
  side: Side;
  accent: "rose" | "sky";
}) {
  const tints =
    accent === "rose"
      ? "bg-rose-500/[0.06] ring-rose-500/30"
      : "bg-sky-500/[0.06] ring-sky-500/30";
  const labelColor = accent === "rose" ? "text-rose-300" : "text-sky-300";
  return (
    <div className={`rounded-lg p-3 ring-1 ring-inset ${tints}`}>
      <div
        className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${labelColor}`}
      >
        {label}
      </div>
      <div className="space-y-1.5">
        {side.players.slice(0, 4).map((p, idx) => (
          <div
            key={`p-${idx}`}
            className="flex items-center gap-2 text-base font-medium"
          >
            <span
              className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                POSITION_STYLES[p.position] ??
                "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
              }`}
            >
              {p.position}
            </span>
            <span className="truncate text-zinc-100">{p.name}</span>
            <span className="ml-auto font-mono text-[11px] text-zinc-500">
              {p.team}
            </span>
          </div>
        ))}
        {side.picks.slice(0, 3).map((p, idx) => (
          <div
            key={`pk-${idx}`}
            className="flex items-center gap-2 text-sm text-zinc-300"
          >
            <span className="inline-flex shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
              pick
            </span>
            <span className="font-mono">{pickLabel(p)}</span>
          </div>
        ))}
        {side.players.length + side.picks.length > 7 && (
          <p className="text-[11px] text-zinc-500">
            + {side.players.length + side.picks.length - 7} more
          </p>
        )}
        {side.players.length + side.picks.length === 0 && (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </div>
    </div>
  );
}

