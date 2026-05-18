import type { Metadata } from "next";
import HomeHero, { loadHeroStats } from "./_components/HomeHero";
import ActivityTicker from "./_components/ActivityTicker";

export const metadata: Metadata = {
  title: "FF Council — Crowdsourced fantasy verdicts",
  description:
    "Real fantasy football consensus, not buried in Reddit comments. Judge trades, post tough calls, build your draft.",
};

export default async function Page() {
  const heroStats = await loadHeroStats();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <HomeHero stats={heroStats} />

        <ActivityTicker />

        <footer className="mt-12 space-y-2 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          <p>
            Council verdicts, live now. Vegas-anchored rankings, side-by-side
            sources, and the trades the council is judging this minute.
          </p>
          <p>
            <a
              href="/terms"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Terms
            </a>
            {" · "}
            <a
              href="/privacy"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Privacy
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
