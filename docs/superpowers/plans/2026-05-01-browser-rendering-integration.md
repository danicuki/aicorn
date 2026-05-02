# Browser Rendering for Page Extraction — Integration Note

> Companion to `2026-05-01-cache-extraction-pipeline.md`. Read that first.
> Source: <https://developers.cloudflare.com/browser-run/> (Browser Rendering, formerly "Browser Run").

## TL;DR

Cloudflare Browser Rendering ships a `POST /browser-rendering/markdown` Quick Action that takes a URL and returns clean markdown. It runs a real headless Chrome on Cloudflare's edge, so it handles JS-rendered pages and does the HTML-to-markdown conversion server-side. **Use it as the primary MISS path. Drop Workers-AI-as-extractor entirely.** Keep the hardcoded fallback. Keep Workers AI only if we want an "AI summary / tags" header for the pitch — not for extraction.

## Why this changes the plan

The original plan's extraction stage has three weaknesses we already discussed:

1. `fetch(url)` returns empty shells for SPAs.
2. Llama 3.1 8B has an 8K-token context, so 60K char HTML truncates.
3. LLM extraction is non-deterministic — same URL, different markdown across runs.

`/browser-rendering/markdown` solves all three in one call. It is deterministic, headless-Chrome-rendered, and not bounded by an LLM context window.

## What Browser Rendering exposes

Three layers, pick the lowest one that works.

### 1. `/markdown` Quick Action — RECOMMENDED for our pipeline

```
POST https://api.cloudflare.com/client/v4/accounts/<accountId>/browser-rendering/markdown
Authorization: Bearer <apiToken>
Content-Type: application/json

{ "url": "https://example.com" }
```

Response:
```json
{ "success": true, "result": "# Example Domain\n\nThis domain is for use..." }
```

- Renders the page with real Chrome, then converts to markdown.
- One request in, markdown out. No puppeteer, no `page.content()`, no Turndown.
- Counts as one Quick Action against the rate limit.

There is also `/content` (returns rendered HTML) and `/json` (structured extraction with an AI prompt). For our lane, `/markdown` is the cleanest fit.

### 2. Worker binding + `@cloudflare/puppeteer` — overkill for us

Useful if we needed cookie-banner clicks, scrolling, or selector-based waits. We don't. Skip.

### 3. `/crawl` — out of scope

Multi-page crawling. Not what we're doing.

## Limits and costs (verified 2026-05-03)

Source: <https://developers.cloudflare.com/browser-rendering/limits>, <https://developers.cloudflare.com/browser-rendering/pricing>.

Browser hours are a **shared monthly budget** across REST and Workers Bindings — both pull from the same bucket. Concurrent browser limits apply to bindings only.

| | **Workers Free** | **Workers Paid** (this project) |
|---|---|---|
| Browser hours included | 10 min / day | 10 hours / month |
| Browser hours overage | hard cap, 429 after | $0.09 per additional hour |
| REST API rate limit | 6 req / min | 600 req / min |
| Concurrent browsers (bindings) | 3 | 10 included (monthly avg), $2.00 / additional |
| New browser instances / min (bindings) | 3 | 30 |
| Per-browser timeout | 60 s | 60 s |
| Concurrent ceiling (raisable on request) | 3 | 30 |

**Pricing model:** billed by wall-clock browser time, no per-request fee. `$0.09/hour ≈ $0.000025/second`. A typical `/markdown` call takes 3–8 s, so per-render unit cost on overage is ~$0.000125 (about 0.0125¢/page).

**Cost at scale** (after the 10-hour/month included grant, ~5 s avg per render):

| Renders / month | Browser hours | Paid cost |
|---|---|---|
| 1,000 | 1.4 h | $0 (within grant) |
| 7,200 | 10 h | $0 (matches grant) |
| 50,000 | 69 h | $5.31 |
| 500,000 | 694 h | $61.56 |

Implications for our 5-hour build (we're on Paid):

- The 600 RPM Paid limit is a non-issue for the demo (judge traffic is well under 10 req/s). On Free's 6 RPM, even sequential testing crawls.
- The included 10 hours/month is generous — hackathon-scale traffic stays inside the grant by orders of magnitude.
- Browser hours are **per-account**, not per-Worker. If anything else on Mikhail's account uses Browser Rendering it eats from the same 10-hour grant.
- **Cache aggressively in dev** — once a URL is in KV, subsequent requests hit the cache and don't touch Browser Rendering. This still matters for cost predictability, not just rate limits.
- **Pre-warming (Task 11) remains mandatory** — not for rate-limit dodging anymore (we're on Paid), but to keep every judge-visible request as a sub-100-ms HIT instead of a 3–8 s MISS.

**Note on stale numbers:** earlier drafts of this plan cited "1 Quick Action every 10 seconds" and "1 new instance every 20 seconds." Those were prior limits. The current shape (6/min Free, 600/min Paid; 3/min Free, 30/min Paid for new instances) is verified above.

## Integration into the cache-extraction plan

This replaces the fetch + Workers-AI-extract steps in **Task 7** and **Task 8** of `2026-05-01-cache-extraction-pipeline.md`. Everything else (cache key, KV store, ledger client, fallback, pre-warm) is unchanged.

### Step 1 — `wrangler.toml`

We don't need the `[browser]` binding because we're using the REST endpoint (Quick Action), not puppeteer. Add the API token + account ID as Worker secrets:

```bash
npx wrangler secret put CF_API_TOKEN     # paste token with "Browser Rendering - Edit"
npx wrangler secret put CF_ACCOUNT_ID
```

Update `src/env.ts`:

```ts
export type Env = {
  KV: KVNamespace;
  AI: Ai;                      // optional now — only kept if we want summary/tags
  DEMO_URL: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
};
```

### Step 2 — replace `src/extraction/extract.ts`

```ts
import type { Env } from "../env";

export async function extractMarkdown(env: Env, url: string): Promise<string> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    },
  );
  if (!res.ok) {
    throw new Error(`browser-rendering ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { success: boolean; result?: string; errors?: unknown[] };
  if (!body.success || !body.result) {
    throw new Error(`browser-rendering empty: ${JSON.stringify(body.errors ?? [])}`);
  }
  return body.result;
}
```

Note the signature change: `extractMarkdown(env, url)` — we no longer fetch HTML ourselves and pass it in. Browser Rendering does the fetch.

### Step 3 — simplify the MISS path in `src/routes/fetch.ts`

Replace the `// MISS path` block in Task 8 with:

```ts
// MISS path — Browser Rendering does the fetch + render + markdown conversion in one call
let markdown: string;
try {
  markdown = await extractMarkdown(c.env, url);
} catch (err) {
  const fb = fallbackForDemoUrl(url, c.env.DEMO_URL);
  if (!fb) return c.text(`extraction failed: ${(err as Error).message}`, 502);
  console.error("extraction failed, using fallback for demo URL", err);
  markdown = fb;
}

// We no longer have raw HTML to measure. Estimate "original" tokens as
// what a naive client would have spent: markdown × ~5 (HTML is bulkier than markdown).
const extractedTokens = estimateTokens(markdown);
const originalTokens = extractedTokens * 5;
const extractionCost = extractedTokens;

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
  source_etag: null,            // we don't see origin headers anymore
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
```

Two things worth flagging:

- We lose access to origin response headers (etag, last-modified). `source_etag` becomes `null`. The plan never reads it anyway, so it's fine.
- "Tokens saved" needs a heuristic since we never see the raw HTML. `markdown_tokens × 5` is a defensible stand-in — real-world ratio is usually 4–7×. The judge-facing number is the *gap*, not the truth.

### Step 4 — drop Workers AI from extraction

Remove the `[ai]` binding from `wrangler.toml` if we're not using Llama anywhere else. Or keep it for a stretch goal like "AI-generated summary of the article" served as `X-Summary` — but that is a pitch decision, not a pipeline decision.

### Step 5 — adjust Task 9 (fallback)

Unchanged. Still needed. Browser Rendering can still fail (rate limit, timeout, unreachable origin, daily quota exhausted). Fallback covers all of those for the demo URL.

### Step 6 — adjust Task 11 (pre-warm)

Unchanged in mechanics, more important in spirit. The 10-seconds-between-Quick-Actions cap means a live demo with curious judges could rate-limit. Pre-warm so every demo request is a HIT.

## What does NOT change

- Cache key (`sha256(url) → cache:<hex>`).
- KV value shape (`CacheEntry`).
- Ledger contract and in-process `app.fetch` calls.
- Hono route mounting.
- Token estimation (still `chars/4` heuristic).
- All TDD tasks (Tasks 2, 3, 4, 5) — they cover pure helpers, no extraction stack involved.

## Failure modes & fallback chain

In order, what we do when something breaks:

1. `/markdown` returns success → cache it, serve it.
2. `/markdown` 4xx (bad URL, blocked origin, paywall) → if demo URL, serve canned markdown; else 502.
3. `/markdown` 429 (rate-limited) → if demo URL, serve canned markdown; else 502 with `Retry-After`. *Live demo: should never hit because we pre-warmed.*
4. `/markdown` 5xx / timeout → same as 429.
5. KV write fails after successful extraction → still serve markdown to the caller (don't waste the extraction). Log.

The plan's existing Task 9 covers cases 2–4 for the demo URL. Good enough for 5 hours.

## Risks not solved by this change

These are *the same* risks Browser Rendering does not address — calling them out so we don't claim victory on the wrong problem:

- **Bot-blocked sites (NYT, Reddit, LinkedIn).** Browser Rendering still runs from CF datacenter IPs and exposes a recognizable UA. Many origins block it.
- **Paywalled / login-walled content.** No session.
- **Geo-restricted content.** PoP-dependent.
- **Non-HTML resources.** PDF/image/JSON URLs will fail or return junk.

For the demo: pick a URL that is server-rendered, public, and doesn't have aggressive bot blocking. (Wikipedia article, MDN page, a personal blog post, a Cloudflare docs page.) Then pre-warm.

## Recommended task ordering for Nikolay

Substitute these into the existing plan:

| Original | New |
|---|---|
| Task 7: Workers AI extraction | Task 7: Browser Rendering `/markdown` extraction (this doc) |
| Task 8: `/fetch` route | Task 8: `/fetch` route — simplified MISS path (this doc) |
| Task 9: Fallback | Unchanged |
| Task 10: Integration | Unchanged |
| Task 11: Pre-warm | Unchanged, treat as mandatory |

Net effect: Task 7 is shorter and less risky. The "hard cut at hour 3" in the original plan is less likely to fire. We trade one risky dependency (LLM extraction quality) for a different one (Browser Rendering rate limits) — but Browser Rendering's failure mode (a clear 429) is easier to reason about than Llama's failure mode (silently truncated, hallucinated, or wrapped-in-code-fences markdown).

## One-line summary for the standup

> Switching extraction from Workers AI Llama-3.1-8B to Browser Rendering's `/markdown` Quick Action. Same cache, same ledger, same fallback. Better SPA handling, deterministic output, no context-window cliff. Pre-warming is now non-negotiable.
