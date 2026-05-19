import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 · FF Council",
  description: "That page isn't here.",
};

const CTAS: { href: string; label: string }[] = [
  { href: "/trades", label: "Trades" },
  { href: "/judge", label: "Vote" },
  { href: "/rankings", label: "Rankings" },
];

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center shadow-xl sm:p-8">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-300 sm:text-3xl">
          404 — page not found.
        </h1>
        <p className="mt-3 text-sm text-zinc-400 sm:text-base">
          That page isn&apos;t here. Maybe it never existed, maybe it got
          deleted.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {CTAS.map((cta) => (
            <Link
              key={cta.href}
              href={cta.href}
              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-400/20 sm:text-sm"
            >
              {cta.label}
            </Link>
          ))}
        </div>

        <div className="mt-6 border-t border-zinc-800 pt-4">
          <Link
            href="/"
            className="text-sm text-zinc-400 transition hover:text-emerald-300"
          >
            Back to rankings →
          </Link>
        </div>
      </div>
    </main>
  );
}
