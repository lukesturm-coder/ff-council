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
import SearchBar from "./SearchBar";
import type {
  SearchIndex,
  SearchPlayer,
  SearchTrade,
  SearchVerdict,
} from "./SearchIndex";

const PRIMARY_NAV: NavItem[] = [
  // Standing order: Rankings, Judge, Trade Court, Verdict come first.
  // Any new additions slot after this fixed prefix.
  { href: "/", label: "Rankings" },
  { href: "/judge", label: "Judge" },
  { href: "/trades", label: "Trade Court" },
  { href: "/verdict", label: "Verdict" },
  { href: "/trade", label: "Trade Calc" },
  { href: "/draft", label: "Mock Draft" },
  { href: "/league", label: "League Analyzer" },
  { href: "/council", label: "Council Rankings" },
  { href: "/tiers", label: "Tiers" },
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

  const navItems: NavItem[] = [...PRIMARY_NAV];
  if (user) navItems.push({ href: "/council/rankings", label: "My Rankings" });
  if (isAdmin) navItems.push({ href: "/council/admin", label: "Admin" });

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="mx-auto max-w-7xl px-3 pb-3 pt-3 sm:px-6">
        {/* Top row: logo + auth. Stays a single row at all widths. */}
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="shrink-0">
            <h1 className="whitespace-nowrap font-mono text-xl font-bold tracking-tight text-emerald-400 sm:text-2xl md:text-[1.625rem]">
              FF COUNCIL
            </h1>
          </Link>

          {/* On md+, nav lives between logo and auth so the layout stays compact. */}
          <PrimaryNav
            items={navItems}
            variant="desktop"
            className="hidden min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm md:flex"
          />

          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
            {/* Universal Cmd-K search — full input on sm+, icon-only at <sm. */}
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
          variant="mobile"
          className="mt-2 -mx-2 flex items-center gap-x-5 overflow-x-auto px-2 text-sm md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        />
      </div>
    </header>
  );
}
