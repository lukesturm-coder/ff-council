"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  Check,
  Link2,
  Plus,
  Send,
  X,
} from "lucide-react";
import type {
  FantasyPosition,
  ScoringSystem,
} from "@/lib/types";

export type TradePlayer = {
  playerId: number;
  name: string;
  position: FantasyPosition;
  team: string;
  fantasyPoints: Record<ScoringSystem, number>;
  vbd: Record<ScoringSystem, number>;
  espnAdp: Partial<Record<ScoringSystem, number>>;
  fpAdp: Partial<Record<ScoringSystem, number>>;
  sleeperAdp: Partial<Record<ScoringSystem, number>>;
  nflRank: Partial<Record<ScoringSystem, number>>;
  yahooRank: Partial<Record<ScoringSystem, number>>;
  councilRank: Partial<Record<ScoringSystem, number>>;
};

type Pick = { year: number; round: number; slot: number | null };

const SCORING_OPTIONS: ScoringSystem[] = ["PPR", "Half", "Standard"];

const POSITION_STYLES: Record<FantasyPosition, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

// Convert ADP/rank values (lower=better) into a comparable "value" — invert so
// higher numbers = better. Using 250 - rank gives a positive value space where
// rank 1 → 249, rank 50 → 200, etc. Roughly proportional to draft position.
function adpValue(rank: number | undefined): number | null {
  if (rank == null || !Number.isFinite(rank)) return null;
  return Math.max(0, 250 - rank);
}

function averageOrNull(values: (number | null | undefined)[]): number | null {
  const filtered = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function sumOrZero(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// Parse free-form pick phrases like "2027 mid 2nd", "2027 1.05", "2028 early
// 1st", "2027 Rd 3". Requires a year (20xx) and a round; slot is optional.
// Ported from app/trades/new/TradeSubmissionForm.tsx so the calculator can
// handle dynasty picks too.
function parsePick(input: string): Pick | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const yearMatch = s.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const rest = s.replace(yearMatch[1], " ").replace(/\s+/g, " ");

  const dotMatch = rest.match(/(?<![\d.])([1-9])\.(\d{1,2})(?![\d.])/);
  if (dotMatch) {
    return {
      year,
      round: Number(dotMatch[1]),
      slot: Number(dotMatch[2]),
    };
  }

  let round: number | null = null;
  const ordMatch = rest.match(/\b([1-9])(?:st|nd|rd|th)\b/);
  if (ordMatch) round = Number(ordMatch[1]);
  else {
    const rMatch = rest.match(/\b(?:r|rd|round)\s*([1-9])\b/);
    if (rMatch) round = Number(rMatch[1]);
  }
  if (!round) return null;

  let slot: number | null = null;
  if (/\bearly\b/.test(rest)) slot = 3;
  else if (/\bmid(?:dle)?\b/.test(rest)) slot = 6;
  else if (/\blate\b/.test(rest)) slot = 10;

  return { year, round, slot };
}

function formatPick(p: Pick): string {
  const slotPart = p.slot != null ? `.${String(p.slot).padStart(2, "0")}` : "";
  return `${p.year} R${p.round}${slotPart}`;
}

// Convert a dynasty rookie pick into an approximate ADP-equivalent so it can
// participate in the verdict math. Numbers are rough but ordered correctly:
// 1.01 ≈ overall ADP 8, 1.06 ≈ 14, 2.01 ≈ 36, 3.01 ≈ 72, 4.01 ≈ 110.
// A pick one year out is discounted ~15%, two years out ~30%.
function pickAdpEquivalent(p: Pick, currentYear: number): number {
  const slot = p.slot ?? 6;
  const roundBase = (p.round - 1) * 24;
  // First round picks are tighter (1.01 ≈ 8, 1.12 ≈ 22)
  const slotOffset =
    p.round === 1 ? 6 + slot * 1.4 : 12 + slot * 1.0;
  const baseAdp = roundBase + slotOffset;

  const yearsOut = Math.max(0, p.year - currentYear);
  // Discount future picks by inflating ADP (worse rank)
  const discount = 1 + yearsOut * 0.18;
  return baseAdp * discount;
}

// Serialize / deserialize picks for the URL: "2027-1-5,2028-2"
function serializePicks(picks: Pick[]): string {
  return picks
    .map((p) => `${p.year}-${p.round}${p.slot != null ? `-${p.slot}` : ""}`)
    .join(",");
}
function parsePicksParam(s: string | null): Pick[] {
  if (!s) return [];
  return s
    .split(",")
    .map((tok) => {
      const parts = tok.split("-").map((n) => Number(n));
      if (parts.length < 2) return null;
      const [year, round, slot] = parts;
      if (!Number.isFinite(year) || !Number.isFinite(round)) return null;
      return {
        year,
        round,
        slot: Number.isFinite(slot) ? slot : null,
      } as Pick;
    })
    .filter((p): p is Pick => p != null);
}

export default function TradeCalculator({ players }: { players: TradePlayer[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize state from URL params on first render so refresh + share work.
  const [scoring, setScoring] = useState<ScoringSystem>(() => {
    const s = searchParams?.get("scoring");
    return s === "Half" || s === "Standard" ? s : "PPR";
  });
  const [sideA, setSideA] = useState<number[]>(() =>
    (searchParams?.get("a") ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  const [sideB, setSideB] = useState<number[]>(() =>
    (searchParams?.get("b") ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  const [picksA, setPicksA] = useState<Pick[]>(() =>
    parsePicksParam(searchParams?.get("pa") ?? null),
  );
  const [picksB, setPicksB] = useState<Pick[]>(() =>
    parsePicksParam(searchParams?.get("pb") ?? null),
  );
  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");
  const [copied, setCopied] = useState(false);

  const playerById = useMemo(() => {
    const m = new Map<number, TradePlayer>();
    for (const p of players) m.set(p.playerId, p);
    return m;
  }, [players]);

  const aPlayers = sideA
    .map((id) => playerById.get(id))
    .filter((p): p is TradePlayer => !!p);
  const bPlayers = sideB
    .map((id) => playerById.get(id))
    .filter((p): p is TradePlayer => !!p);

  // Sync state → URL (replace, not push, so back button isn't polluted).
  // Skip the first render — initialization already matches the URL.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const sp = new URLSearchParams();
    if (sideA.length) sp.set("a", sideA.join(","));
    if (sideB.length) sp.set("b", sideB.join(","));
    if (picksA.length) sp.set("pa", serializePicks(picksA));
    if (picksB.length) sp.set("pb", serializePicks(picksB));
    if (scoring !== "PPR") sp.set("scoring", scoring);
    const qs = sp.toString();
    router.replace(qs ? `/trade?${qs}` : "/trade", { scroll: false });
  }, [sideA, sideB, picksA, picksB, scoring, router]);

  const currentYear = new Date().getFullYear();
  const aMetrics = computeMetrics(aPlayers, picksA, scoring, currentYear);
  const bMetrics = computeMetrics(bPlayers, picksB, scoring, currentYear);

  function addToSide(side: "A" | "B", playerId: number) {
    if (side === "A") {
      if (!sideA.includes(playerId)) setSideA([...sideA, playerId]);
      setSearchA("");
    } else {
      if (!sideB.includes(playerId)) setSideB([...sideB, playerId]);
      setSearchB("");
    }
  }

  function addPickToSide(side: "A" | "B", pick: Pick) {
    if (side === "A") {
      setPicksA([...picksA, pick]);
      setSearchA("");
    } else {
      setPicksB([...picksB, pick]);
      setSearchB("");
    }
  }

  function removeFromSide(side: "A" | "B", playerId: number) {
    if (side === "A") setSideA(sideA.filter((id) => id !== playerId));
    else setSideB(sideB.filter((id) => id !== playerId));
  }

  function removePickFromSide(side: "A" | "B", idx: number) {
    if (side === "A") setPicksA(picksA.filter((_, i) => i !== idx));
    else setPicksB(picksB.filter((_, i) => i !== idx));
  }

  function swapSides() {
    setSideA(sideB);
    setSideB(sideA);
    setPicksA(picksB);
    setPicksB(picksA);
  }

  function clearAll() {
    setSideA([]);
    setSideB([]);
    setPicksA([]);
    setPicksB([]);
  }

  const copyShareLink = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
    );
  }, []);

  const hasAnything =
    sideA.length > 0 ||
    sideB.length > 0 ||
    picksA.length > 0 ||
    picksB.length > 0;

  // Submit-to-court link: picks aren't carried over (court form re-parses
  // them on its own) but selected players prefill cleanly.
  const submitHref = `/trades/new?a=${sideA.join(",")}&b=${sideB.join(",")}`;

  return (
    <div className="space-y-6">
      {/* Scoring toggle + actions */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <span className="px-2 text-xs uppercase tracking-wider text-zinc-500">
            Scoring
          </span>
          {SCORING_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setScoring(s)}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition sm:px-3 ${
                scoring === s
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {/* On mobile (390px) the four controls below need to fit on one
            row, so Swap/Share/Clear collapse to icon-only — labels reappear
            at sm: and up. Icons keep an aria-label for screen readers. */}
        <button
          onClick={swapSides}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Swap sides"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Swap sides</span>
        </button>
        {hasAnything && (
          <button
            onClick={copyShareLink}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Copy shareable link"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Copied</span>
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Share</span>
              </>
            )}
          </button>
        )}
        {hasAnything && (
          <button
            onClick={clearAll}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Clear all"
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear all</span>
          </button>
        )}
      </div>

      {/* Two sides */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TradeSide
          label="Team A gives"
          players={aPlayers}
          picks={picksA}
          search={searchA}
          onSearchChange={setSearchA}
          allPlayers={players}
          onAdd={(id) => addToSide("A", id)}
          onAddPick={(pk) => addPickToSide("A", pk)}
          onRemove={(id) => removeFromSide("A", id)}
          onRemovePick={(idx) => removePickFromSide("A", idx)}
          excludeIds={[...sideA, ...sideB]}
          scoring={scoring}
        />
        <TradeSide
          label="Team B gives"
          players={bPlayers}
          picks={picksB}
          search={searchB}
          onSearchChange={setSearchB}
          allPlayers={players}
          onAdd={(id) => addToSide("B", id)}
          onAddPick={(pk) => addPickToSide("B", pk)}
          onRemove={(id) => removeFromSide("B", id)}
          onRemovePick={(idx) => removePickFromSide("B", idx)}
          excludeIds={[...sideA, ...sideB]}
          scoring={scoring}
        />
      </div>

      {/* Verdict */}
      {hasAnything && (
        <VerdictPanel a={aMetrics} b={bMetrics} scoring={scoring} />
      )}

      {/* Send to Trade Court */}
      {(aPlayers.length > 0 || picksA.length > 0) &&
        (bPlayers.length > 0 || picksB.length > 0) && (
          <div className="flex flex-col items-stretch gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-xs text-zinc-500">
              Want the council&apos;s take instead of just the math?
            </p>
            <Link
              href={submitHref}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 sm:py-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              Submit to Trade Court
            </Link>
          </div>
        )}
    </div>
  );
}

function TradeSide({
  label,
  players,
  picks,
  search,
  onSearchChange,
  allPlayers,
  onAdd,
  onAddPick,
  onRemove,
  onRemovePick,
  excludeIds,
  scoring,
}: {
  label: string;
  players: TradePlayer[];
  picks: Pick[];
  search: string;
  onSearchChange: (s: string) => void;
  allPlayers: TradePlayer[];
  onAdd: (id: number) => void;
  onAddPick: (pick: Pick) => void;
  onRemove: (id: number) => void;
  onRemovePick: (idx: number) => void;
  excludeIds: number[];
  scoring: ScoringSystem;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase().trim();
    const excluded = new Set(excludeIds);
    return allPlayers
      .filter(
        (p) =>
          !excluded.has(p.playerId) &&
          (p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.fantasyPoints[scoring] - a.fantasyPoints[scoring])
      .slice(0, 8);
  }, [search, allPlayers, excludeIds, scoring]);

  const parsedPick = parsePick(search);
  const showDropdown = filtered.length > 0 || parsedPick != null;

  const sideFpts = sumOrZero(players.map((p) => p.fantasyPoints[scoring]));
  const sideVbd = sumOrZero(players.map((p) => p.vbd[scoring]));

  // Empty sides hoist the Add input directly under the header so the
  // empty state IS the action — no separate "no players yet" copy.
  const isEmpty = players.length === 0 && picks.length === 0;

  // The Add input + dropdown — extracted so we can render it either
  // under the header (empty) or at the bottom (after items exist).
  const addInput = (
    <div className="relative">
      <div className="relative">
        <Plus className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Add player or pick (e.g. 2027 1.05)"
          className="block w-full rounded-md border border-zinc-800 bg-zinc-950 py-3 pl-8 pr-3 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
        />
      </div>
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
          {parsedPick && (
            <button
              key="pick-suggestion"
              onClick={() => onAddPick(parsedPick)}
              className="flex w-full items-center gap-2 border-b border-zinc-800/60 bg-zinc-900 px-2.5 py-2 text-left text-sm transition hover:bg-zinc-800 sm:px-3"
            >
              <span className="flex-1 font-mono text-zinc-100">
                Add {formatPick(parsedPick)}
              </span>
              <span className="inline-flex items-center rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-semibold text-zinc-300 ring-1 ring-inset ring-zinc-700">
                PICK
              </span>
            </button>
          )}
          {filtered.map((p) => (
            <button
              key={p.playerId}
              onClick={() => onAdd(p.playerId)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition hover:bg-zinc-800 sm:px-3"
            >
              <span className="flex-1 truncate">{p.name}</span>
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
              >
                {p.position}
              </span>
              <span className="hidden w-10 font-mono text-xs text-zinc-500 sm:inline">
                {p.team}
              </span>
              <span className="w-14 text-right font-mono text-xs text-zinc-400">
                {p.fantasyPoints[scoring].toFixed(1)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        {!isEmpty && (
          <p className="font-mono text-xs text-zinc-400">
            {players.length + picks.length} item
            {players.length + picks.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {/* When the side is empty, the Add input IS the empty state — no
          separate "no players yet" paragraph. */}
      {isEmpty && addInput}

      {/* Selected players + picks */}
      <div className="space-y-1.5">
        {players.map((p) => (
          <div
            key={p.playerId}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-sm sm:px-3"
          >
            <span className="flex-1 truncate font-medium text-zinc-100">{p.name}</span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_STYLES[p.position]}`}
            >
              {p.position}
            </span>
            <span className="hidden w-10 font-mono text-xs text-zinc-400 sm:inline">
              {p.team}
            </span>
            <span
              className="w-14 text-right font-mono text-xs text-zinc-300 sm:w-16"
              title="Vegas season FPts"
            >
              {p.fantasyPoints[scoring].toFixed(1)}
            </span>
            <button
              onClick={() => onRemove(p.playerId)}
              className="text-zinc-500 transition hover:text-rose-400"
              aria-label={`Remove ${p.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {picks.map((pk, idx) => (
          <div
            key={`pick-${idx}`}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-sm sm:px-3"
          >
            <span className="flex-1 truncate font-mono text-zinc-100">
              {formatPick(pk)}
            </span>
            <span className="inline-flex items-center rounded bg-zinc-800/80 px-1.5 py-0.5 text-xs font-semibold text-zinc-300 ring-1 ring-inset ring-zinc-700">
              PICK
            </span>
            <button
              onClick={() => onRemovePick(idx)}
              className="text-zinc-500 transition hover:text-rose-400"
              aria-label={`Remove ${formatPick(pk)}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Side totals */}
      {players.length > 0 && (
        <div className="flex items-baseline justify-between border-t border-zinc-800 pt-2 text-xs text-zinc-400">
          <span>Vegas total</span>
          <span className="font-mono font-semibold text-zinc-200">
            {sideFpts.toFixed(1)}
          </span>
        </div>
      )}
      {players.length > 0 && (
        <div className="flex items-baseline justify-between text-xs text-zinc-500">
          <span>Edge total</span>
          <span className="font-mono">{sideVbd.toFixed(1)}</span>
        </div>
      )}

      {/* Add input lives at the bottom once at least one item exists.
          When the side is empty it's already hoisted under the header. */}
      {!isEmpty && addInput}
    </div>
  );
}

type SideMetrics = {
  vegasFpts: number;
  vegasVbd: number;
  espnAdpAvg: number | null;
  fpAdpAvg: number | null;
  sleeperAdpAvg: number | null;
  nflRankAvg: number | null;
  yahooRankAvg: number | null;
  councilAvg: number | null;
  espnValue: number | null;
  fpValue: number | null;
  councilValue: number | null;
};

function computeMetrics(
  players: TradePlayer[],
  picks: Pick[],
  scoring: ScoringSystem,
  currentYear: number,
): SideMetrics {
  const vegasFpts = sumOrZero(players.map((p) => p.fantasyPoints[scoring]));
  const vegasVbd = sumOrZero(players.map((p) => p.vbd[scoring]));

  // Picks contribute as ADP-equivalents to the ADP-style sources only —
  // they have no Vegas projection, but they DO have rough ADP value.
  const pickAdps = picks.map((pk) => pickAdpEquivalent(pk, currentYear));

  const espnAdpAvg = averageOrNull([
    ...players.map((p) => p.espnAdp[scoring] ?? p.espnAdp.PPR),
    ...pickAdps,
  ]);
  const fpAdpAvg = averageOrNull([
    ...players.map((p) => p.fpAdp[scoring]),
    ...pickAdps,
  ]);
  const sleeperAdpAvg = averageOrNull([
    ...players.map((p) => p.sleeperAdp[scoring] ?? p.sleeperAdp.PPR),
    ...pickAdps,
  ]);
  const nflRankAvg = averageOrNull([
    ...players.map((p) => p.nflRank[scoring] ?? p.nflRank.PPR),
    ...pickAdps,
  ]);
  const yahooRankAvg = averageOrNull([
    ...players.map((p) => p.yahooRank[scoring] ?? p.yahooRank.PPR),
    ...pickAdps,
  ]);
  const councilAvg = averageOrNull([
    ...players.map((p) => p.councilRank[scoring]),
    ...pickAdps,
  ]);

  return {
    vegasFpts,
    vegasVbd,
    espnAdpAvg,
    fpAdpAvg,
    sleeperAdpAvg,
    nflRankAvg,
    yahooRankAvg,
    councilAvg,
    espnValue: averageOrNull([
      ...players.map((p) => adpValue(p.espnAdp[scoring] ?? p.espnAdp.PPR)),
      ...pickAdps.map((adp) => adpValue(adp)),
    ]),
    fpValue: averageOrNull([
      ...players.map((p) => adpValue(p.fpAdp[scoring])),
      ...pickAdps.map((adp) => adpValue(adp)),
    ]),
    councilValue: averageOrNull([
      ...players.map((p) => adpValue(p.councilRank[scoring])),
      ...pickAdps.map((adp) => adpValue(adp)),
    ]),
  };
}

type Row = {
  label: string;
  aValue: number | null;
  bValue: number | null;
  aDisplay: string;
  bDisplay: string;
  /** Whose value wins. "lower" means lower is better (ADP), "higher" means higher is better (FPts). */
  direction: "higher" | "lower";
  color: string;
};

function VerdictPanel({
  a,
  b,
  scoring,
}: {
  a: SideMetrics;
  b: SideMetrics;
  scoring: ScoringSystem;
}) {
  const rows: Row[] = [
    {
      label: "Vegas FPts",
      aValue: a.vegasFpts,
      bValue: b.vegasFpts,
      aDisplay: a.vegasFpts.toFixed(1),
      bDisplay: b.vegasFpts.toFixed(1),
      direction: "higher",
      color: "text-zinc-100",
    },
    {
      label: "Vegas Edge",
      aValue: a.vegasVbd,
      bValue: b.vegasVbd,
      aDisplay: a.vegasVbd.toFixed(1),
      bDisplay: b.vegasVbd.toFixed(1),
      direction: "higher",
      color: "text-zinc-200",
    },
    {
      label: "ESPN ADP (avg, lower = better)",
      aValue: a.espnAdpAvg,
      bValue: b.espnAdpAvg,
      aDisplay: a.espnAdpAvg != null ? a.espnAdpAvg.toFixed(1) : "—",
      bDisplay: b.espnAdpAvg != null ? b.espnAdpAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-rose-300",
    },
    {
      label: "FP ADP (avg, lower = better)",
      aValue: a.fpAdpAvg,
      bValue: b.fpAdpAvg,
      aDisplay: a.fpAdpAvg != null ? a.fpAdpAvg.toFixed(1) : "—",
      bDisplay: b.fpAdpAvg != null ? b.fpAdpAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-sky-300",
    },
    {
      label: "Sleeper ADP (avg, lower = better)",
      aValue: a.sleeperAdpAvg,
      bValue: b.sleeperAdpAvg,
      aDisplay: a.sleeperAdpAvg != null ? a.sleeperAdpAvg.toFixed(1) : "—",
      bDisplay: b.sleeperAdpAvg != null ? b.sleeperAdpAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-cyan-300",
    },
    {
      label: "NFL (avg, lower = better)",
      aValue: a.nflRankAvg,
      bValue: b.nflRankAvg,
      aDisplay: a.nflRankAvg != null ? a.nflRankAvg.toFixed(1) : "—",
      bDisplay: b.nflRankAvg != null ? b.nflRankAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-blue-300",
    },
    {
      label: "Yahoo (avg, lower = better)",
      aValue: a.yahooRankAvg,
      bValue: b.yahooRankAvg,
      aDisplay: a.yahooRankAvg != null ? a.yahooRankAvg.toFixed(1) : "—",
      bDisplay: b.yahooRankAvg != null ? b.yahooRankAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-purple-300",
    },
    {
      label: "Council (avg, lower = better)",
      aValue: a.councilAvg,
      bValue: b.councilAvg,
      aDisplay: a.councilAvg != null ? a.councilAvg.toFixed(1) : "—",
      bDisplay: b.councilAvg != null ? b.councilAvg.toFixed(1) : "—",
      direction: "lower",
      color: "text-emerald-300",
    },
  ];

  // Overall verdict: across all sources where both sides have data, who wins
  // more often? Also track the average % gap so we can label fairness.
  let aWins = 0;
  let bWins = 0;
  const gaps: number[] = [];
  for (const r of rows) {
    if (r.aValue == null || r.bValue == null) continue;
    const aV = r.aValue;
    const bV = r.bValue;
    if (r.direction === "higher") {
      if (aV > bV) aWins++;
      else if (bV > aV) bWins++;
    } else {
      if (aV < bV) aWins++;
      else if (bV < aV) bWins++;
    }
    // Symmetric percent gap relative to the mean of the two sides.
    const mean = (Math.abs(aV) + Math.abs(bV)) / 2;
    if (mean > 0) {
      const diff = Math.abs(aV - bV);
      gaps.push((diff / mean) * 100);
    }
  }

  const totalCompared = aWins + bWins;
  const avgGap =
    gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;

  let winner: "A" | "B" | "even" = "even";
  if (totalCompared > 0) {
    if (aWins > bWins) winner = "A";
    else if (bWins > aWins) winner = "B";
  }

  // Fairness label: how lopsided is this? Thresholds on the average % gap
  // across sources. Tuned for the kind of trades people actually run.
  let fairness: "even" | "slight" | "clear" | "lopsided" = "even";
  if (totalCompared === 0) fairness = "even";
  else if (avgGap < 8) fairness = "even";
  else if (avgGap < 20) fairness = "slight";
  else if (avgGap < 40) fairness = "clear";
  else fairness = "lopsided";

  const winnerColor =
    winner === "A"
      ? "text-rose-300"
      : winner === "B"
        ? "text-sky-300"
        : "text-zinc-300";
  const winnerBg =
    winner === "A"
      ? "bg-rose-500/10 border-rose-500/30"
      : winner === "B"
        ? "bg-sky-500/10 border-sky-500/30"
        : "bg-zinc-900 border-zinc-800";

  const headline =
    totalCompared === 0
      ? "Add players to both sides"
      : winner === "even"
        ? "Even trade"
        : `Team ${winner} wins`;

  const fairnessCopy =
    totalCompared === 0
      ? "Need at least one comparable source on both sides."
      : fairness === "even"
        ? `Looks fair — ${aWins}–${bWins} across sources, ~${avgGap.toFixed(0)}% gap.`
        : fairness === "slight"
          ? `Slight edge — ${aWins}–${bWins} across sources, ~${avgGap.toFixed(0)}% gap.`
          : fairness === "clear"
            ? `Clear winner — ${aWins}–${bWins} across sources, ~${avgGap.toFixed(0)}% gap.`
            : `Lopsided — ${aWins}–${bWins} across sources, ~${avgGap.toFixed(0)}% gap.`;

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3 sm:p-5">
      {/* Winner banner — sticky so the verdict stays onscreen while the
          user scans evidence rows below. Negative margin + matching
          horizontal padding lets the sticky band span the full panel
          width (bleeding to the panel border) without the rounded
          banner card itself losing its inner styling. */}
      <div className="sticky top-0 z-10 -mx-3 bg-zinc-900/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5">
        <div
          className={`rounded-md border px-3 py-3 sm:px-4 sm:py-4 ${winnerBg}`}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <p className={`text-lg font-semibold sm:text-xl ${winnerColor}`}>
              {headline}
            </p>
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Verdict · {scoring}
            </p>
          </div>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            {fairnessCopy}
          </p>
        </div>
      </div>

      <table className="w-full text-xs sm:text-sm">
        <thead className="text-xs uppercase tracking-wider text-zinc-500">
          <tr className="text-left">
            <th className="py-1">Source</th>
            <th className="py-1 text-right">A</th>
            <th className="py-1 text-right">B</th>
            <th className="py-1 text-right">Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            let rowWinner: "A" | "B" | "tie" | "none" = "none";
            let diffText = "—";
            if (r.aValue != null && r.bValue != null) {
              const diff =
                r.direction === "higher"
                  ? r.aValue - r.bValue
                  : r.bValue - r.aValue;
              if (Math.abs(diff) < 0.05) rowWinner = "tie";
              else rowWinner = diff > 0 ? "A" : "B";
              diffText = `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`;
            }
            return (
              <tr
                key={r.label}
                className="border-t border-zinc-800/60 text-zinc-300"
              >
                <td className={`py-2 pr-2 ${r.color}`}>{r.label}</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.aDisplay}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.bDisplay}
                </td>
                <td
                  className={`py-2 pl-2 text-right font-mono tabular-nums ${
                    rowWinner === "A"
                      ? "text-rose-300"
                      : rowWinner === "B"
                        ? "text-sky-300"
                        : "text-zinc-600"
                  }`}
                >
                  {rowWinner === "A"
                    ? `A ${diffText}`
                    : rowWinner === "B"
                      ? `B ${diffText}`
                      : rowWinner === "tie"
                        ? "≈ tie"
                        : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
