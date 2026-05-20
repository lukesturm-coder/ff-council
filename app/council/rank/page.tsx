import { redirect } from "next/navigation";

// The Beli tap-flow now lives inside the unified rankings hub at /council.
// Kept as a redirect so old links/bookmarks land on the right tool.
export default function CouncilRankRedirect() {
  redirect("/council?view=rank");
}
