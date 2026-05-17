/**
 * Generic scrape + extract pipeline:
 *   1. Open URL in headless Chromium via Playwright
 *   2. Wait for JS to render
 *   3. Capture the relevant DOM/HTML
 *   4. Send HTML to Claude API to extract structured player futures markets
 *   5. Return normalized records ready to upsert into platform_rankings
 *
 * Used by scripts/scrape-vegas.ts. Designed to be point-at-any-URL so we can
 * iterate on which page actually returns the right data given geofencing/
 * anti-bot defenses.
 */
import Anthropic from "@anthropic-ai/sdk";
import { chromium, type Browser, type Page } from "playwright";

export type ScrapedFuture = {
  player_name: string;
  team: string | null;
  stat: string;
  line: number;
  over_odds: number;
  under_odds: number;
};

export type ScrapedOutright = {
  market: string; // "MVP", "Most Passing Yards", "Offensive Player of the Year", etc.
  player_name: string;
  team: string | null;
  odds: number; // American odds (e.g. -150, +500)
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Strip noisy elements before sending HTML to the LLM to save tokens. */
function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Open the URL in headless Chrome. Returns rendered HTML. Throws if the page
 * fails to load or returns a clearly non-betting page (e.g. a state-restricted
 * fallback).
 *
 * `waitSelector`: optional CSS selector to wait for before capturing. Use this
 * to make sure the futures markets have rendered before we grab HTML.
 */
export async function scrapePage(
  url: string,
  opts: { waitSelector?: string; timeoutMs?: number } = {},
): Promise<{ html: string; finalUrl: string; title: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const page: Page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    if (opts.waitSelector) {
      await page
        .waitForSelector(opts.waitSelector, { timeout: timeoutMs })
        .catch(() => {
          // Continue even if selector doesn't appear — let the LLM see whatever rendered
        });
    } else {
      // Give the page time for JS-rendered content to settle. Many betting
      // sites lazy-load player tables after initial paint.
      await page.waitForTimeout(6000);
    }

    const html = await page.content();
    const finalUrl = page.url();
    const title = await page.title();

    return {
      html: cleanHtml(html),
      finalUrl,
      title,
    };
  } finally {
    await browser?.close();
  }
}

const EXTRACTION_PROMPT = `You are extracting NFL player season-long futures betting markets from a sportsbook or aggregator page.

Find every player season-long over/under market in the HTML and return one JSON object per market. Include:
- player_name: full player name as it appears
- team: NFL team 3-letter abbreviation if visible (BUF, KC, ATL, etc.), else null
- stat: must be one of these exact strings:
  "Passing Yards", "Passing Touchdowns", "Interceptions Thrown",
  "Rushing Yards", "Rushing Touchdowns",
  "Receiving Yards", "Receptions", "Receiving Touchdowns"
- line: the over/under threshold as a number (e.g. 1325.5)
- over_odds: American odds for the over as an integer (e.g. -110, 120, -150)
- under_odds: American odds for the under as an integer

SKIP these — do not include them:
- Game lines (spreads, point totals, moneylines)
- Same-game parlays / single-game player props
- Anytime-touchdown yes/no markets (those aren't O/U)
- Award futures (MVP, OPOY, Rookie of the Year, etc.)
- Team season win totals
- Anything that isn't a season-long stat O/U on a specific player

Return ONLY a JSON array. No prose, no markdown, no commentary. If you find zero player season-long markets in the HTML, return [].

HTML:
`;

const OUTRIGHT_PROMPT = `You are extracting NFL outright / award / "leader" betting markets from a sports site.

Find every market where one player is picked from a field (NOT season-long stat over/unders — skip those for this task).

Markets to extract include:
- MVP odds
- Offensive Player of the Year (OPOY)
- Defensive Player of the Year (DPOY)
- Offensive / Defensive Rookie of the Year
- Comeback Player of the Year
- "Most Passing Yards" / "Most Rushing Yards" / "Most Receiving Yards" / "Most Touchdowns" / "Most Sacks" / "Most Interceptions"
- Any other "Who leads NFL in X" futures

For each player in each market, return a JSON object with:
- market: the market name (use canonical names: "MVP", "Offensive Player of the Year", "Defensive Player of the Year", "Offensive Rookie of the Year", "Defensive Rookie of the Year", "Comeback Player of the Year", "Most Passing Yards", "Most Rushing Yards", "Most Receiving Yards", "Most Touchdowns", "Most Receptions", "Most Sacks", "Most Interceptions")
- player_name: full player name
- team: 3-letter NFL team abbreviation if visible, else null
- odds: American odds as integer (e.g., -150, 500, -110, 1500). NOT decimal odds.

SKIP these — do not include them:
- Stat over/unders (single player O/U markets)
- Game lines (spreads, totals, moneylines)
- Team-level futures (Super Bowl, division winner, conference winner)
- Same-game parlays
- Per-game player props
- Draft / college markets

Return ONLY a JSON array. No prose, no markdown fencing, no commentary. If you find zero outright player markets, return [].

HTML:
`;

// Lazy-instantiated so dotenv has a chance to populate process.env before
// the SDK reads ANTHROPIC_API_KEY at construction time.
function anthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function extractOutrightsFromHtml(
  html: string,
  modelOverride?: string,
): Promise<ScrapedOutright[]> {
  const model = modelOverride ?? "claude-sonnet-4-6";
  const MAX_CHARS = 400_000;
  const trimmed =
    html.length > MAX_CHARS ? html.slice(0, MAX_CHARS) + "…[truncated]" : html;

  const response = await anthropicClient().messages.create({
    model,
    max_tokens: 8000,
    messages: [{ role: "user", content: OUTRIGHT_PROMPT + trimmed }],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON: ${cleaned.slice(0, 400)}… (${err instanceof Error ? err.message : err})`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Claude returned non-array: ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }

  const valid: ScrapedOutright[] = [];
  for (const row of parsed) {
    if (
      row &&
      typeof row === "object" &&
      typeof row.market === "string" &&
      typeof row.player_name === "string" &&
      typeof row.odds === "number"
    ) {
      valid.push({
        market: row.market,
        player_name: row.player_name,
        team: typeof row.team === "string" ? row.team : null,
        odds: Math.round(row.odds),
      });
    }
  }
  return valid;
}

export async function extractFuturesFromHtml(
  html: string,
  modelOverride?: string,
): Promise<ScrapedFuture[]> {
  const model = modelOverride ?? "claude-sonnet-4-6";

  // Truncate aggressively if the HTML is huge. Most futures pages have the
  // relevant content well under 200KB even after cleaning, but cap as safety.
  const MAX_CHARS = 400_000;
  const trimmed =
    html.length > MAX_CHARS ? html.slice(0, MAX_CHARS) + "…[truncated]" : html;

  const response = await anthropicClient().messages.create({
    model,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: EXTRACTION_PROMPT + trimmed,
      },
    ],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  // Claude sometimes wraps JSON in ```json fences; strip them.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON output: ${cleaned.slice(0, 400)}…  (${err instanceof Error ? err.message : err})`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Claude returned non-array output: ${typeof parsed} — ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }

  // Validate each row has the right shape
  const valid: ScrapedFuture[] = [];
  for (const row of parsed) {
    if (
      row &&
      typeof row === "object" &&
      typeof row.player_name === "string" &&
      typeof row.stat === "string" &&
      typeof row.line === "number" &&
      typeof row.over_odds === "number" &&
      typeof row.under_odds === "number"
    ) {
      valid.push({
        player_name: row.player_name,
        team: typeof row.team === "string" ? row.team : null,
        stat: row.stat,
        line: row.line,
        over_odds: row.over_odds,
        under_odds: row.under_odds,
      });
    }
  }
  return valid;
}
