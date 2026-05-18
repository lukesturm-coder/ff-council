"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

// Longest-prefix match: /council/rankings highlights "My Rankings" not "Council",
// /council/members highlights "Council" since that's the only prefix that matches.
function pickActiveHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    const matches =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(item.href + "/");
    if (!matches) continue;
    if (!best || item.href.length > best.length) best = item.href;
  }
  return best;
}

export default function PrimaryNav({
  items,
  className,
  variant = "desktop",
  size = "default",
}: {
  items: NavItem[];
  className?: string;
  variant?: "desktop" | "mobile";
  /**
   * "compact" renders a smaller, more-muted secondary tier of nav links
   * — used for the utility row beneath the primary surfaces.
   */
  size?: "default" | "compact";
}) {
  const pathname = usePathname();
  const activeHref = pickActiveHref(pathname, items);
  return (
    <nav className={className}>
      {items.map((item) => {
        const isActive = item.href === activeHref;
        // Desktop gets a real "current tab" underline; mobile (horizontal
        // scroller) stays color-only. Inactive desktop links carry a
        // transparent border so the active state doesn't shift neighbors.
        const desktopBase =
          "border-b-2 border-transparent -mb-px pb-0.5";
        const desktopActive =
          size === "compact"
            ? "border-emerald-400/60 text-emerald-300"
            : "border-emerald-400 text-emerald-400";
        const desktopInactive =
          size === "compact"
            ? "text-zinc-500 hover:text-zinc-200"
            : "text-zinc-400 hover:text-zinc-100";
        const mobileActive = "text-emerald-400";
        const mobileInactive = "text-zinc-400 hover:text-zinc-100";
        const classes =
          variant === "desktop"
            ? `${desktopBase} ${isActive ? desktopActive : desktopInactive}`
            : isActive
              ? mobileActive
              : mobileInactive;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap py-2 transition ${classes}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
