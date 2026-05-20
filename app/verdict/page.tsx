import { redirect } from "next/navigation";

// =====================================================================
// /verdict (list) → /judge.
//
// The verdict list folded into the unified Judge community hub, where
// every case (trades + start/sit + draft picks) now lives. Detail pages
// (/verdict/[id]) and the post form (/verdict/new) stay where they are —
// inbound vote/share links keep working. This redirect only retires the
// standalone list surface.
// =====================================================================

export default function VerdictListRedirect() {
  redirect("/judge");
}
