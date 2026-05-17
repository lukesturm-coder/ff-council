export default function JudgeLoading() {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="font-mono text-xl font-bold tracking-tight text-emerald-300 sm:text-2xl">
        Loading scenarios…
      </h1>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div
          className="aspect-[4/3] w-full animate-pulse rounded-xl bg-zinc-900"
          aria-hidden="true"
        />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg bg-zinc-900"
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
