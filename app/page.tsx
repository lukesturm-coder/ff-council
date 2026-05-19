import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Calculator,
  ClipboardList,
  Gavel,
  Layers,
  MessageSquareQuote,
  Network,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import HomeHero, { loadHeroStats } from "./_components/HomeHero";
import ActivityTicker from "./_components/ActivityTicker";
import CouncilActivity from "./_components/CouncilActivity";

export const metadata: Metadata = {
  title: "FF Council — Crowdsourced fantasy verdicts",
  description:
    "Real fantasy football consensus, not buried in Reddit comments. Judge trades, post tough calls, build your draft.",
};

// Landing tiles. Order matches the primary nav, which keeps Rankings → Judge
// → Court as the priority surfaces. Icons are picked from lucide-react with
// one-line semantic fits (gavel for judge, scale for court, etc.) rather
// than literal player or sport icons.
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
    href: "/trades",
    title: "Trade Calculator",
    description:
      "Side-by-side trade math across Vegas, ESPN, FantasyPros, Sleeper, and the council.",
    icon: Calculator,
  },
  {
    href: "/trades/new",
    title: "Start/Sit & Draft Help",
    description:
      "Post a tough call. Start/sit or draft pick. The community votes.",
    icon: MessageSquareQuote,
  },
  {
    href: "/judge",
    title: "Vote",
    description:
      "Speed-vote on open trades and questions. One tap, advance, repeat.",
    icon: Gavel,
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
    title: "Council Rankings",
    description: "What the council collectively ranks.",
    icon: Users,
  },
  {
    href: "/tiers",
    title: "Tiers",
    description: "S/A/B/C/D tiers with the on-the-clock draft board.",
    icon: Layers,
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

        {/* One-line explainer strip — sits between the hero (the headline)
            and the features grid (the doors). Plain language, no jargon. */}
        <p className="mt-2 border-t border-zinc-800/60 pt-4 text-sm text-zinc-400 sm:text-base">
          We turn Vegas odds into fantasy rankings, and the community votes on
          every trade and tough call.
        </p>

        <section aria-label="Features" className="mt-4 sm:mt-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {TILES.map((tile) => (
              <FeatureTile key={tile.href} tile={tile} />
            ))}
          </div>
        </section>

        <ActivityTicker />

        <CouncilActivity />

        <footer className="mt-12 space-y-2 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          <p>
            Council verdicts, live now. Vegas-anchored rankings, side-by-side
            sources, and the trades the council is judging this minute.
          </p>
          <p>
            <a
              href="/leaderboard"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              Leaderboard
            </a>
            {" · "}
            <a
              href="/league"
              className="underline-offset-4 hover:text-zinc-300 hover:underline"
            >
              League Analyzer
            </a>
            {" · "}
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
