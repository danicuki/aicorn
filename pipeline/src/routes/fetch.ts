import { Hono } from "hono";
import type { Env } from "../env";
import { cacheKey } from "../cache/key";
import { readCache, writeCache, bumpHitCount } from "../cache/store";
import type { CacheEntry } from "../cache/types";
import { detectAgent } from "../lib/agent";
import { estimateTokens } from "../lib/tokens";
import { callAccess } from "../lib/ledger-client";
import { extractMarkdown } from "../extraction/extract";
import { fallbackForDemoUrl } from "../extraction/fallback";

export function buildFetchRoute() {
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
      // HIT path. The ledger handles the read charge AND the contributor
      // credit in a single call (and self-reads as a net −1 internally).
      const access = await callAccess(c.env.LEDGER, user, url);
      if (!access.ok) {
        return c.json(
          { error: access.error, balance: access.balance },
          (access.status === 402 ? 402 : access.status || 500) as 402 | 500,
        );
      }

      const updated = await bumpHitCount(c.env.KV, key);
      const entry = updated ?? existing;
      const tokensSaved = entry.original_html_tokens - entry.extracted_tokens;

      return new Response(entry.markdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "X-Cache": "HIT",
          "X-Tokens-Saved": String(Math.max(0, tokensSaved)),
          "X-Cost": String(access.spent),
          "X-Provider": access.provider?.name ?? "",
          "X-Agent": String(isAgent),
        },
      });
    }

    // MISS path: extract, then register caller as the URL's contributor on the ledger.
    const originRes = await fetch(url, { headers: { "user-agent": "aicorn/0.1" } });
    if (!originRes.ok) return c.text(`origin ${originRes.status}`, 502);
    const html = await originRes.text();

    let markdown: string;
    try {
      markdown = await extractMarkdown(c.env, html);
    } catch (err) {
      const fb = fallbackForDemoUrl(url, c.env.DEMO_URL);
      if (!fb) throw err;
      console.error("extraction failed, using fallback for demo URL", err);
      markdown = fb;
    }

    const originalTokens = estimateTokens(html);
    const extractedTokens = estimateTokens(markdown);
    const extractionCost = extractedTokens; // 1 credit per extracted token

    const access = await callAccess(c.env.LEDGER, user, url, extractionCost);
    if (!access.ok) {
      return c.json(
        { error: access.error, balance: access.balance },
        (access.status === 402 ? 402 : access.status || 500) as 402 | 500,
      );
    }

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
        "X-Cost": String(access.spent),
        "X-Agent": String(isAgent),
      },
    });
  });

  return route;
}
