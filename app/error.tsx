"use client";

import Link from "next/link";
import { useEffect } from "react";

// =====================================================================
// Global error boundary. Next.js renders this when a server component
// throws. Must be a client component (Next.js requirement).
// =====================================================================

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console so it shows up in Vercel logs / browser devtools.
    console.error("App error boundary caught:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center shadow-xl sm:p-8">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-300 sm:text-3xl">
          Something broke.
        </h1>
        <p className="mt-3 text-sm text-zinc-400 sm:text-base">
          The council had a moment. Try again.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm font-medium text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-400/20"
          >
            Try again
          </button>
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
