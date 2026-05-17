import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  projectionsFromFutures,
  type PlayerRosterEntry,
} from "@/lib/projections";
import type {
  FantasyPosition,
  FuturesResponse,
  PlayerProjection,
  ScoringSystem,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import Header from "@/app/_components/Header";

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

async function loadProjections(): Promise<PlayerProjection[]> {
  const dataDir = path.join(process.cwd(), "data");
  const [futuresRaw, rosterRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "futures-mock.json"), "utf8"),
    fs.readFile(path.join(dataDir, "players-mock.json"), "utf8"),
  ]);
  const futures: FuturesResponse = JSON.parse(futuresRaw);
  const roster: PlayerRosterEntry[] = JSON.parse(rosterRaw);
  return projectionsFromFutures(futures, roster);
}

export default async function CouncilMemberProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();

  const { data: member } = await supabase
    .from("council_members")
    .select("user_id, display_name, bio, status, is_admin, joined_at")
    .eq("user_id", userId)
    .eq("status", "approved") // Only approved members get public profiles
    .maybeSingle();

  if (!member) notFound();

  // Fetch their current submissions + entries
  const { data: submissions } = await supabase
    .from("ranking_submissions")
    .select("id, scoring_system, created_at, ranking_entries(player_id, rank)")
    .eq("member_id", userId)
    .eq("is_current", true);

  // Fetch their trade votes (count by stance)
  const { count: voteCount } = await supabase
    .from("trade_votes")
    .select("trade_id", { count: "exact", head: true })
    .eq("voter_id", userId);

  const projections = await loadProjections();
  const playerById = new Map<number, PlayerProjection>(
    projections.map((p) => [p.playerId, p]),
  );

  type SubmissionView = {
    scoring: ScoringSystem;
    createdAt: string;
    topPlayers: { rank: number; player: PlayerProjection }[];
    totalRanked: number;
  };

  const submissionViews: SubmissionView[] = [];
  for (const sub of submissions ?? []) {
    const entries = (sub.ranking_entries as Array<{
      player_id: number;
      rank: number;
    }>) ?? [];
    const top = entries
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 20)
      .map((e) => ({
        rank: e.rank,
        player: playerById.get(e.player_id) as PlayerProjection | undefined,
      }))
      .filter(
        (r): r is { rank: number; player: PlayerProjection } => !!r.player,
      );
    submissionViews.push({
      scoring: sub.scoring_system as ScoringSystem,
      createdAt: sub.created_at as string,
      topPlayers: top,
      totalRanked: entries.length,
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Header />

        <div className="mb-4 border-b border-zinc-800 pb-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-2xl font-semibold">{member.display_name}</h2>
            {member.is_admin && (
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                admin
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Council member since{" "}
            {new Date(member.joined_at as string).toLocaleDateString()} ·{" "}
            {voteCount ?? 0} trade vote{(voteCount ?? 0) === 1 ? "" : "s"}
          </p>
          {member.bio && (
            <p className="mt-3 text-sm text-zinc-300">{member.bio}</p>
          )}
        </div>

        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Submitted rankings
          </h3>
          <Link
            href="/council/members"
            className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            ← All members
          </Link>
        </div>

        {submissionViews.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-center text-sm text-zinc-400">
            {member.display_name} hasn&apos;t submitted any rankings yet.
          </div>
        ) : (
          <div className="space-y-6">
            {submissionViews.map((sv) => (
              <div
                key={sv.scoring}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-5"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h4 className="text-sm font-semibold text-zinc-200">
                    {sv.scoring} top {Math.min(20, sv.totalRanked)}
                  </h4>
                  <p className="text-xs text-zinc-500">
                    {sv.totalRanked} players ranked · updated{" "}
                    {new Date(sv.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {sv.topPlayers.map((entry) => (
                      <tr
                        key={entry.player.playerId}
                        className="border-t border-zinc-800/40"
                      >
                        <td className="py-1.5 pr-3 text-right font-mono text-xs text-zinc-500 w-8">
                          {entry.rank}
                        </td>
                        <td className="py-1.5">
                          <Link
                            href={`/player/${entry.player.playerId}`}
                            className="text-zinc-100 hover:text-emerald-300 hover:underline underline-offset-4"
                          >
                            {entry.player.name}
                          </Link>
                        </td>
                        <td className="py-1.5 pl-2">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[entry.player.position]}`}
                          >
                            {entry.player.position}
                          </span>
                        </td>
                        <td className="py-1.5 pl-2 font-mono text-xs text-zinc-400">
                          {entry.player.team}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
