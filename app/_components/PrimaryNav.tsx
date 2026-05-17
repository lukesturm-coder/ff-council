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
}: {
  items: NavItem[];
  className?: string;
}) {
  const pathname = usePathname();
  const activeHref = pickActiveHref(pathname, items);
  return (
    <nav className={className}>
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap transition ${
              isActive
                ? "font-medium text-emerald-400"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
