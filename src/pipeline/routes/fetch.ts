import { Hono } from "hono";
import type { Env } from "../env";
import { cacheKey } from "../cache/key";
import { readCache, writeCache, bumpHitCount } from "../cache/store";
import type { CacheEntry } from "../cache/types";
import { detectAgent } from "../lib/agent";
import { estimateTokens } from "../lib/tokens";
import { callCharge, callCredit } from "../lib/ledger-client";
import { extractMarkdown } from "../extraction/extract";

const READ_COST = 10;
const CONTRIBUTOR_REWARD = 9;

export function buildFetchRoute(rootApp: Hono<{ Bindings: Env }>) {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/fetch", async (c) => {
    const url = c.req.query("url");
    const user = c.req.query("user");
    if (!url) return c.text("missing url", 400);
    if (!user) return c.text("missing user", 400);

    const isAgent = detectAgent(c.req.raw.headers);
    const key = await cacheKey(url);
    const existing = await readCache(c.env.KV, key);

    if (existing) {
      // HIT path
      const charge = await callCharge(rootApp, c.env, user, READ_COST, `read:${url}`);
      if (!charge.ok) return c.json({ error: charge.error }, 402);

      // Credit contributor (non-fatal if it fails)
      if (existing.contributor_user_id !== user) {
        await callCredit(rootApp, c.env, existing.contributor_user_id, CONTRIBUTOR_REWARD, url);
      }

      const updated = await bumpHitCount(c.env.KV, key);
      const tokensSaved = (updated ?? existing).original_html_tokens - (updated ?? existing).extracted_tokens;

      return new Response((updated ?? existing).markdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "X-Cache": "HIT",
          "X-Tokens-Saved": String(Math.max(0, tokensSaved)),
          "X-Cost": String(READ_COST),
          "X-Agent": String(isAgent),
        },
      });
    }

    // MISS path
    const originRes = await fetch(url, { headers: { "user-agent": "agentify/0.1" } });
    if (!originRes.ok) return c.text(`origin ${originRes.status}`, 502);
    const html = await originRes.text();

    const markdown = await extractMarkdown(c.env, html);

    const originalTokens = estimateTokens(html);
    const extractedTokens = estimateTokens(markdown);
    const extractionCost = extractedTokens; // 1 credit per extracted token

    const charge = await callCharge(
      rootApp,
      c.env,
      user,
      extractionCost + READ_COST,
      `extract:${url}`,
    );
    if (!charge.ok) return c.json({ error: charge.error }, 402);

    const entry: CacheEntry = {
      markdown,
      contributor_user_id: user,
      extracted_at: Date.now(),
      source_etag: originRes.headers.get("etag"),
      hit_count: 0,
      original_html_tokens: originalTokens,
      extracted_tokens: extractedTokens,
    };
    await writeCache(c.env.KV, key, entry);

    return new Response(markdown, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "X-Cache": "MISS",
        "X-Tokens-Saved": "0",
        "X-Cost": String(extractionCost + READ_COST),
        "X-Agent": String(isAgent),
      },
    });
  });

  return route;
}
