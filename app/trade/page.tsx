import { redirect } from "next/navigation";

// =====================================================================
// /trade is the legacy Trade Calc surface. It now lives at /trades along
// with the Trade Court list — one unified trade page. This route stays
// alive only to redirect old links (and shared deep links with the
// calculator's a, b, pa, pb, scoring params) to the new home.
// =====================================================================

export default async function TradeRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  // Preserve every param. Calculator params (a/b/pa/pb/scoring) are the
  // ones that actually matter for shareable links, but anything else
  // someone tacked on (e.g. a UTM tag) passes through too.
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, v);
    } else {
      sp.set(key, value);
    }
  }
  const qs = sp.toString();
  redirect(qs ? `/trades?${qs}` : "/trades");
}
