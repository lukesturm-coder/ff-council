"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type {
  SearchIndex,
  SearchPlayer,
  SearchTrade,
  SearchVerdict,
} from "./SearchIndex";

// =====================================================================
// Universal Cmd-K-style search.
//
// Triggers: header "fake input" click, ⌘K / Ctrl+K anywhere, or `/`
// pressed outside an input/textarea. Escape closes when open.
//
// The search index is built server-side in Header.tsx (top 200 players,
// recent 100 verdicts, recent 100 trades) and passed in as a prop, so
// matching is a pure in-memory substring scan — no network round-trip
// per keystroke. Results are scored prefix > token-start > substring
// and capped at 8 total across all groups.
// =====================================================================

const RESULT_LIMIT = 8;
const PER_GROUP_SOFT_CAP = 5; // softly prefer up to 5 players, then fill from other groups

type FlatResult =
  | { kind: "player"; item: SearchPlayer; score: number }
  | { kind: "verdict"; item: SearchVerdict; score: number }
  | { kind: "trade"; item: SearchTrade; score: number };

const POSITION_STYLES: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  RB: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  WR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

// Lower score = better match. We want prefix matches to bubble to the
// top, then token-start ("Justin J|efferson"), then anything-substring.
function matchScore(haystack: string, needle: string): number | null {
  if (!needle) return null;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return null;
  if (h.startsWith(n)) return 0;
  // Token start = matches the start of any whitespace-delimited token
  const tokenStart = h.split(/\s+/).some((tok) => tok.startsWith(n));
  if (tokenStart) return 1;
  if (h.includes(n)) return 2;
  return null;
}

// Returns the best (lowest) score across multiple fields.
function bestScore(needle: string, ...fields: string[]): number | null {
  let best: number | null = null;
  for (const f of fields) {
    const s = matchScore(f, needle);
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

export default function SearchBar({
  index,
  prominent = false,
}: {
  index: SearchIndex;
  // prominent = wide, taller, flex-fill bar (Polymarket-style toolbar search).
  prominent?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // --- open/close helpers --------------------------------------------------
  const openModal = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIdx(0);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  // --- global keyboard shortcuts -------------------------------------------
  // ⌘K / Ctrl+K from anywhere opens. `/` opens unless the user is typing in
  // an input/textarea/contenteditable (don't hijack their search field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closeModal();
        else openModal();
        return;
      }
      if (e.key === "/" && !open) {
        const tgt = e.target as HTMLElement | null;
        const tag = tgt?.tagName?.toLowerCase();
        const editable =
          tag === "input" ||
          tag === "textarea" ||
          tgt?.isContentEditable === true;
        if (editable) return;
        e.preventDefault();
        openModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openModal, closeModal]);

  // --- body scroll lock + autofocus ---------------------------------------
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Microtask delay so the input is mounted before we focus it.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // --- result computation --------------------------------------------------
  const results = useMemo<FlatResult[]>(() => {
    const q = query.trim();
    if (!q) return [];

    const playerHits: FlatResult[] = [];
    for (const p of index.players) {
      const s = bestScore(q, p.name, p.team);
      if (s !== null) playerHits.push({ kind: "player", item: p, score: s });
    }
    playerHits.sort((a, b) => a.score - b.score);

    const verdictHits: FlatResult[] = [];
    for (const v of index.verdicts) {
      const s = bestScore(q, v.snippet, v.scenarioType);
      if (s !== null) verdictHits.push({ kind: "verdict", item: v, score: s });
    }
    verdictHits.sort((a, b) => a.score - b.score);

    const tradeHits: FlatResult[] = [];
    for (const t of index.trades) {
      const s = bestScore(q, t.sideASummary, t.sideBSummary);
      if (s !== null) tradeHits.push({ kind: "trade", item: t, score: s });
    }
    tradeHits.sort((a, b) => a.score - b.score);

    // Compose final list: take soft caps from each group, then fill
    // remaining slots from anything left over (best-score first).
    const picked: FlatResult[] = [];
    const pulledFrom = (arr: FlatResult[], cap: number) => {
      for (let i = 0; i < arr.length && picked.length < RESULT_LIMIT; i++) {
        if (picked.filter((p) => p.kind === arr[i].kind).length >= cap) break;
        picked.push(arr[i]);
      }
    };
    pulledFrom(playerHits, PER_GROUP_SOFT_CAP);
    pulledFrom(verdictHits, 2);
    pulledFrom(tradeHits, 2);

    if (picked.length < RESULT_LIMIT) {
      const leftover = [...playerHits, ...verdictHits, ...tradeHits]
        .filter((r) => !picked.includes(r))
        .sort((a, b) => a.score - b.score);
      for (const r of leftover) {
        if (picked.length >= RESULT_LIMIT) break;
        picked.push(r);
      }
    }

    return picked;
  }, [query, index]);

  // Reset highlight when results change so we don't point past the end.
  useEffect(() => {
    setActiveIdx(0);
  }, [results.length]);

  // --- navigation ----------------------------------------------------------
  const openResult = useCallback(
    (r: FlatResult) => {
      let href = "";
      if (r.kind === "player") href = `/player/${r.item.id}`;
      else if (r.kind === "verdict") href = `/verdict/${r.item.id}`;
      else if (r.kind === "trade") href = `/trades/${r.item.id}`;
      if (!href) return;
      closeModal();
      router.push(href);
    },
    [closeModal, router],
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) openResult(r);
    }
  }

  // Scroll the active row into view as the user arrows through results.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-result-idx="${activeIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // --- triggers (header) ---------------------------------------------------
  return (
    <>
      {/* sm+ : full fake-input trigger */}
      <button
        type="button"
        onClick={openModal}
        aria-label="Open search"
        className={
          prominent
            ? "hidden h-10 w-full items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3.5 text-left text-sm text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300 sm:flex"
            : "hidden h-9 w-56 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 text-left text-sm text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300 sm:flex lg:w-72"
        }
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">Search players, trades, verdicts…</span>
        <kbd className="hidden shrink-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline-block">
          ⌘K
        </kbd>
      </button>

      {/* <sm : icon-only trigger */}
      <button
        type="button"
        onClick={openModal}
        aria-label="Open search"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/70 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 sm:hidden"
      >
        <Search className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-3 pt-[10vh] backdrop-blur-sm sm:px-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl shadow-emerald-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3.5 py-3">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                aria-label="Search"
                placeholder="Search players, trades, verdicts…"
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden shrink-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline-block">
                esc
              </kbd>
            </div>

            <div
              ref={listRef}
              className="max-h-[60vh] overflow-y-auto py-2"
            >
              {query.trim() === "" ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">
                  Type to search players, verdicts, trades
                </div>
              ) : results.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500">
                  Nothing matches.
                </div>
              ) : (
                <ResultsList
                  results={results}
                  activeIdx={activeIdx}
                  onHover={setActiveIdx}
                  onPick={openResult}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ResultsList({
  results,
  activeIdx,
  onHover,
  onPick,
}: {
  results: FlatResult[];
  activeIdx: number;
  onHover: (i: number) => void;
  onPick: (r: FlatResult) => void;
}) {
  // Group results by kind so we can render section headers, while preserving
  // the flat index for keyboard navigation. We pre-compute the flat index of
  // each row so arrow-up/down maps cleanly.
  const groups: { kind: FlatResult["kind"]; label: string; rows: { r: FlatResult; flatIdx: number }[] }[] = [
    { kind: "player", label: "Players", rows: [] },
    { kind: "verdict", label: "Verdicts", rows: [] },
    { kind: "trade", label: "Trades", rows: [] },
  ];
  results.forEach((r, i) => {
    const g = groups.find((g) => g.kind === r.kind);
    if (g) g.rows.push({ r, flatIdx: i });
  });

  return (
    <>
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <div key={g.kind} className="mb-1 last:mb-0">
            <div className="px-3.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {g.label}
            </div>
            {g.rows.map(({ r, flatIdx }) => (
              <ResultRow
                key={`${r.kind}-${"id" in r.item ? r.item.id : flatIdx}`}
                result={r}
                active={flatIdx === activeIdx}
                onMouseEnter={() => onHover(flatIdx)}
                onClick={() => onPick(r)}
                flatIdx={flatIdx}
              />
            ))}
          </div>
        ))}
    </>
  );
}

function ResultRow({
  result,
  active,
  onMouseEnter,
  onClick,
  flatIdx,
}: {
  result: FlatResult;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  flatIdx: number;
}) {
  const base =
    "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition";
  const state = active
    ? "bg-emerald-500/10 text-zinc-100"
    : "text-zinc-300 hover:bg-zinc-800/60";

  if (result.kind === "player") {
    const p = result.item;
    return (
      <button
        type="button"
        data-result-idx={flatIdx}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
        className={`${base} ${state}`}
      >
        <span
          className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
            POSITION_STYLES[p.position] ??
            "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
          }`}
        >
          {p.position}
        </span>
        <span className="truncate">{p.name}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">
          {p.team}
        </span>
      </button>
    );
  }

  if (result.kind === "verdict") {
    const v = result.item;
    const typeLabel = v.scenarioType === "draft" ? "Draft" : "Start/Sit";
    return (
      <button
        type="button"
        data-result-idx={flatIdx}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
        className={`${base} ${state}`}
      >
        <span className="inline-flex shrink-0 items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 ring-1 ring-inset ring-amber-500/30">
          {typeLabel}
        </span>
        <span className="truncate text-zinc-300">
          {v.snippet || "(no notes)"}
        </span>
      </button>
    );
  }

  // trade
  const t = result.item;
  return (
    <button
      type="button"
      data-result-idx={flatIdx}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`${base} ${state}`}
    >
      <span className="inline-flex shrink-0 items-center rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 ring-1 ring-inset ring-sky-500/30">
        Trade
      </span>
      <span className="truncate text-zinc-300">
        <span className="text-rose-300">{t.sideASummary || "—"}</span>
        <span className="px-1 text-zinc-500">vs</span>
        <span className="text-sky-300">{t.sideBSummary || "—"}</span>
      </span>
    </button>
  );
}
