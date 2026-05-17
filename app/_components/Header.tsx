import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Primary nav — always visible to everyone (no sign-in required to view).
const PRIMARY_NAV = [
  { href: "/", label: "Rankings" },
  { href: "/trades", label: "Trade Court" },
  { href: "/draft", label: "Mock Draft" },
  { href: "/trade", label: "Trade Calc" },
  { href: "/league", label: "League Analyzer" },
  { href: "/council", label: "Council" },
];

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  let isAdmin = false;
  if (user) {
    const { data } = await supabase
      .from("council_members")
      .select("display_name, is_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    displayName =
      (data?.display_name as string | undefined) ??
      user.email?.split("@")[0] ??
      "Member";
    isAdmin = Boolean(data?.is_admin);
  }

  return (
    <header className="mb-4 border-b border-zinc-800 pb-3">
      {/* Top row: logo + auth. Stays a single row at all widths. */}
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="shrink-0">
          <h1 className="whitespace-nowrap font-mono text-xl font-bold tracking-tight text-emerald-400">
            FF COUNCIL
          </h1>
        </Link>

        {/* On md+, nav lives between logo and auth so the layout stays compact. */}
        <nav className="hidden min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm md:flex">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap text-zinc-400 transition hover:text-zinc-100"
            >
              {item.label}
            </Link>
          ))}
          {user && (
            <Link
              href="/council/rankings"
              className="whitespace-nowrap text-zinc-400 transition hover:text-zinc-100"
            >
              My Rankings
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/council/admin"
              className="whitespace-nowrap text-zinc-400 transition hover:text-zinc-100"
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
          {user ? (
            <>
              <span className="text-xs text-zinc-400" title={user.email ?? ""}>
                {displayName}
              </span>
              <form action="/logout" method="post">
                <button
                  type="submit"
                  className="text-xs text-zinc-500 transition hover:text-zinc-300"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Mobile-only nav: horizontal scroll so all links stay on one row. */}
      <nav className="mt-2 -mx-2 flex items-center gap-x-4 overflow-x-auto px-2 text-sm md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PRIMARY_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap text-zinc-400 transition hover:text-zinc-100"
          >
            {item.label}
          </Link>
        ))}
        {user && (
          <Link
            href="/council/rankings"
            className="whitespace-nowrap text-zinc-400 transition hover:text-zinc-100"
          >
            My Rankings
          </Link>
        )}
        {isAdmin && (
          <Link
            href="/council/admin"
            className="whitespace-nowrap text-zinc-400 transition hover:text-zinc-100"
          >
            Admin
          </Link>
        )}
      </nav>
    </header>
  );
}
