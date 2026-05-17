import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — FF Council",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-6">

        <div className="space-y-6 text-sm leading-relaxed text-zinc-300">
          <h1 className="text-2xl font-semibold text-zinc-100">
            Privacy Policy
          </h1>
          <p className="text-xs text-zinc-500">Last updated: 2026</p>

          <h2 className="text-lg font-semibold text-zinc-100">
            What we collect
          </h2>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <span className="text-zinc-100">Email address</span> — required
              to log in via magic link. Used only for authentication and
              account-related emails.
            </li>
            <li>
              <span className="text-zinc-100">Display name + optional bio</span> —
              shown publicly on the council if you&apos;re approved.
            </li>
            <li>
              <span className="text-zinc-100">Submitted rankings</span> —
              shown as part of the consensus view; aggregated anonymously when
              displayed to non-members.
            </li>
            <li>
              <span className="text-zinc-100">Basic usage analytics</span> —
              page views, anonymized; we do not track you across other sites.
            </li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">
            What we don&apos;t collect
          </h2>
          <ul className="ml-4 list-disc space-y-2">
            <li>Passwords (we use email magic link instead)</li>
            <li>Payment information (no paid tiers currently)</li>
            <li>Real-name verification, ID, or government documents</li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">
            How we use it
          </h2>
          <p>
            Email is for login + service emails only — we don&apos;t send
            marketing without opt-in. Your rankings power the consensus view.
            Analytics help us improve the site.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Third parties
          </h2>
          <ul className="ml-4 list-disc space-y-2">
            <li>
              <span className="text-zinc-100">Supabase</span> — stores your
              account + rankings (data hosted in US data centers).
            </li>
            <li>
              <span className="text-zinc-100">Resend</span> (or similar) —
              sends magic-link emails.
            </li>
            <li>
              <span className="text-zinc-100">Vercel</span> — hosts the site
              and handles request logging.
            </li>
            <li>
              <span className="text-zinc-100">Sportsbook affiliate links</span>
              {" "}— clicking a betting link may set tracking cookies from the
              destination sportsbook for affiliate attribution.
            </li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">
            Your rights
          </h2>
          <p>
            You can delete your account at any time — your council membership
            row, submissions, and entries are removed. Email us if you can&apos;t
            access your account to self-delete.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">
            Cookies
          </h2>
          <p>
            We use essential session cookies (for keeping you logged in) and
            optionally analytics cookies (anonymized). No third-party advertising
            cookies are set on first load; if we add AdSense or similar in the
            future, this policy will be updated.
          </p>

          <p className="pt-4 text-xs">
            <Link
              href="/terms"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Terms of Use
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
