"use client";

import { useState } from "react";
import { Check, Loader2, Share2 } from "lucide-react";

// Reusable "share as image" button. Captures the element with id={targetId} to
// a PNG (excluding anything marked data-share-ignore — e.g. this button), then
// opens the native share sheet on mobile or downloads on desktop. The capture
// lib is dynamically imported so it never ships in the initial bundle.
export default function ShareButton({
  targetId,
  filename = "ff-council.png",
  className,
}: {
  targetId: string;
  filename?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const node = document.getElementById(targetId);
    if (!node || state === "busy") return;
    setState("busy");
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: "#09090b",
        cacheBust: true,
        filter: (n) =>
          !(n instanceof HTMLElement && n.dataset.shareIgnore === "true"),
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "FF Council" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        a.click();
      }
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      data-share-ignore="true"
      onClick={onClick}
      aria-label="Share as image"
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
      }
    >
      {state === "busy" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
      Share
    </button>
  );
}
