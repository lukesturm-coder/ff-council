import { redirect } from "next/navigation";

// The drag tier board now lives inside the unified rankings hub at /council.
// Kept as a redirect so old links/bookmarks land on the right tool.
export default function CouncilRankingsRedirect() {
  redirect("/council?view=board");
}
