import { Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import Header from "@/app/_components/Header";

export default async function AccuracyPage() {
  const supabase = await createClient();

  // Are there any actuals at all? If so we'd compute leaderboards.
  const { count: actualCount } = await supabase
    .from("actual_results")
    .select("player_id", { count: "exact", head: true });

  const { data: members } = await supabase
    .from("council_members")
    .select("user_id, display_name")
    .eq("status", "approved")
    .order("display_name");

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <Header />

        <div className="mb-4 border-b border-zinc-800 pb-3">
          <h2 className="text-2xl font-semibold">Accuracy Leaderboard</h2>
          <p className="mt-1 text-sm text-zinc-400">
            How well each council member&apos;s preseason rankings predicted
            actual fantasy production.
          </p>
        </div>

        {!actualCount || actualCount === 0 ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6">
              <div className="flex items-baseline gap-3">
                <Trophy className="h-5 w-5 text-amber-300" />
                <h3 className="text-base font-semibold text-amber-200">
                  Pending end of 2026 season
                </h3>
              </div>
              <p className="mt-3 text-sm text-amber-200/80">
                We can&apos;t score council members until the 2026 NFL regular
                season finishes (early January 2027). Once it does, this page
                lights up automatically with each member&apos;s accuracy.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                How accuracy will be computed
              </h3>
              <ul className="space-y-2 text-zinc-300">
                <li>
                  <span className="text-zinc-100">Spearman correlation:</span>{" "}
                  how closely each member&apos;s rank-ordering of players matches
                  the actual end-of-season ordering by fantasy points. Range
                  −1 to +1; higher is better.
                </li>
                <li>
                  <span className="text-zinc-100">Top-24 hit rate:</span> what
                  fraction of a member&apos;s top-24 ranked players ended up in
                  the actual top 24. Tests their ability to pick winners
                  specifically.
                </li>
                <li>
                  <span className="text-zinc-100">Per-scoring-system:</span>{" "}
                  PPR, Half, and Standard rankings are scored independently
                  against the corresponding actual scoring.
                </li>
              </ul>
              <p className="mt-4 text-xs text-zinc-500">
                Only the rankings submitted before the season starts count
                toward each year&apos;s accuracy. Mid-season tweaks won&apos;t
                game the leaderboard.
              </p>
            </div>

            {members && members.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                  Council members who&apos;ll be scored
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {members.map((m) => (
                    <p key={m.user_id} className="text-sm text-zinc-300">
                      {m.display_name}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-center text-sm text-zinc-400">
            Leaderboard computation coming next session — actuals are loaded
            but the per-member scoring UI hasn&apos;t been wired up yet.
          </div>
        )}
      </div>
    </main>
  );
}
