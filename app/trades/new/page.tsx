import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftRight,
  ClipboardList,
  Gavel,
  type LucideIcon,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Submit a question · FF Council",
  description:
    "Submit a trade, start/sit, or draft pick. The community votes. Consensus emerges.",
};

// =====================================================================
// /trades/new — case-type picker.
//
// Three big tap targets that route to the right submission form. The
// forms themselves are unchanged: trades go to /trades/new/trade,
// verdicts go to /verdict/new with ?type=draft|start_sit so the form
// boots into the right mode.
//
// Server component — no client state, no JS payload. Mobile-first: the
// three cards stack at narrow widths and form a 3-column grid on sm+.
// =====================================================================

type CaseChoice = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const CASE_CHOICES: CaseChoice[] = [
  {
    href: "/trades/new/trade",
    title: "Trade",
    description: "Get the community's take on who won the deal.",
    icon: ArrowLeftRight,
  },
  {
    href: "/verdict/new?type=start_sit",
    title: "Start or Sit",
    description: "Two players, one lineup spot. The crowd picks.",
    icon: Gavel,
  },
  {
    href: "/verdict/new?type=draft",
    title: "Draft Pick",
    description: "On the clock and stuck? Drop your shortlist.",
    icon: ClipboardList,
  },
];

export default function NewCasePickerPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            What do you need help with?
          </h1>
          <p className="text-sm text-zinc-400 sm:text-base">
            Pick what you want the community to vote on.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {CASE_CHOICES.map((choice) => {
            const Icon = choice.icon;
            return (
              <Link
                key={choice.href}
                href={choice.href}
                className="group flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:scale-[1.015] hover:border-emerald-500/40 hover:bg-zinc-900 sm:p-6"
              >
                <Icon
                  className="h-6 w-6 text-emerald-300 transition group-hover:text-emerald-200"
                  aria-hidden
                />
                <h2 className="mt-3 text-lg font-semibold text-zinc-100 sm:text-xl">
                  {choice.title}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {choice.description}
                </p>
                <span
                  aria-hidden
                  className="mt-4 self-end text-sm font-medium text-emerald-400 opacity-80 transition group-hover:opacity-100"
                >
                  Continue →
                </span>
              </Link>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-zinc-500">
          Not sure what to submit?{" "}
          <Link
            href="/trades"
            className="underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            See what the community is voting on
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
