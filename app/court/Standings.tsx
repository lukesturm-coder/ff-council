import { Crown } from "lucide-react";
import type { StandingRow } from "@/lib/court";

// The Standings — accuracy leaderboard for a graded week. Rank 1 wears the
// Chief Justice crown. The signed-in member's row is highlighted.
export default function Standings({
  rows,
  meId,
}: {
  rows: StandingRow[];
  meId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-center text-sm text-zinc-400">
        The Standings post once the week is graded.
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {rows.map((r, i) => {
        const rank = i + 1;
        const isMe = meId != null && r.userId === meId;
        return (
          <li
            key={r.userId}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
              isMe
                ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                : "border-zinc-800 bg-zinc-900"
            }`}
          >
            <span className="w-5 shrink-0 text-center font-mono text-sm text-zinc-500">
              {rank}
            </span>
            {rank === 1 ? (
              <Crown className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            ) : (
              <span className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
              {r.displayName}
              {rank === 1 && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-300/80">
                  Chief Justice
                </span>
              )}
              {isMe && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-300/80">
                  You
                </span>
              )}
            </span>
            <span className="shrink-0 font-mono text-sm font-semibold text-emerald-300">
              {r.correct}
              <span className="text-zinc-600">/{r.graded}</span>
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-zinc-500">
              {r.pct}%
            </span>
          </li>
        );
      })}
    </ol>
  );
}
