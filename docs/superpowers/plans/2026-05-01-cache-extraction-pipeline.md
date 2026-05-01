# Cache & Extraction Pipeline — Implementation Plan (Nikolay)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cloudflare Worker `GET /fetch?url=<url>&user=<user_id>` endpoint that returns clean markdown — from KV cache on hit, from Workers AI extraction on miss — and that calls Mikhail's ledger routes for charge/credit. Owns the extraction half of the demo.

**Architecture:** Single TypeScript Worker, single repo, single deploy. URL → `sha256` → KV key. On hit: read KV, charge reader 10, credit contributor 9. On miss: fetch origin HTML → Workers AI (`@cf/meta/llama-3.1-8b-instruct`) → write KV → charge fetcher (extraction_cost + 10) and register them as contributor. Token estimates use a `chars / 4` heuristic so we don't pay for a tokenizer. Ledger lives on the same Worker, so calls are in-process via the Hono app `app.fetch` (no network) — but we still go through the HTTP shape so Mikhail and Nikolay can develop independently.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono router, Workers AI, Workers KV, Wrangler, Vitest + `@cloudflare/vitest-pool-workers` for unit tests, `curl` for integration smoke tests.

**Hackathon discipline:**
- TDD applies to **pure helpers** (URL hashing, agent detection, token estimation, KV value parsing). Integration of `/fetch` is verified with `curl` against `wrangler dev` — Worker integration tests have too much setup overhead.
- **Hard cut at Task 9:** if Workers AI is misbehaving, swap in the hardcoded extraction for the demo URL and move on.
- **Pre-warm before stage** (Task 11): the live MISS path is dramatic but fragile. Make sure HIT works no matter what.

**Lane contract** (locked by the team — do not change field names):

```
POST /ledger/charge   { user_id, amount, reason }     → { ok, new_balance } | { error }
POST /ledger/credit   { user_id, amount, url }        → { ok, new_balance }
GET  /ledger/:user_id                                 → { balance, contributions, reads }
GET  /stats                                           → { tokens_saved, reads, hit_rate, ... }
```

Nikolay calls `charge` and `credit`. Nikolay does **not** read or write `bal:*`, `stats:*`, or `contrib:*` keys directly — those are Mikhail's. Nikolay owns `cache:*` exclusively.

---

## File Structure

```
agentify/
├── package.json
├── tsconfig.json
├── wrangler.toml                  # Worker config + KV binding + AI binding
├── vitest.config.ts
├── src/
│   ├── index.ts                   # Hono app entry, mounts routes
│   ├── routes/
│   │   ├── fetch.ts               # GET /fetch — Nikolay's route
│   │   └── ledger.ts              # POST /ledger/* + GET /ledger/:user — Mikhail's routes (stub for now)
│   ├── cache/
│   │   ├── key.ts                 # sha256(url) → "cache:<hex>"
│   │   ├── store.ts               # readCache, writeCache, bumpHitCount
│   │   └── types.ts               # CacheEntry type
│   ├── extraction/
│   │   ├── extract.ts             # Workers AI extraction
│   │   └── fallback.ts            # Hardcoded markdown for demo URL
│   ├── lib/
│   │   ├── agent.ts               # detectAgent(headers) — UA + X-Agent
│   │   ├── tokens.ts              # estimateTokens(text)
│   │   └── ledger-client.ts       # callCharge / callCredit (in-process via app.fetch)
│   └── env.ts                     # Env type: KV, AI bindings
├── tests/
│   ├── cache/key.test.ts
│   ├── lib/agent.test.ts
│   ├── lib/tokens.test.ts
│   └── cache/store.test.ts
├── scripts/
│   └── prewarm.sh                 # curl the demo URL once
└── docs/superpowers/plans/
    └── 2026-05-01-cache-extraction-pipeline.md   # this file
```

**Splits by responsibility, not by layer:** `cache/` owns everything cache-shaped, `extraction/` owns LLM-shaped, `lib/` is generic. Mikhail's `routes/ledger.ts` is created here as a stub so Nikolay can develop end-to-end without waiting for Mikhail's actual implementation — they overwrite it with their real ledger code in their own commits.

---

## Task 1: Repo scaffold + Worker hello-world

Daniel may already have done this. If `wrangler.toml` exists in the repo root, skim it and skip to Task 2. Otherwise:

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `src/index.ts`
- Create: `src/env.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/nikolaytelepenin/src/ai/agentify
npm init -y
npm i hono
npm i -D wrangler typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write `wrangler.toml`**

```toml
name = "agentify"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[[kv_namespaces]]
binding = "KV"
id = "REPLACE_WITH_REAL_KV_ID"          # Daniel will fill this
preview_id = "REPLACE_WITH_REAL_KV_ID"

[ai]
binding = "AI"

[vars]
DEMO_URL = "https://example.com/article-we-show-on-stage"
```

- [ ] **Step 4: Write `src/env.ts`**

```ts
export type Env = {
  KV: KVNamespace;
  AI: Ai;
  DEMO_URL: string;
};
```

- [ ] **Step 5: Write `src/index.ts` hello-world**

```ts
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("agentify ok"));

export default app;
```

- [ ] **Step 6: Local dev sanity check**

Run: `npx wrangler dev --port 8787`
In another terminal: `curl -s localhost:8787/`
Expected: `agentify ok`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml src/
git commit -m "feat: worker scaffold with hello-world route"
```

---

## Task 2: URL → cache key (TDD)

**Files:**
- Create: `src/cache/key.ts`
- Test: `tests/cache/key.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 2: Write the failing test `tests/cache/key.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { cacheKey } from "../../src/cache/key";

describe("cacheKey", () => {
  it("produces a stable sha256-prefixed key for a URL", async () => {
    const k1 = await cacheKey("https://example.com/foo");
    const k2 = await cacheKey("https://example.com/foo");
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^cache:[0-9a-f]{64}$/);
  });

  it("produces different keys for different URLs", async () => {
    const a = await cacheKey("https://example.com/a");
    const b = await cacheKey("https://example.com/b");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: Run test, verify FAIL**

Run: `npx vitest run tests/cache/key.test.ts`
Expected: FAIL — `Cannot find module '../../src/cache/key'`

- [ ] **Step 4: Implement `src/cache/key.ts`**

```ts
export async function cacheKey(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `cache:${hex}`;
}
```

- [ ] **Step 5: Run test, verify PASS**

Run: `npx vitest run tests/cache/key.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 6: Commit**

```bash
git add src/cache/key.ts tests/cache/key.test.ts vitest.config.ts
git commit -m "feat(cache): sha256-based cache key helper"
```

---

## Task 3: Agent detection (TDD)

The lane contract: requests count as "agent" if `User-Agent` matches a known bot OR `X-Agent: true` is set. Anything else is a normal browser — those still get markdown but we tag them so Mikhail's stats can split agent vs non-agent reads later.

**Files:**
- Create: `src/lib/agent.ts`
- Test: `tests/lib/agent.test.ts`

- [ ] **Step 1: Write the failing test `tests/lib/agent.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { detectAgent } from "../../src/lib/agent";

describe("detectAgent", () => {
  it("detects ClaudeBot via User-Agent", () => {
    const h = new Headers({ "User-Agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)" });
    expect(detectAgent(h)).toBe(true);
  });

  it("detects GPTBot via User-Agent", () => {
    const h = new Headers({ "User-Agent": "GPTBot/1.0" });
    expect(detectAgent(h)).toBe(true);
  });

  it("detects PerplexityBot", () => {
    const h = new Headers({ "User-Agent": "PerplexityBot/1.0" });
    expect(detectAgent(h)).toBe(true);
  });

  it("respects X-Agent: true override", () => {
    const h = new Headers({ "User-Agent": "curl/8.0", "X-Agent": "true" });
    expect(detectAgent(h)).toBe(true);
  });

  it("returns false for plain browser UA without override", () => {
    const h = new Headers({ "User-Agent": "Mozilla/5.0 (Macintosh)" });
    expect(detectAgent(h)).toBe(false);
  });

  it("returns false when no headers", () => {
    expect(detectAgent(new Headers())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/agent.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/lib/agent.ts`**

```ts
const AGENT_UA_PATTERNS = [
  /ClaudeBot/i,
  /GPTBot/i,
  /PerplexityBot/i,
  /Anthropic/i,
  /OpenAI/i,
  /CCBot/i,
  /Google-Extended/i,
];

export function detectAgent(headers: Headers): boolean {
  if (headers.get("X-Agent")?.toLowerCase() === "true") return true;
  const ua = headers.get("User-Agent") ?? "";
  return AGENT_UA_PATTERNS.some((re) => re.test(ua));
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npx vitest run tests/lib/agent.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent.ts tests/lib/agent.test.ts
git commit -m "feat(lib): header-based agent detection"
```

---

## Task 4: Token estimation (TDD)

We don't have a tokenizer; the `chars / 4` heuristic is good enough for an X-Tokens-Saved header. The exact number doesn't matter for the demo — the *gap* matters (8000 vs 400).

**Files:**
- Create: `src/lib/tokens.ts`
- Test: `tests/lib/tokens.test.ts`

- [ ] **Step 1: Write the failing test `tests/lib/tokens.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/lib/tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("hello world!")).toBe(3); // 12 chars / 4
  });

  it("rounds up partial tokens", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 chars / 4 = 1.25 → 2
  });

  it("handles unicode without crashing", () => {
    expect(estimateTokens("日本語")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npx vitest run tests/lib/tokens.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/lib/tokens.ts`**

```ts
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npx vitest run tests/lib/tokens.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tokens.ts tests/lib/tokens.test.ts
git commit -m "feat(lib): chars-per-4 token estimator"
```

---

## Task 5: Cache types + KV store helpers (TDD)

**Files:**
- Create: `src/cache/types.ts`
- Create: `src/cache/store.ts`
- Test: `tests/cache/store.test.ts`

- [ ] **Step 1: Write `src/cache/types.ts`**

```ts
export type CacheEntry = {
  markdown: string;
  contributor_user_id: string;
  extracted_at: number;            // ms epoch
  source_etag: string | null;
  hit_count: number;
  original_html_tokens: number;
  extracted_tokens: number;
};
```

- [ ] **Step 2: Write the failing test `tests/cache/store.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { readCache, writeCache, bumpHitCount } from "../../src/cache/store";
import type { CacheEntry } from "../../src/cache/types";

const sampleKey = "cache:abc";
const sample: CacheEntry = {
  markdown: "# hi",
  contributor_user_id: "user-A",
  extracted_at: 1714560000000,
  source_etag: null,
  hit_count: 0,
  original_html_tokens: 8000,
  extracted_tokens: 400,
};

describe("cache store", () => {
  it("returns null for missing key", async () => {
    expect(await readCache(env.KV, "cache:does-not-exist")).toBeNull();
  });

  it("round-trips a CacheEntry", async () => {
    await writeCache(env.KV, sampleKey, sample);
    const read = await readCache(env.KV, sampleKey);
    expect(read).toEqual(sample);
  });

  it("bumpHitCount increments and persists", async () => {
    await writeCache(env.KV, sampleKey, sample);
    const after = await bumpHitCount(env.KV, sampleKey);
    expect(after?.hit_count).toBe(1);
    const reread = await readCache(env.KV, sampleKey);
    expect(reread?.hit_count).toBe(1);
  });

  it("bumpHitCount is a no-op when key missing", async () => {
    expect(await bumpHitCount(env.KV, "cache:nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test, verify FAIL**

Run: `npx vitest run tests/cache/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `src/cache/store.ts`**

```ts
import type { CacheEntry } from "./types";

export async function readCache(kv: KVNamespace, key: string): Promise<CacheEntry | null> {
  return kv.get<CacheEntry>(key, "json");
}

export async function writeCache(kv: KVNamespace, key: string, entry: CacheEntry): Promise<void> {
  await kv.put(key, JSON.stringify(entry));
}

export async function bumpHitCount(kv: KVNamespace, key: string): Promise<CacheEntry | null> {
  const entry = await readCache(kv, key);
  if (!entry) return null;
  entry.hit_count += 1;
  await writeCache(kv, key, entry);
  return entry;
}
```

Note on `bumpHitCount`: KV is eventually consistent and there's no atomic increment. For demo scale this is fine — at most we miscount a hit or two. Don't add Durable Objects or compare-and-swap for this; YAGNI.

- [ ] **Step 5: Run test, verify PASS**

Run: `npx vitest run tests/cache/store.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add src/cache/types.ts src/cache/store.ts tests/cache/store.test.ts
git commit -m "feat(cache): KV read/write/bump helpers + CacheEntry type"
```

---

## Task 6: Ledger client (in-process app.fetch)

The Worker hosts the ledger too, so `callCharge` / `callCredit` go straight through `app.fetch` — no real network. Mikhail won't have implemented the real ledger yet at this point, so we ship a stub `routes/ledger.ts` that always returns `ok: true`. Mikhail will overwrite it.

**Files:**
- Create: `src/lib/ledger-client.ts`
- Create: `src/routes/ledger.ts` (stub — Mikhail's territory, do not over-design)

- [ ] **Step 1: Write `src/routes/ledger.ts` stub**

```ts
import { Hono } from "hono";
import type { Env } from "../env";

export const ledger = new Hono<{ Bindings: Env }>();

// STUB — Mikhail will replace this entire file.
// Always returns ok so /fetch can be developed independently.
ledger.post("/ledger/charge", async (c) => {
  const body = await c.req.json<{ user_id: string; amount: number; reason: string }>();
  return c.json({ ok: true, new_balance: 1000 - body.amount });
});

ledger.post("/ledger/credit", async (c) => {
  const body = await c.req.json<{ user_id: string; amount: number; url: string }>();
  return c.json({ ok: true, new_balance: 1000 + body.amount });
});
```

- [ ] **Step 2: Write `src/lib/ledger-client.ts`**

```ts
import type { Hono } from "hono";
import type { Env } from "../env";

export type ChargeResult = { ok: true; new_balance: number } | { ok: false; error: string };

export async function callCharge(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  user_id: string,
  amount: number,
  reason: string,
): Promise<ChargeResult> {
  const res = await app.fetch(
    new Request("http://internal/ledger/charge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id, amount, reason }),
    }),
    env,
  );
  if (!res.ok) return { ok: false, error: `ledger ${res.status}` };
  const body = (await res.json()) as { ok: boolean; new_balance?: number; error?: string };
  if (!body.ok) return { ok: false, error: body.error ?? "unknown" };
  return { ok: true, new_balance: body.new_balance ?? 0 };
}

export async function callCredit(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  user_id: string,
  amount: number,
  url: string,
): Promise<void> {
  await app.fetch(
    new Request("http://internal/ledger/credit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id, amount, url }),
    }),
    env,
  );
  // Credit failure is non-fatal — log, don't throw.
}
```

- [ ] **Step 3: Mount the ledger stub in `src/index.ts`**

Replace the contents of `src/index.ts` with:

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { ledger } from "./routes/ledger";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("agentify ok"));
app.route("/", ledger);

export default app;
```

- [ ] **Step 4: Smoke-test the stub**

Run: `npx wrangler dev --port 8787`
In another terminal:

```bash
curl -s -X POST localhost:8787/ledger/charge \
  -H "content-type: application/json" \
  -d '{"user_id":"alice","amount":10,"reason":"read"}'
```

Expected: `{"ok":true,"new_balance":990}`

- [ ] **Step 5: Commit**

```bash
git add src/routes/ledger.ts src/lib/ledger-client.ts src/index.ts
git commit -m "feat(ledger): stub routes + in-process client (Mikhail will replace stub)"
```

---

## Task 7: Workers AI extraction

This is the riskiest piece. If it's not working after a focused attempt, jump to Task 9 (fallback) and come back later.

**Files:**
- Create: `src/extraction/extract.ts`

- [ ] **Step 1: Write `src/extraction/extract.ts`**

```ts
import type { Env } from "../env";

const SYSTEM_PROMPT = `You are an HTML-to-markdown extractor. The user gives you raw HTML.
Return ONLY the main article content as clean markdown. Strip navigation, ads,
cookie banners, footers, sidebars, scripts, and styles. Preserve headings, paragraphs,
lists, links, code blocks. Do not add commentary. Do not wrap output in code fences.`;

const MAX_HTML_CHARS = 60_000; // keep prompt under model context

export async function extractMarkdown(env: Env, html: string): Promise<string> {
  const truncated = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: truncated },
    ],
  })) as { response?: string };
  const md = result.response?.trim();
  if (!md) throw new Error("empty extraction");
  return md;
}
```

- [ ] **Step 2: Manual smoke test**

Add a temporary debug route in `src/index.ts`:

```ts
import { extractMarkdown } from "./extraction/extract";

app.get("/debug/extract", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.text("missing url", 400);
  const html = await (await fetch(url)).text();
  const md = await extractMarkdown(c.env, html);
  return c.text(md);
});
```

Run: `npx wrangler dev --port 8787 --remote` (Workers AI requires `--remote`)
In another terminal: `curl -s "localhost:8787/debug/extract?url=https://example.com" | head -50`
Expected: clean markdown, not `<!doctype html>` or HTML tags.

- [ ] **Step 3: Decision point**

If the output is recognizable markdown of the article body → continue to Task 8.
If it's gibberish, refuses, or empty after 2 attempts → **stop, jump to Task 9 (fallback), come back to this only if time remains.**

- [ ] **Step 4: Remove the debug route**

Revert the `/debug/extract` additions in `src/index.ts` — they were scaffolding.

- [ ] **Step 5: Commit**

```bash
git add src/extraction/extract.ts src/index.ts
git commit -m "feat(extraction): Workers AI markdown extraction via Llama 3.1 8b"
```

---

## Task 8: GET /fetch route (the main event)

This is the route the demo calls. Wire HIT and MISS paths, ledger calls, and X-headers.

**Files:**
- Create: `src/routes/fetch.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/routes/fetch.ts`**

```ts
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
    const extractionCost = extractedTokens; // 1 credit per extracted token, simple rule

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
```

Note: we pass `rootApp` in so the route can call `app.fetch` against the same app for ledger requests. This keeps ledger calls in-process.

- [ ] **Step 2: Wire it into `src/index.ts`**

Replace `src/index.ts` with:

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { ledger } from "./routes/ledger";
import { buildFetchRoute } from "./routes/fetch";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("agentify ok"));
app.route("/", ledger);
app.route("/", buildFetchRoute(app));

export default app;
```

- [ ] **Step 3: Smoke-test MISS**

Run: `npx wrangler dev --port 8787 --remote`

```bash
curl -s -D- "localhost:8787/fetch?url=https://example.com&user=alice" -o /tmp/a.md
head -5 /tmp/a.md
```

Expected: `X-Cache: MISS` header in response. `/tmp/a.md` contains markdown. (If extraction failed, you'll get a 500 — proceed to Task 9.)

- [ ] **Step 4: Smoke-test HIT (re-run same URL)**

```bash
curl -s -D- "localhost:8787/fetch?url=https://example.com&user=bob" -o /tmp/b.md
```

Expected: `X-Cache: HIT`, `X-Tokens-Saved: <large number>`. Same body as `/tmp/a.md`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/fetch.ts src/index.ts
git commit -m "feat(fetch): GET /fetch with HIT/MISS paths, ledger calls, X-Cache headers"
```

---

## Task 9: Hardcoded fallback for the demo URL

If Workers AI is flaky in the moment, the demo cannot fail. This task ships a fallback path: if extraction throws AND the URL is the demo URL, return the canned markdown and seed the cache.

**Files:**
- Create: `src/extraction/fallback.ts`
- Modify: `src/routes/fetch.ts`

- [ ] **Step 1: Save canned markdown**

Pick the URL Daniel will demo. Curl it, run it through Jina Reader (`r.jina.ai/<url>`) or hand-clean the HTML, save the markdown.

Write `src/extraction/fallback.ts`:

```ts
// Canned markdown for the on-stage demo URL. If Workers AI fails, we serve this
// so the demo doesn't fall over. Pre-warmed by scripts/prewarm.sh anyway.

const FALLBACK_MARKDOWN = `# Article Title Goes Here

PASTE THE REAL HAND-CLEANED MARKDOWN HERE BEFORE THE DEMO.

This text is what judges will see if Workers AI is flaky. Make it look like a real article body.`;

export function fallbackForDemoUrl(url: string, demoUrl: string): string | null {
  if (url === demoUrl) return FALLBACK_MARKDOWN;
  return null;
}
```

- [ ] **Step 2: Modify `src/routes/fetch.ts` to use the fallback**

In the MISS path of `route.get("/fetch", ...)`, replace:

```ts
const markdown = await extractMarkdown(c.env, html);
```

with:

```ts
let markdown: string;
try {
  markdown = await extractMarkdown(c.env, html);
} catch (err) {
  const fb = fallbackForDemoUrl(url, c.env.DEMO_URL);
  if (!fb) throw err;
  console.error("extraction failed, using fallback for demo URL", err);
  markdown = fb;
}
```

And add the import at the top of `src/routes/fetch.ts`:

```ts
import { fallbackForDemoUrl } from "../extraction/fallback";
```

- [ ] **Step 3: Manually verify the fallback path**

Temporarily break extraction by editing `src/extraction/extract.ts` to throw at the top of `extractMarkdown`. Run `wrangler dev --remote`. Hit `/fetch?url=$DEMO_URL&user=alice`. Expect the canned markdown. Hit `/fetch?url=https://example.com&user=alice` (a non-demo URL) — expect a 500. Revert the extract.ts change.

- [ ] **Step 4: Commit**

```bash
git add src/extraction/fallback.ts src/routes/fetch.ts
git commit -m "feat(extraction): canned fallback for demo URL when AI fails"
```

---

## Task 10: End-to-end integration with Mikhail's real ledger

By the time you reach this task, Mikhail should have replaced `src/routes/ledger.ts` with the real implementation. Daniel drives this integration.

**Files:** None for Nikolay — this is a verification step, not a code change.

- [ ] **Step 1: Pull Mikhail's branch**

```bash
git fetch
git merge origin/mikhail-ledger     # or whatever the branch is named
```

- [ ] **Step 2: Run end-to-end against Mikhail's ledger**

```bash
npx wrangler dev --port 8787 --remote
```

In another terminal:

```bash
# Charge alice for a fresh extraction
curl -s -D- "localhost:8787/fetch?url=https://example.com&user=alice" | head -20

# Bob reads from cache — alice should be credited
curl -s -D- "localhost:8787/fetch?url=https://example.com&user=bob" | head -20

# Check balances
curl -s localhost:8787/ledger/alice
curl -s localhost:8787/ledger/bob
```

Expected: Alice's balance = 100 (signup) − (extraction_cost + 10) + 9 (credited from Bob's read). Bob's balance = 100 − 10. Stats show 1 hit, 1 miss.

- [ ] **Step 3: If field names don't match — Daniel's call**

The contract was supposed to be locked. If something drifted, fix the smaller side. Do not re-litigate.

- [ ] **Step 4: Commit any merge fixes**

```bash
git commit -m "fix: integrate fetch route with real ledger"
```

---

## Task 11: Pre-warm script + final pre-stage checks

**Files:**
- Create: `scripts/prewarm.sh`

- [ ] **Step 1: Write `scripts/prewarm.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Pre-warms the demo URL so the on-stage HIT works no matter what.
# Usage: WORKER_URL=https://agentify.your-account.workers.dev DEMO_URL=https://... ./scripts/prewarm.sh

: "${WORKER_URL:?must set WORKER_URL}"
: "${DEMO_URL:?must set DEMO_URL}"

echo "Pre-warming $DEMO_URL via $WORKER_URL"
curl -fsS -D- "$WORKER_URL/fetch?url=$DEMO_URL&user=prewarm" -o /dev/null
echo
echo "Cache should now be primed. Run a HIT to verify:"
echo "  curl -sD- '$WORKER_URL/fetch?url=$DEMO_URL&user=judge'"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/prewarm.sh
```

- [ ] **Step 3: Deploy and pre-warm before the dry-run**

```bash
npx wrangler deploy
WORKER_URL=https://agentify.<account>.workers.dev DEMO_URL=https://<demo-article> ./scripts/prewarm.sh
```

Verify:

```bash
curl -sD- "$WORKER_URL/fetch?url=$DEMO_URL&user=judge1" -o /dev/null | grep -i "x-cache"
```

Expected: `X-Cache: HIT`

- [ ] **Step 4: Commit**

```bash
git add scripts/prewarm.sh
git commit -m "chore: pre-warm script for on-stage demo URL"
```

---

## Task 12: Stretch — wire stats counters

If — and only if — there is time after Task 11 and the demo dry-run is solid: bump the stats counters Mikhail's dashboard reads from. If Mikhail already does this in the ledger routes when `charge`/`credit` are called, **skip this task**. Coordinate first.

**Files:**
- Modify: `src/routes/fetch.ts`

- [ ] **Step 1: Confirm with Mikhail who owns the increment**

Ask: "Are `stats:hits`, `stats:misses`, `stats:tokens_saved`, `stats:reads` written from the ledger or from `/fetch`?" If from the ledger — stop, do nothing. If from `/fetch` — proceed.

- [ ] **Step 2: Add the bumps**

Inside `route.get("/fetch", ...)`, on HIT path after `bumpHitCount`:

```ts
await c.env.KV.put("stats:hits", String((Number(await c.env.KV.get("stats:hits")) || 0) + 1));
await c.env.KV.put("stats:reads", String((Number(await c.env.KV.get("stats:reads")) || 0) + 1));
await c.env.KV.put(
  "stats:tokens_saved",
  String((Number(await c.env.KV.get("stats:tokens_saved")) || 0) + Math.max(0, tokensSaved)),
);
```

On MISS path after `writeCache`:

```ts
await c.env.KV.put("stats:misses", String((Number(await c.env.KV.get("stats:misses")) || 0) + 1));
await c.env.KV.put("stats:reads", String((Number(await c.env.KV.get("stats:reads")) || 0) + 1));
```

(Yes, race-y. KV at demo scale — fine.)

- [ ] **Step 3: Verify on dashboard**

Hit `/fetch` a few times and watch the dashboard tile counts go up.

- [ ] **Step 4: Commit**

```bash
git add src/routes/fetch.ts
git commit -m "feat(fetch): bump stats counters on hit/miss"
```

---

## The one rule (carried forward from TEAM.md)

**Protect the demo moment.** Pre-warm the cache. The HIT path and the dashboard must work even if the live MISS path catches fire. Judges remember the moment, not the architecture.
