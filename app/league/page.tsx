import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLeague,
  looksLikeSleeperLeagueId,
} from "@/lib/sleeper";

export const metadata: Metadata = {
  title: "League Analyzer · FF Council",
  description:
    "Plug in your Sleeper league to see roster strength, positional gaps, and council-derived trade targets.",
};

async function analyzeLeague(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("leagueId") || "").trim();
  if (!leagueId) redirect("/league?error=Missing+league+ID");
  if (!looksLikeSleeperLeagueId(leagueId)) {
    redirect(
      `/league?error=${encodeURIComponent("That doesn't look like a Sleeper league ID — should be ~18 digits.")}`,
    );
  }
  // Validate it actually exists before redirecting
  try {
    await fetchLeague(leagueId);
  } catch {
    redirect(
      `/league?error=${encodeURIComponent("Couldn't load that league. Is it public? Double-check the ID.")}`,
    );
  }
  redirect(`/league/${leagueId}`);
}

export default async function LeagueEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-6">

        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold">League Analyzer</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Paste your Sleeper league ID and see your league through FF
              Council&apos;s lens — Vegas projections, Council consensus, ESPN,
              and FantasyPros consensus, applied to each team&apos;s roster.
            </p>
          </div>

          <Link
            href="/league/connect"
            className="block rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 transition hover:border-emerald-500/50 hover:bg-emerald-500/10 sm:p-5"
          >
            <p className="text-xs uppercase tracking-wider text-emerald-300">
              New · one-time setup
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              Connect your Sleeper account →
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Link your account once and skip pasting league IDs forever.
              We&apos;ll remember your league for trades, verdicts, and
              roster-aware tools.
            </p>
          </Link>

          <form
            action={analyzeLeague}
            className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6"
          >
            <div className="space-y-1">
              <label
                htmlFor="leagueId"
                className="block text-xs uppercase tracking-wider text-zinc-500"
              >
                Sleeper League ID
              </label>
              <input
                id="leagueId"
                name="leagueId"
                required
                placeholder="1234567890123456789"
                className="block w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              />
            </div>

            {params.error && (
              <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                {params.error}
              </p>
            )}

            <button
              type="submit"
              className="rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30"
            >
              Analyze league
            </button>

            <p className="text-xs text-zinc-500">
              Your league must be <span className="text-zinc-300">public</span>{" "}
              (the default on Sleeper) — we don&apos;t have access to private
              leagues.
            </p>
          </form>

          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
            <h3 className="font-semibold text-zinc-200">
              Where do I find my league ID?
            </h3>
            <ol className="ml-4 list-decimal space-y-1.5 text-xs">
              <li>Open your league in Sleeper (web or app)</li>
              <li>
                Look at the URL: it&apos;s the long number in{" "}
                <code className="rounded bg-zinc-800 px-1 text-zinc-300">
                  sleeper.com/leagues/<span className="text-emerald-400">1234567890123456789</span>/team
                </code>
              </li>
              <li>Paste that number above</li>
            </ol>
          </div>

          <Link
            href="/"
            className="block text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← Back to rankings
          </Link>
        </div>
      </div>
    </main>
  );
}
