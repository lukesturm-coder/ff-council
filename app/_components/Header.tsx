import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PrimaryNav, { type NavItem } from "./PrimaryNav";

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Rankings" },
  { href: "/judge", label: "Judge" },
  { href: "/trades", label: "Trade Court" },
  { href: "/verdict", label: "Verdict" },
  { href: "/trade", label: "Trade Calc" },
  { href: "/draft", label: "Mock Draft" },
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

  const navItems: NavItem[] = [...PRIMARY_NAV];
  if (user) navItems.push({ href: "/council/rankings", label: "My Rankings" });
  if (isAdmin) navItems.push({ href: "/council/admin", label: "Admin" });

  return (
    <header className="border-b border-zinc-800">
      <div className="mx-auto max-w-7xl px-3 pb-3 pt-3 sm:px-6">
        {/* Top row: logo + auth. Stays a single row at all widths. */}
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="shrink-0">
            <h1 className="whitespace-nowrap font-mono text-xl font-bold tracking-tight text-emerald-400">
              FF COUNCIL
            </h1>
          </Link>

          {/* On md+, nav lives between logo and auth so the layout stays compact. */}
          <PrimaryNav
            items={navItems}
            className="hidden min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm md:flex"
          />

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
        <PrimaryNav
          items={navItems}
          className="mt-2 -mx-2 flex items-center gap-x-4 overflow-x-auto px-2 text-sm md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        />
      </div>
    </header>
  );
}
