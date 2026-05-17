import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import type {
  VerdictPlayer,
  VerdictContext,
  VerdictScenarioType,
} from "../types";

// =====================================================================
// Dynamic Open Graph image for /verdict/[id].
//
// Mirrors app/trades/[id]/opengraph-image.tsx — same brand mark, same
// emerald glow, same bottom-right footer — so that any FF Council share
// link feels visually consistent across surfaces.
//
// ImageResponse JSX caveats (re-stated since this file is read in
// isolation): flex only, every style inline, system fonts, no Tailwind.
// =====================================================================

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "FF Council — Verdict";

const POSITION_COLOR: Record<string, string> = {
  QB: "#fda4af", // rose-300
  RB: "#6ee7b7", // emerald-300
  WR: "#7dd3fc", // sky-300
  TE: "#fcd34d", // amber-300
};

const TYPE_LABEL: Record<VerdictScenarioType, string> = {
  draft: "Draft",
  start_sit: "Start/Sit",
};

// One-line summary mirroring the detail page's scenarioSummary().
function scenarioSummary(
  type: VerdictScenarioType,
  ctx: VerdictContext,
): string {
  if (type === "draft") {
    const round = ctx.round ? `Round ${ctx.round}` : "Draft pick";
    const need = ctx.position_needed ? ` — ${ctx.position_needed} needed` : "";
    return `${round}${need}`;
  }
  const week = ctx.week ? `Week ${ctx.week}` : "Start/Sit";
  const slot = ctx.slot_type ? ` ${ctx.slot_type}` : "";
  return `Start/Sit — ${week}${slot}`.replace(/\s+/g, " ").trim();
}

function fallback() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          // Matches the trade fallback — centered radial emerald glow.
          backgroundImage:
            "radial-gradient(ellipse at center, rgba(16,185,129,0.22), transparent 65%)",
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
            fontSize: 120,
            letterSpacing: 10,
            fontWeight: 800,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          FF COUNCIL
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 40,
            color: "#d4d4d8",
            fontWeight: 500,
          }}
        >
          Crowdsourced fantasy verdicts. Tap in.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            color: "#71717a",
            fontSize: 24,
            letterSpacing: 2,
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

    // Pull the scenario shell + all votes. Counting verdict_votes
    // directly (rather than any view) keeps anon votes accurate.
    const [{ data: scenario }, { data: votes }] = await Promise.all([
      supabase
        .from("verdict_scenarios")
        .select("scenario_type, candidates, context, notes")
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("verdict_votes")
        .select("pick_player_id")
        .eq("scenario_id", params.id),
    ]);

    if (!scenario) return fallback();

    const type = scenario.scenario_type as VerdictScenarioType;
    const candidates: VerdictPlayer[] =
      (scenario.candidates as VerdictPlayer[] | null) ?? [];
    const ctx: VerdictContext =
      (scenario.context as VerdictContext | null) ?? {};
    const rawNotes = (scenario.notes as string | null) ?? "";

    // Aggregate by player_id and find the leader. Ties resolve to the
    // first candidate in array order — matches the detail page.
    const byPlayer: Record<number, number> = {};
    let total = 0;
    for (const v of votes ?? []) {
      const pid = (v as { pick_player_id: number }).pick_player_id;
      byPlayer[pid] = (byPlayer[pid] ?? 0) + 1;
      total += 1;
    }
    let topId: number | null = null;
    let topCount = 0;
    for (const c of candidates) {
      const n = byPlayer[c.player_id] ?? 0;
      if (n > topCount) {
        topCount = n;
        topId = c.player_id;
      }
    }

    const headline = scenarioSummary(type, ctx);
    const notes =
      rawNotes.length > 120 ? rawNotes.slice(0, 117) + "..." : rawNotes;

    // Verdict line: "Council says <Player> — N%" or fallback.
    let verdictHeadline = "Be the first to weigh in";
    let verdictColor = "#a1a1aa";
    if (total > 0 && topId != null) {
      const topPlayer = candidates.find((c) => c.player_id === topId);
      const pct = Math.round((topCount / total) * 100);
      if (topPlayer) {
        verdictHeadline = `Council says ${topPlayer.name} — ${pct}%`;
        verdictColor =
          POSITION_COLOR[topPlayer.position] ?? "#6ee7b7"; // emerald-300
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
          {/* Top brand mark + scenario type badge on the same row. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
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
            <div
              style={{
                display: "flex",
                color: "#a7f3d0",
                fontSize: 24,
                letterSpacing: 3,
                padding: "6px 14px",
                border: "1px solid rgba(16,185,129,0.4)",
                borderRadius: 8,
                textTransform: "uppercase",
              }}
            >
              {TYPE_LABEL[type]}
            </div>
          </div>

          {/* Center: question + notes + candidates */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              marginTop: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 60,
                fontWeight: 700,
                color: "#fafafa",
                lineHeight: 1.1,
              }}
            >
              {headline}
            </div>
            {notes ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 18,
                  fontSize: 28,
                  color: "#a1a1aa",
                  lineHeight: 1.3,
                }}
              >
                {notes}
              </div>
            ) : null}

            {candidates.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  marginTop: 28,
                  gap: "10px 22px",
                }}
              >
                {candidates.slice(0, 4).map((c) => (
                  <div
                    key={c.player_id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      fontSize: 32,
                      fontWeight: 600,
                      color:
                        POSITION_COLOR[c.position] ?? "#fafafa",
                    }}
                  >
                    {c.name} ({c.team})
                  </div>
                ))}
                {candidates.length > 4 ? (
                  <div
                    style={{
                      display: "flex",
                      fontSize: 28,
                      color: "#71717a",
                      alignItems: "baseline",
                    }}
                  >
                    +{candidates.length - 4} more
                  </div>
                ) : null}
              </div>
            ) : null}
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
                fontSize: 52,
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
