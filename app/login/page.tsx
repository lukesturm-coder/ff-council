import Link from "next/link";
import { signInWithMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const sentTo = params.sent;
  const error = params.error;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="font-mono text-3xl font-bold tracking-tight">
            FF <span className="text-emerald-400">COUNCIL</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-400">Sign in to the Council</p>
        </div>

        {sentTo ? (
          <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <p className="font-medium text-emerald-200">Check your email</p>
            <p className="text-emerald-200/80">
              We sent a magic link to{" "}
              <span className="font-mono">{sentTo}</span>. Click the link to
              sign in.
            </p>
            <p className="text-xs text-emerald-200/60">
              Link not arriving? Check spam, or{" "}
              <Link
                href="/login"
                className="underline underline-offset-4 hover:text-emerald-200"
              >
                try again
              </Link>
              .
            </p>
          </div>
        ) : (
          <form action={signInWithMagicLink} className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="email"
                className="block text-xs uppercase tracking-wider text-zinc-500"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                className="block w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              />
            </div>

            {error && (
              <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                {decodeURIComponent(error)}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-md bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30"
            >
              Send magic link
            </button>

            <p className="text-center text-xs text-zinc-500">
              New here? Just enter your email — we&apos;ll create your council
              account automatically.
            </p>
          </form>
        )}

        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← Back to rankings
          </Link>
        </div>
      </div>
    </main>
  );
}
