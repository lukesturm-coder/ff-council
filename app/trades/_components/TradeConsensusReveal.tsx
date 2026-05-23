"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Send } from "lucide-react";
import {
  getTradeComments,
  postTradeComment,
  type TradeComment,
  type TradeConsensus,
} from "@/app/trades/[id]/actions";

// Post-vote market reveal: weighted council headline, the 5-bucket sentiment
// distribution, a controversy read, your agreement line, and fast quick-take
// comments. Shown in place of the vote selector after a one-tap vote.

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

const CONTROVERSY_STYLE: Record<TradeConsensus["controversy"], string> = {
  consensus: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
  divided: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  highly_divided: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
};

export default function TradeConsensusReveal({
  tradeId,
  consensus,
  myWinner,
}: {
  tradeId: string;
  consensus: TradeConsensus;
  myWinner: "A" | "B" | "EVEN";
}) {
  const total = Math.max(consensus.total, 1);
  const d = consensus.distribution;
  const aDir = d.strongA + d.leanA;
  const bDir = d.strongB + d.leanB;
  const pct = (n: number) => Math.round((n / total) * 100);

  const myLabel =
    myWinner === "A" ? "Team A" : myWinner === "B" ? "Team B" : "Even";
  const agrees = consensus.leader === myWinner;

  // Buckets for the breakdown rows.
  const buckets: Array<{ label: string; n: number; color: string }> = [
    { label: "Strong A", n: d.strongA, color: "bg-rose-500/70" },
    { label: "Lean A", n: d.leanA, color: "bg-rose-500/40" },
    { label: "Even", n: d.even, color: "bg-zinc-500/50" },
    { label: "Lean B", n: d.leanB, color: "bg-sky-500/40" },
    { label: "Strong B", n: d.strongB, color: "bg-sky-500/70" },
  ];

  return (
    <div className="space-y-3">
      {/* Headline + controversy */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold text-zinc-100 sm:text-lg">
            {consensus.headline}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {consensus.total.toLocaleString()} vote
            {consensus.total === 1 ? "" : "s"}
            {consensus.leader !== "EVEN" &&
              ` · ${consensus.leaderPct}% lean that way`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${CONTROVERSY_STYLE[consensus.controversy]}`}
        >
          {consensus.controversyLabel}
        </span>
      </div>

      {/* Segmented market bar: A lean ◄ even ► B lean */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <span
          className="bg-rose-500/70 transition-[width] duration-500"
          style={{ width: `${pct(aDir)}%` }}
        />
        <span
          className="bg-zinc-600/70 transition-[width] duration-500"
          style={{ width: `${pct(d.even)}%` }}
        />
        <span
          className="bg-sky-500/70 transition-[width] duration-500"
          style={{ width: `${pct(bDir)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] font-medium">
        <span className="text-rose-300">Team A {pct(aDir)}%</span>
        <span className="text-zinc-500">Even {pct(d.even)}%</span>
        <span className="text-sky-300">Team B {pct(bDir)}%</span>
      </div>

      {/* 5-bucket breakdown */}
      <div className="space-y-1">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[11px] text-zinc-400">
              {b.label}
            </span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <span
                className={`absolute inset-y-0 left-0 ${b.color} transition-[width] duration-500`}
                style={{ width: `${pct(b.n)}%` }}
              />
            </span>
            <span className="w-7 shrink-0 text-right font-mono text-[11px] text-zinc-500 tabular-nums">
              {pct(b.n)}%
            </span>
          </div>
        ))}
      </div>

      {/* Your agreement line */}
      <div
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset ${
          agrees
            ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30"
            : "bg-amber-500/10 text-amber-200 ring-amber-500/30"
        }`}
      >
        <Check className="h-3.5 w-3.5" />
        You said {myLabel} ·{" "}
        {agrees
          ? "Council agrees"
          : consensus.leader === "EVEN"
            ? "Council is split"
            : `Council leans ${consensus.leader === "A" ? "Team A" : "Team B"}`}
      </div>

      <Comments tradeId={tradeId} />
    </div>
  );
}

function Comments({ tradeId }: { tradeId: string }) {
  const [comments, setComments] = useState<TradeComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, startPost] = useTransition();
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (loadedFor.current === tradeId) return;
    loadedFor.current = tradeId;
    setLoading(true);
    getTradeComments(tradeId)
      .then(setComments)
      .finally(() => setLoading(false));
  }, [tradeId]);

  function submit() {
    const body = draft.trim();
    if (!body || posting) return;
    setError(null);
    startPost(async () => {
      const res = await postTradeComment({ tradeId, body });
      if (res.ok) {
        setComments((prev) => [res.comment, ...prev]);
        setDraft("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          maxLength={200}
          placeholder="Quick take… (Smash Team A, too much value)"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={posting || draft.trim().length === 0}
          aria-label="Post take"
          className="shrink-0 rounded-md bg-emerald-500/20 p-1.5 text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-40"
        >
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}

      {loading ? (
        <p className="text-[11px] text-zinc-600">Loading takes…</p>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-zinc-600">No takes yet — drop the first.</p>
      ) : (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto">
          {comments.map((c) => (
            <li key={c.id} className="text-sm leading-snug">
              <span className="font-semibold text-emerald-300">
                {c.author_name}
              </span>{" "}
              <span className="text-zinc-200">{c.body}</span>{" "}
              <span className="text-[10px] text-zinc-600">
                {relativeTime(c.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
