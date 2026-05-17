"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

// Copy a deep-link to this verdict scenario to the clipboard. Mirrors
// app/trades/[id]/ShareButton.tsx so the UI feels consistent across
// detail pages, but points at /verdict/<id>.
export default function ShareButton({ scenarioId }: { scenarioId: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const url = `${window.location.origin}/verdict/${scenarioId}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard failed — fall back to the legacy selection approach
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
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          Copied
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" />
          Share
        </>
      )}
    </button>
  );
}
