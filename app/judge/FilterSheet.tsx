"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Filter, X } from "lucide-react";

/**
 * Mobile-first bottom-sheet dialog for the Judge filter chips.
 * Renders a floating "Filter (N)" button bottom-right; on tap opens a
 * native <dialog> housing the chip rows passed in as children. Closes on
 * backdrop tap, close button, or Escape.
 *
 * `activeCount` is the number of non-default filters currently applied —
 * used in the trigger label and as a subtle "you have filters on" hint.
 */
export default function FilterSheet({
  activeCount,
  children,
  footer,
}: {
  activeCount: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync `open` state ↔ the native dialog element. Using showModal() gives
  // us the built-in backdrop, scrim, and ESC-to-close behavior for free.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  // Backdrop click = close. The <dialog> element fills the viewport, so
  // clicks on the dialog element itself (outside the panel) count as
  // backdrop clicks.
  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) setOpen(false);
  }

  const hasFilters = activeCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium backdrop-blur ring-1 transition ${
          hasFilters
            ? "bg-emerald-500/20 text-emerald-100 ring-emerald-500/40"
            : "bg-zinc-900/95 text-zinc-200 ring-zinc-700"
        }`}
        aria-label="Open filters"
      >
        <Filter className="h-3.5 w-3.5" />
        Filter{hasFilters ? ` (${activeCount})` : ""}
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={handleBackdropClick}
        className="m-0 w-full max-w-3xl rounded-t-2xl border border-zinc-800 bg-zinc-950 p-0 text-zinc-100 backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:rounded-2xl"
        style={{
          // Anchor to bottom of viewport on mobile (bottom-sheet),
          // center on larger screens.
          marginLeft: "auto",
          marginRight: "auto",
          marginTop: "auto",
          marginBottom: 0,
        }}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <p className="text-sm font-semibold text-zinc-100">Filters</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
            aria-label="Close filters"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">{children}</div>
        {footer && (
          <div className="border-t border-zinc-800 px-4 py-3">{footer}</div>
        )}
      </dialog>
    </>
  );
}
