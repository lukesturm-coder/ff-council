import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type { FuturesResponse } from "@/lib/types";
import PrimaryNav, { type NavItem } from "./PrimaryNav";
import BottomTabBar from "./BottomTabBar";
import SearchBar from "./SearchBar";
import type {
  SearchIndex,
  SearchPlayer,
  SearchTrade,
  SearchVerdict,
} from "./SearchIndex";

// Two-tier nav, both rows ALWAYS visible (no dropdowns — owner wants every
// feature exposed). Priority row = the four core surfaces. Sub-tools row =
// everything else, rendered smaller + muted directly under the priority row.
const PRIORITY_NAV: NavItem[] = [
  { href: "/rankings", label: "Rankings" },
  { href: "/judge", label: "Judge" },
  { href: "/trades", label: "Trade Court" },
  { href: "/verdict", label: "Verdict" },
];

// Sub-tools row — second visible tier. Every secondary surface lives here in
// plain sight. Nothing is hidden behind a menu.
const UTILITY_NAV: NavItem[] = [
  { href: "/draft", label: "Mock Draft" },
  { href: "/trades", label: "Trade Calculator" },
  { href: "/council/rank", label: "Rank Players" },
  { href: "/council", label: "Council Rankings" },
  { href: "/tiers", label: "Tiers" },
  { href: "/league", label: "League Analyzer" },
  { href: "/leaderboard", label: "Leaderboard" },
];

// =====================================================================
// Build the global search index for the Cmd-K modal. Runs once per
// server render of the header (i.e. every page load) and ships a small
// payload (~30-40KB) inline to the client.
//
// - Players: top 200 by best-scoring-system fantasy points, derived
//   from the same futures+roster mock data as the homepage rankings.
// - Verdicts: 100 most recent scenarios from Supabase.
// - Trades: 100 most recent submissions from Supabase.
//
// Failures in any branch are swallowed — the header should never
// crash because the search index couldn't be built.
// =====================================================================
async function loadSearchIndex(): Promise<SearchIndex> {
  const [players, verdicts, trades] = await Promise.all([
    loadSearchPlayers().catch(() => [] as SearchPlayer[]),
    loadSearchVerdicts().catch(() => [] as SearchVerdict[]),
    loadSearchTrades().catch(() => [] as SearchTrade[]),
  ]);
  return { players, verdicts, trades };
}

async function loadSearchPlayers(): Promise<SearchPlayer[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  const projections = projectionsFromFutures(futures, roster);
  // Sort by PPR fantasy points so the search index prioritises relevant
  // players, then truncate to 200 to keep the payload small.
  return projections
    .slice()
    .sort((a, b) => (b.fantasyPoints.PPR ?? 0) - (a.fantasyPoints.PPR ?? 0))
    .slice(0, 200)
    .map((p) => ({
      id: p.playerId,
      name: p.name,
      team: p.team,
      position: p.position,
    }));
}

async function loadSearchVerdicts(): Promise<SearchVerdict[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("verdict_scenarios")
    .select("id, scenario_type, notes, candidates")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((row) => {
    const notes = (row.notes as string | null) ?? "";
    const candidates = (row.candidates as Array<{ name?: string }> | null) ?? [];
    // Snippet = first 80 chars of notes, falling back to candidate names
    // (e.g. "Bijan Robinson vs Breece Hall") so verdicts without notes
    // still match by player name.
    const candidateStr = candidates
      .slice(0, 2)
      .map((c) => c?.name ?? "")
      .filter(Boolean)
      .join(" vs ");
    const rawSnippet = notes.trim() || candidateStr;
    const snippet = rawSnippet.length > 80
      ? rawSnippet.slice(0, 80).trimEnd() + "…"
      : rawSnippet;
    return {
      id: row.id as string,
      scenarioType: row.scenario_type as "draft" | "start_sit",
      snippet,
    };
  });
}

async function loadSearchTrades(): Promise<SearchTrade[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trade_submissions")
    .select("id, side_a, side_b")
    .order("created_at", { ascending: false })
    .limit(100);

  type SidePlayer = { name?: string };
  type Side = { players?: SidePlayer[] } | null;

  const sideSummary = (side: Side): string => {
    const names = (side?.players ?? [])
      .map((p) => p?.name ?? "")
      .filter(Boolean);
    if (names.length === 0) return "picks";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} + ${names[1]}`;
    return `${names[0]} + ${names.length - 1} more`;
  };

  return (data ?? []).map((row) => ({
    id: row.id as string,
    sideASummary: sideSummary(row.side_a as Side),
    sideBSummary: sideSummary(row.side_b as Side),
  }));
}

export default async function Header() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    searchIndex,
  ] = await Promise.all([supabase.auth.getUser(), loadSearchIndex()]);

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

  // Auth-gated entries — slotted into the desktop sub-tools row, and threaded
  // to the mobile bottom bar's Tools sheet via the extraTools prop (the bar is
  // a client component and can't run the server-side auth check itself).
  const extraTools: NavItem[] = [];
  if (user) extraTools.push({ href: "/council/rankings", label: "My Rankings" });
  if (isAdmin) extraTools.push({ href: "/council/admin", label: "Admin" });

  // Desktop sub-tools row — every secondary surface, always visible.
  const subToolsNav: NavItem[] = [...UTILITY_NAV, ...extraTools];

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="mx-auto max-w-7xl px-3 pb-2 pt-3 sm:px-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="shrink-0">
            <h1 className="whitespace-nowrap font-mono text-xl font-bold tracking-tight text-emerald-400 sm:text-2xl md:text-[1.625rem]">
              FF COUNCIL
            </h1>
          </Link>

          {/* Priority nav: 4 tabs. Desktop only (md+) — on mobile the fixed
              bottom tab bar covers these surfaces. */}
          <PrimaryNav
            items={PRIORITY_NAV}
            variant="desktop"
            className="hidden min-w-0 flex-1 items-center gap-x-4 overflow-x-auto text-sm sm:gap-x-5 md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />

          <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
            <SearchBar index={searchIndex} />
            {user ? (
              <>
                <Link
                  href="/me"
                  className="text-sm text-zinc-200 transition hover:text-emerald-300"
                  title={user.email ?? ""}
                >
                  {displayName}
                </Link>
                <form action="/logout" method="post" className="hidden sm:block">
                  <button
                    type="submit"
                    className="text-sm text-zinc-500 transition hover:text-zinc-300"
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

        {/* Sub-tools — second tier, desktop only (md+): a full visible row,
            every surface exposed. On mobile these live in the bottom bar's
            Tools sheet instead. */}
        <div className="mt-2 hidden border-t border-zinc-800/60 pt-2 md:block">
          <PrimaryNav
            items={subToolsNav}
            variant="desktop"
            size="compact"
            className="hidden items-center gap-x-4 text-xs md:flex"
          />
        </div>
      </div>

      {/* Mobile-only fixed bottom tab bar. Auth-gated tools are threaded in
          via extraTools since the bar is a client component. */}
      <BottomTabBar extraTools={extraTools} />
    </header>
  );
}
