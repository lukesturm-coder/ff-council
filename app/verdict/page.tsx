import { redirect } from "next/navigation";

// =====================================================================
// /verdict is the legacy tough-call list page. The list has been folded
// into /trades (now "Court") — every submission shows up in one unified
// docket. Detail pages /verdict/[id] keep their URLs so existing inbound
// links and Activity Ticker entries don't break. Only the list page
// redirects.
//
// Preserves query params (?type, ?scoring, ?sort) so old shareable
// filter links still land somewhere useful, even though /trades uses
// slightly different filter keys.
// =====================================================================

export default async function VerdictRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams();
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
