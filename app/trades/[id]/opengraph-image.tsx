import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

// =====================================================================
// Dynamic Open Graph image for /trades/[id].
//
// Renders a 1200x630 PNG at request time using next/og's ImageResponse.
// Twitter, iMessage, Slack, Reddit, etc. crawl this URL automatically
// because the file is named opengraph-image.tsx in the route segment —
// Next.js wires the metadata for us, no manifest edits needed.
//
// ImageResponse JSX caveats (this is why the markup looks unusual):
//   - flex only — no `display: grid`, no `display: block` by default
//   - no shadows on some elements; gradients are fine via backgroundImage
//   - no Tailwind class processing — every style is inline
//   - no <img> for relative/private assets — we skip images entirely
//   - system fonts only (we don't bundle a custom font to keep cold-start
//     latency tiny on the edge runtime)
// =====================================================================

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "FF Council — Trade Verdict";

type SidePlayer = {
  player_id: number | null;
  name: string;
  team: string;
  position: string;
};
type SidePick = { year: number; round: number; slot: number | null };
type Side = { players: SidePlayer[]; picks: SidePick[] };

// Position accents mirror the live page palette so the OG card feels
// like a thumbnail of the real product.
const POSITION_COLOR: Record<string, string> = {
  QB: "#fda4af", // rose-300
  RB: "#6ee7b7", // emerald-300
  WR: "#7dd3fc", // sky-300
  TE: "#fcd34d", // amber-300
};

function pickLabel(pk: SidePick): string {
  const slot = pk.slot != null ? `.${String(pk.slot).padStart(2, "0")}` : "";
  return `${pk.year} ${pk.round}${slot}`;
}

// Fallback card used when the trade row is missing or any fetch fails.
// Keeps share previews polished even on a stale link.
function fallback() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#09090b",
          backgroundImage:
            "radial-gradient(ellipse at top, rgba(16,185,129,0.18), transparent 60%)",
          padding: "60px",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI'",
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#34d399",
            fontSize: 36,
            letterSpacing: 4,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          FF COUNCIL
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 72,
            fontWeight: 700,
          }}
        >
          Crowd-judged trades
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            color: "#71717a",
            fontSize: 28,
          }}
        >
          ffcouncil.com
        </div>
      </div>
    ),
    { ...size },
  );
}

export default async function Image({
  params,
}: {
  params: { id: string };
}) {
  try {
    const supabase = await createClient();

    // Fetch the trade row + raw votes in parallel. We intentionally do
    // NOT use the trade_vote_summary view — it has a known anon-vote
    // count bug. Counting trade_votes directly is the source of truth.
    const [{ data: trade }, { data: votes }] = await Promise.all([
      supabase
        .from("trade_submissions")
        .select("side_a, side_b")
        .eq("id", params.id)
        .maybeSingle(),
      supabase.from("trade_votes").select("winner").eq("trade_id", params.id),
    ]);

    if (!trade) return fallback();

    const sideA = (trade.side_a ?? { players: [], picks: [] }) as Side;
    const sideB = (trade.side_b ?? { players: [], picks: [] }) as Side;

    // Aggregate winner buckets — A / B / EVEN.
    let votesA = 0;
    let votesB = 0;
    let votesEven = 0;
    for (const v of votes ?? []) {
      const w = (v as { winner: string }).winner;
      if (w === "A") votesA += 1;
      else if (w === "B") votesB += 1;
      else if (w === "EVEN") votesEven += 1;
    }
    const total = votesA + votesB + votesEven;

    // Headline: the leading bucket. Ties resolve A > B > EVEN, which
    // matches the priority in the page-level winner calc.
    let verdictHeadline = "Be the first to weigh in";
    let verdictColor = "#a1a1aa"; // zinc-400
    if (total > 0) {
      const aPct = Math.round((votesA / total) * 100);
      const bPct = Math.round((votesB / total) * 100);
      const evenPct = 100 - aPct - bPct;
      if (aPct >= bPct && aPct >= evenPct) {
        verdictHeadline = `${aPct}% favor Team A`;
        verdictColor = "#fda4af"; // rose-300
      } else if (bPct >= aPct && bPct >= evenPct) {
        verdictHeadline = `${bPct}% favor Team B`;
        verdictColor = "#7dd3fc"; // sky-300
      } else {
        verdictHeadline = `${evenPct}% called it even`;
        verdictColor = "#6ee7b7"; // emerald-300
      }
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#09090b",
            backgroundImage:
              "radial-gradient(ellipse at top, rgba(16,185,129,0.18), transparent 65%)",
            padding: "56px 64px",
            color: "#fafafa",
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI'",
          }}
        >
          {/* Top-left brand mark */}
          <div
            style={{
              display: "flex",
              color: "#34d399",
              fontSize: 32,
              letterSpacing: 4,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            FF COUNCIL
          </div>

          {/* Center: the two sides of the trade, stacked. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              gap: 28,
              marginTop: 16,
            }}
          >
            <TradeSideRow label="Team A gets" side={sideA} />
            <div
              style={{
                display: "flex",
                color: "#52525b",
                fontSize: 22,
                letterSpacing: 4,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              FOR
            </div>
            <TradeSideRow label="Team B gets" side={sideB} />
          </div>

          {/* Verdict line + footer */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 56,
                fontWeight: 800,
                color: verdictColor,
                lineHeight: 1,
              }}
            >
              {verdictHeadline}
            </div>
            <div
              style={{ display: "flex", color: "#71717a", fontSize: 24 }}
            >
              ffcouncil.com
            </div>
          </div>
        </div>
      ),
      { ...size },
    );
  } catch {
    return fallback();
  }
}

// One row of the trade. Players first (with colored position chip in the
// player name itself), then picks. Truncated if a side runs long.
function TradeSideRow({ label, side }: { label: string; side: Side }) {
  const items: { text: string; position?: string }[] = [
    ...side.players.map((p) => ({
      text: `${p.name} (${p.team})`,
      position: p.position,
    })),
    ...side.picks.map((pk) => ({ text: `${pickLabel(pk)} pick` })),
  ];
  const shown = items.slice(0, 4);
  const overflow = items.length - shown.length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          color: "#a1a1aa",
          fontSize: 22,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          marginTop: 8,
          gap: "12px 24px",
        }}
      >
        {shown.length === 0 ? (
          <div style={{ display: "flex", color: "#52525b", fontSize: 36 }}>
            Nothing on this side
          </div>
        ) : (
          shown.map((it, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "baseline",
                fontSize: 40,
                fontWeight: 600,
                color: it.position
                  ? POSITION_COLOR[it.position] ?? "#fafafa"
                  : "#fafafa",
              }}
            >
              {it.text}
            </div>
          ))
        )}
        {overflow > 0 && (
          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "#71717a",
              alignItems: "baseline",
            }}
          >
            +{overflow} more
          </div>
        )}
      </div>
    </div>
  );
}
