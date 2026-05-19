"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { NavItem } from "./PrimaryNav";

/**
 * Overflow dropdown for nav items that don't make the 4-tab priority cut.
 * One trigger button, one panel — opens on click, closes on outside click,
 * Escape, or route change. Mirrors the Sleeper/KTC "More" pattern.
 */
export default function MoreMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeInMore = items.some(
    (it) => pathname === it.href || pathname.startsWith(it.href + "/"),
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex items-center gap-1 whitespace-nowrap border-b-2 py-2 -mb-px pb-0.5 text-sm transition ${
          activeInMore
            ? "border-emerald-400 text-emerald-400"
            : "border-transparent text-zinc-400 hover:text-zinc-100"
        }`}
      >
        Tools
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40"
        >
          {items.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={`block px-4 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "text-zinc-200 hover:bg-zinc-900 hover:text-emerald-300"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
