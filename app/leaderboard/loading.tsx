export default function LeaderboardLoading() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="font-mono text-xl font-bold tracking-tight text-emerald-300 sm:text-2xl">
        Loading leaderboard…
      </h1>

      <div className="mt-6 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg bg-zinc-900"
            aria-hidden="true"
          />
        ))}
      </div>
    </main>
  );
}
