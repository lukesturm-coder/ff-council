import {
  scoreToPercent,
  type TradeVerdict,
  type TradeWinner,
} from "@/lib/trade-verdict";

// =====================================================================
// TradeVerdictMeter — the signed direction + severity readout.
//
//             Team B wins — Clear Advantage
//    Team A ◄──────────────────●─────────► Team B
//    fleece    even      slight  clear  major  fleece
//    ─────────────────────────────────────────────
//         1,000 votes · 67% favor Team B
//
// The marker rides a horizontal track. Center = even (score 0). It slides
// toward whichever side the council favors, and how far it slides encodes
// HOW lopsided they think the deal is (severity). A is rose (left), B is
// sky (right), even is zinc/emerald.
//
// No client interactivity — renders fine in a server component.
// =====================================================================

// Accent classes per leading side. Matches the trade-side colors used
// across the app (A = rose, B = sky, even = emerald/zinc).
const HEADLINE_COLOR: Record<TradeWinner, string> = {
  A: "text-rose-300",
  B: "text-sky-300",
  EVEN: "text-zinc-200",
};

const MARKER_COLOR: Record<TradeWinner, string> = {
  A: "bg-rose-400 ring-rose-300/40",
  B: "bg-sky-400 ring-sky-300/40",
  EVEN: "bg-zinc-300 ring-zinc-200/40",
};

// Tier sublabels under the track, left → right across the [-4,+4] axis.
// Centered on the even fulcrum. Hidden below sm to keep mobile clean.
const TIER_SUBLABELS = [
  "fleece",
  "major",
  "clear",
  "slight",
  "even",
  "slight",
  "clear",
  "major",
  "fleece",
] as const;

export default function TradeVerdictMeter({
  verdict,
}: {
  verdict: TradeVerdict;
}) {
  const { score, total, leader, winnerPct, headline } = verdict;
  const markerPct = scoreToPercent(score);

  // Credibility line. For an even verdict the % isn't meaningful as a
  // "favor" stat, so we say the council split instead.
  const credibility =
    leader === "EVEN"
      ? `${total.toLocaleString()} vote${total === 1 ? "" : "s"} · council split`
      : `${total.toLocaleString()} vote${
          total === 1 ? "" : "s"
        } · ${winnerPct}% favor Team ${leader}`;

  return (
    <div>
      {/* Headline — color-tinted toward the leader. */}
      <p
        className={`text-center text-lg font-bold leading-snug sm:text-2xl ${HEADLINE_COLOR[leader]}`}
      >
        {headline}
      </p>

      {/* Meter track */}
      <div className="mt-4">
        {/* End labels + the track itself */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-rose-300/80 sm:text-xs">
            Team A
          </span>
          <div className="relative h-2.5 flex-1 rounded-full bg-gradient-to-r from-rose-500/25 via-zinc-700/50 to-sky-500/25">
            {/* center tick (even fulcrum) */}
            <span
              aria-hidden
              className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-zinc-500/70"
              style={{ left: "50%" }}
            />
            {/* marker */}
            <span
              className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 shadow-sm transition-[left] duration-500 ${MARKER_COLOR[leader]}`}
              style={{ left: `${markerPct}%` }}
              aria-hidden
            />
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-sky-300/80 sm:text-xs">
            Team B
          </span>
        </div>

        {/* Tier sublabels — hidden on narrow screens. The inner labels
            align under the track (the end labels above bound it). */}
        <div className="mt-1.5 hidden px-[3.25rem] sm:flex sm:justify-between">
          {TIER_SUBLABELS.map((label, i) => (
            <span
              key={i}
              className="text-[9px] uppercase tracking-wide text-zinc-600"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Credibility line */}
      <p className="mt-3 text-center text-xs text-zinc-500">{credibility}</p>
    </div>
  );
}
