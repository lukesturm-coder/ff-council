import Link from "next/link";

export const metadata = {
  title: "Terms of Use — FF Council",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-6">

        <div className="prose prose-invert max-w-none space-y-6 text-sm leading-relaxed text-zinc-300">
          <h1 className="text-2xl font-semibold text-zinc-100">
            Terms of Use
          </h1>
          <p className="text-xs text-zinc-500">Last updated: 2026</p>

          <h2 className="text-lg font-semibold text-zinc-100">
            What FF Council is
          </h2>
          <p>
            FF Council is a fantasy football rankings and analysis tool. We
            aggregate publicly available player rankings and projections from
            multiple sources alongside our own betting-market-derived
            projections and a curated council of expert contributors.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Informational use only
          </h2>
          <p>
            All projections, rankings, trade evaluations, and league analyses
            on this site are for informational and entertainment purposes
            only. They are not gambling advice, investment advice, or
            guarantees of player or team performance. You are solely
            responsible for any decisions you make based on information
            provided here, including any wagers placed with third-party
            sportsbooks.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Third-party data
          </h2>
          <p>
            Player rankings shown alongside our own (ESPN, Yahoo, Sleeper,
            FantasyPros, sportsbook odds, etc.) are credited to their
            respective sources and are reproduced for the purpose of
            comparison and analysis. We do not claim ownership of third-party
            data. If you are a rights holder and have concerns, please contact
            us.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Accounts
          </h2>
          <p>
            Council member accounts are created via email magic link. You
            agree not to impersonate others, submit deceptive rankings, or
            attempt to manipulate the consensus aggregation. Accounts found in
            violation may be deactivated.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Council content
          </h2>
          <p>
            Council members retain ownership of their personal rankings. By
            submitting them through FF Council, you grant us a non-exclusive
            license to display them as part of the consensus view, to compute
            aggregate metrics, and to credit you as the source.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Liability
          </h2>
          <p>
            FF Council is provided &quot;as is&quot; without warranty of any
            kind. We are not liable for any losses arising from your use of
            the site, including but not limited to losses associated with
            wagers, fantasy contests, or business decisions.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Changes
          </h2>
          <p>
            We may update these terms occasionally. Material changes will be
            noted at the top of this page. Continued use after changes
            constitutes acceptance.
          </p>

          <p className="pt-4 text-xs">
            Questions?{" "}
            <Link
              href="/privacy"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Privacy Policy
            </Link>{" "}
            ·{" "}
            <Link
              href="/"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Back to FF Council
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
