"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Gavel,
  Scale,
  MessageSquareQuote,
  LayoutGrid,
  X,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "./PrimaryNav";

type Tab = { href: string; label: string; icon: LucideIcon };

// The four core surfaces, mirrored from the desktop priority nav. Labels are
// fixed by product (Rankings, Judge, Trade Court, Verdict) — do not rename.
const TABS: Tab[] = [
  { href: "/rankings", label: "Rankings", icon: BarChart3 },
  { href: "/judge", label: "Judge", icon: Gavel },
  { href: "/trades", label: "Trade Court", icon: Scale },
  { href: "/verdict", label: "Verdict", icon: MessageSquareQuote },
];

// The standing secondary surfaces. Auth-gated entries (My Rankings, Admin)
// arrive via the `extraTools` prop because this client component can't run
// the server-side auth check.
const TOOLS: NavItem[] = [
  { href: "/draft", label: "Mock Draft" },
  { href: "/trades", label: "Trade Calculator" },
  { href: "/council/rank", label: "Rank Players" },
  { href: "/council", label: "Council Rankings" },
  { href: "/tiers", label: "Tiers" },
  { href: "/league", label: "League Analyzer" },
  { href: "/leaderboard", label: "Leaderboard" },
];

function isActivePath(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Mobile-only (`md:hidden`) fixed bottom tab bar. Five thumb-reachable tabs:
 * the four core surfaces plus a "Tools" tab that opens a full-screen sheet
 * listing every secondary surface. Desktop is untouched — the bar never
 * renders at md+.
 */
export default function BottomTabBar({
  extraTools = [],
}: {
  extraTools?: NavItem[];
}) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close the sheet on route change (a tap inside it navigated away).
  useEffect(() => setSheetOpen(false), [pathname]);

  // Close on Escape + lock body scroll while the sheet is open.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sheetOpen]);

  const tools: NavItem[] = [...TOOLS, ...extraTools];

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed bottom-0 inset-x-0 z-50 grid grid-cols-5 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:hidden"
      >
        {TABS.map((tab) => {
          const active = !sheetOpen && isActivePath(pathname, tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 py-1.5 text-xs transition ${
                active ? "text-emerald-400" : "text-zinc-400"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="leading-none">{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSheetOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-1 py-1.5 text-xs transition ${
            sheetOpen ? "text-emerald-400" : "text-zinc-400"
          }`}
        >
          <LayoutGrid className="h-5 w-5" aria-hidden />
          <span className="leading-none">Tools</span>
        </button>
      </nav>

      {sheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tools"
          className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 backdrop-blur md:hidden"
        >
          {/* Backdrop tap (the top spacer) closes the sheet. */}
          <button
            type="button"
            aria-label="Close tools"
            onClick={() => setSheetOpen(false)}
            className="flex-1"
          />
          <div className="border-t border-zinc-800 bg-zinc-950 px-4 pb-20 pt-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-mono text-lg font-bold tracking-tight text-emerald-400">
                Tools
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="rounded-md p-2 text-zinc-400 transition hover:text-zinc-100"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {tools.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setSheetOpen(false)}
                    className={`flex min-h-[52px] items-center justify-center rounded-lg border px-3 py-3 text-center text-sm font-medium transition ${
                      active
                        ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700 hover:text-emerald-300"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
