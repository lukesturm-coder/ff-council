import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  Gavel,
  Network,
  Scale,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import HomeHero, { loadHeroStats } from "./_components/HomeHero";
import ActivityTicker from "./_components/ActivityTicker";
import AllDecisions from "./_components/AllDecisions";
import TrendingBoard from "./_components/TrendingBoard";
import HotCalls from "./_components/HotCalls";

export const metadata: Metadata = {
  title: "FF Council — Crowdsourced fantasy verdicts",
  description:
    "Real fantasy football consensus, not buried in Reddit comments. Judge trades, post tough calls, build your draft.",
};

// Landing tiles. Order matches the primary nav, which keeps Rankings → Judge
// → Trade Court as the priority surfaces. Icons are picked from lucide-react
// with one-line semantic fits (gavel for Judge, scale for the analyzer, etc.)
// rather than literal player or sport icons.
type Tile = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const TILES: Tile[] = [
  {
    href: "/rankings",
    title: "Rankings",
    description:
      "Council-derived ranks with Vegas, ESPN, FP, and 4 more sources side-by-side.",
    icon: BarChart3,
  },
  {
    href: "/judge",
    title: "Judge",
    description:
      "Every case the council is weighing — trades, start/sit, draft picks. Browse, filter, and vote.",
    icon: Gavel,
  },
  {
    href: "/trades",
    title: "Trade Court",
    description:
      "A quick trade analyzer. Build a trade, see if it's fair across every source.",
    icon: Scale,
  },
  {
    href: "/draft",
    title: "Mock Draft",
    description: "Practice your draft against an AI board.",
    icon: ClipboardList,
  },
  {
    href: "/league",
    title: "League Analyzer",
    description: "Connect a Sleeper league. Power rankings + trade targets.",
    icon: Network,
  },
  {
    href: "/council",
    title: "My Rankings",
    description: "Build your own ranking — list, quick head-to-heads, or tiers.",
    icon: Users,
  },
  {
    href: "/leaderboard",
    title: "Leaderboard",
    description: "Top voters by activity, agreement, and contrarian takes.",
    icon: Trophy,
  },
];

function FeatureTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className="group relative flex flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-5 transition hover:scale-[1.015] hover:border-emerald-500/30"
    >
      <Icon className="h-5 w-5 text-emerald-300" aria-hidden />
      <h3 className="mt-3 text-base font-semibold text-zinc-100">
        {tile.title}
      </h3>
      <p className="mt-1 text-sm text-zinc-400">{tile.description}</p>
      <span
        aria-hidden
        className="mt-4 self-end text-sm font-medium text-emerald-400 opacity-80 transition group-hover:opacity-100"
      >
        View →
      </span>
    </Link>
  );
}

export default async function Page() {
  const heroStats = await loadHeroStats();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <HomeHero stats={heroStats} />

        {/* Polymarket-style hero: featured trending board + hot-calls rail. */}
        <section
          aria-label="Trending"
          className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
        >
          <TrendingBoard />
          <HotCalls />
        </section>

        <section aria-label="Features" className="mt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {TILES.map((tile) => (
              <FeatureTile key={tile.href} tile={tile} />
            ))}
          </div>
        </section>

        <ActivityTicker />

        <AllDecisions />

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
