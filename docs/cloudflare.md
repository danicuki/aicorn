# Cloudflare services in this project

Everything runs on Cloudflare. There is no external database, no external queue, no third-party API in the hot path (with one planned exception, see [Browser Rendering](#considered-but-not-yet-integrated)). This doc enumerates what we actually use, sourced from `wrangler.toml`, `src/pipeline/env.ts`, and `ledger/package.json` — not from PROJECT.md, because the implementation diverged.

> **Architecture note vs. PROJECT.md:** PROJECT.md describes "one Worker, one deploy". The shipped architecture is **two Workers** (`aicorn` and `aicorn-ledger`) in the same repo, connected via a Service Binding. The doc below describes what's actually deployed.

## Architecture at a glance

```
   Agent / browser
        │  HTTP
        ▼
┌─────────────────────────────┐         ┌─────────────────────────────┐
│  aicorn  (pipeline Worker)  │         │  aicorn-ledger  (Worker)    │
│  src/pipeline/*             │         │  ledger/*                   │
│                             │         │                             │
│  GET /fetch?url=...         │         │  Charge / credit logic      │
│                             │         │                             │
│  Bindings:                  │         │  Bindings:                  │
│    KV     ─── Workers KV    │         │    DB ──── D1 (SQLite)      │
│    AI     ─── Workers AI    │         │                             │
│    LEDGER ─── Service ───────►        │                             │
│             Binding         │         │                             │
└─────────────────────────────┘         └─────────────────────────────┘
```

Two Workers, one repo, two deploys. The pipeline calls the ledger over a Service Binding (`env.LEDGER.fetch(...)`) — that's an in-Cloudflare RPC, no public HTTP.

## What we use

### 1. Cloudflare Workers (the runtime)

The execution environment for both `aicorn` (pipeline) and `aicorn-ledger`. TypeScript, V8 isolates, Web-platform APIs (`fetch`, `crypto.subtle`, `Headers`, `Request`/`Response`).

- Defined in: `wrangler.toml` (root) and `ledger/wrangler.toml`
- Compatibility date: `2025-04-01`
- Router library: [Hono](https://hono.dev) (`hono ^4.12.16`) — not a Cloudflare product, but the de-facto Workers-native router

### 2. Workers AI

The HTML-to-markdown extraction model on the pipeline's MISS path.

- Binding: `AI` (`Ai` type from `@cloudflare/workers-types`)
- Model: `@cf/meta/llama-3.2-3b-instruct` (`src/pipeline/extraction/extract.ts:42`)
- Called as `env.AI.run(model, { messages, max_tokens })`
- **Local dev requires `wrangler dev --remote`** — the AI binding has no local mock. This is also why `vitest.config.mts` excludes the `[ai]` binding from the test miniflare config (otherwise tests would attempt a remote proxy session and fail).

### 3. Workers KV

The cache for cleaned markdown and the lookup index.

- Binding: `KV` (`KVNamespace` type)
- Namespace: `aicorn-cache` (id `54505753…`, preview_id `e8c42648…` in `wrangler.toml`)
- Keys we own (pipeline lane): `cache:<sha256(url)>` → JSON `CacheEntry`
- Access pattern: `kv.get<T>(key, "json")` and `kv.put(key, JSON.stringify(...))` (`src/pipeline/cache/store.ts`)
- **Eventual consistency** is the trade-off — there's no atomic increment. `bumpHitCount` does a read-then-write and may miscount under concurrent reads. For demo scale, fine.

### 4. D1 (used by the ledger Worker)

Serverless SQLite for ledger state (balances, contributions, stats).

- Used by `aicorn-ledger`, not by `aicorn`
- Migration commands in `ledger/package.json`:
  ```
  wrangler d1 migrations apply agentify-ledger --local
  wrangler d1 migrations apply agentify-ledger --remote
  ```
- The pipeline lane never touches D1 directly — it goes through the ledger's HTTP-shaped API via the service binding

This is a divergence from PROJECT.md, which puts ledger state in KV (`bal:<user>`, `stats:*`). The ledger Worker chose D1 for transactional integrity on charge/credit.

### 5. Service Bindings

How the pipeline talks to the ledger without going over the public internet.

- Binding: `LEDGER` (`Fetcher` type)
- Declared in `wrangler.toml`:
  ```toml
  [[services]]
  binding = "LEDGER"
  service = "aicorn-ledger"
  ```
- Used as `env.LEDGER.fetch(new Request(...))` — same shape as `fetch()`, but routed in-Cloudflare to the ledger Worker
- Implementation: `src/pipeline/lib/ledger-client.ts` (`callAccess` helper)

Service bindings give us in-region, encrypted, no-public-DNS calls between Workers — same effective performance as in-process calls, with the benefit of independent deploy and scaling.

### 6. Workers Vars

Plain-text config injected into `env`.

- `DEMO_URL` — the URL pre-warmed before stage; used by the fallback path in `src/pipeline/extraction/fallback.ts`
- Set in `wrangler.toml [vars]`

(Secrets — set via `wrangler secret put` — would land here too. The browser-rendering plan introduces `CF_API_TOKEN` and `CF_ACCOUNT_ID` as secrets, but those aren't shipped yet.)

### 7. Wrangler (CLI)

Cloudflare's deploy and dev tool. Used for everything outside the source code itself.

- `wrangler dev --port 8787` — local dev (pipeline)
- `wrangler dev --port 8788` — local dev (ledger)
- `wrangler dev --remote` — required for any code path that hits Workers AI
- `wrangler deploy` — production deploy (per Worker)
- `wrangler kv namespace create` — KV namespace provisioning
- `wrangler d1 migrations apply` — D1 schema migrations (ledger only)
- `wrangler secret put` — secrets

Version: `wrangler ^4.87.0` (`package.json`)

## Bindings reference

Sourced from `wrangler.toml` (pipeline). Field names below match what's accessed via `c.env.<NAME>` in the code.

| Binding   | Type          | Backend           | Used in                                  |
|-----------|---------------|-------------------|------------------------------------------|
| `KV`      | `KVNamespace` | Workers KV        | `src/pipeline/cache/store.ts`            |
| `AI`      | `Ai`          | Workers AI        | `src/pipeline/extraction/extract.ts`     |
| `LEDGER`  | `Fetcher`     | Service binding   | `src/pipeline/lib/ledger-client.ts`      |
| `DEMO_URL`| `string`      | Vars (plain text) | `src/pipeline/extraction/fallback.ts`    |

The ledger Worker has its own bindings table (D1 plus whatever Mikhail wires) — not enumerated here.

## Free tier limits

All numbers below are the **Workers Free plan**, account-wide, resetting daily at 00:00 UTC unless noted. Sourced from Cloudflare's pricing and limits pages — verify before relying on them since Cloudflare adjusts these without notice.

### Per-service quotas

| Service | Free quota | Hard limit (any plan) |
|---|---|---|
| **Workers** (requests) | 100,000 / day | — |
| **Workers** (CPU per request) | 10 ms | — |
| **Workers** (subrequests per request) | 50 | 10,000 (Paid) |
| **Workers** (memory per isolate) | 128 MB | 128 MB |
| **Workers** (script size, compressed) | 3 MB | 10 MB (Paid) |
| **Workers** (env vars + secrets) | 64 / Worker | 128 (Paid) |
| **Workers** (open connections) | 6 simultaneous | 6 |
| **Workers AI** | 10,000 Neurons / day | — |
| **KV** reads | 100,000 / day | — |
| **KV** writes | 1,000 / day | — |
| **KV** deletes | 1,000 / day | — |
| **KV** list ops | 1,000 / day | — |
| **KV** stored data | 1 GB | unlimited (Paid) |
| **KV** key size | — | 512 bytes |
| **KV** value size | — | 25 MiB |
| **KV** ops per Worker invocation | — | 1,000 |
| **KV** namespaces per account | — | 1,000 |
| **D1** rows read | 5,000,000 / day | — |
| **D1** rows written | 100,000 / day | — |
| **D1** storage | 5 GB | — |
| **Browser Rendering** browser time | 10 minutes / day | — |
| **Browser Rendering** concurrent browsers | 3 | — |
| **Browser Rendering** new instances | 1 / 20 sec | — |
| **Browser Rendering** Quick Actions | 1 / 10 sec | — |
| **Browser Rendering** browser timeout | 60 sec | — |

### Workers AI cost for our extraction model

Our model is `@cf/meta/llama-3.2-3b-instruct`:

- **Input:** 4,625 Neurons per 1M tokens (≈ 0.0046 Neurons / token)
- **Output:** 30,475 Neurons per 1M tokens (≈ 0.0305 Neurons / token)

What that buys us per day on the free 10,000-Neuron budget, given the current `extract.ts` config (`MAX_HTML_CHARS = 200_000`, `max_tokens = 4096`):

| Scenario | Input tokens | Output tokens | Neurons | Extractions / day |
|---|---|---|---|---|
| Typical article (post-`stripNoise`) | ~7,500 | ~1,500 | ~80 | ~125 |
| Worst case (full 200k char input, full 4k output) | ~50,000 | ~4,096 | ~356 | ~28 |

So the free Workers AI budget gives us **~30 to ~125 extractions per day**, depending on page size. Plenty for the demo. Not enough if we ever pointed real agent traffic at this without paying.

### What's tight for our build

Two limits actually constrain us; the rest are generous.

1. **KV writes: 1,000 / day.** Every MISS writes once (cache entry); every HIT writes once again (`bumpHitCount`). At demo scale fine, but during dev it's easy to chew through this. Mitigations (in order of simplicity):
    - `c.executionCtx.waitUntil(...)` the hit-count write (already suggested in the plan-improvement notes — also reduces HIT latency).
    - Sample the hit-count bump (e.g., only every 10th hit).
    - Move stats counters out of KV entirely — they're already in D1 via the ledger Worker, so don't double-count from the pipeline.

2. **Browser Rendering: 1 Quick Action / 10 sec, 10 min/day total.** This is the binding constraint if/when we cut over from Workers AI to Browser Rendering. The 10-second cadence is what bites during a live demo with multiple judges hitting the URL — pre-warming the demo URL into KV makes every demo request a HIT and bypasses Browser Rendering entirely. (This is exactly why the browser-rendering integration doc says pre-warming becomes non-negotiable.)

### What's comfortably under-quota

- **Workers requests** (100k/day) — a 5-hour hackathon with judges won't get close.
- **Workers subrequests** (50/request) — `/fetch` does ~5 subrequests on MISS (origin fetch, AI call, KV write, ledger call), ~3 on HIT. Plenty of headroom.
- **KV reads** (100k/day) — 100x our likely demo volume.
- **D1 reads/writes** (5M/100k) — dwarfs everything we'll do.
- **KV value size** (25 MiB) — a long-form article in markdown is well under 1 MiB.
- **KV key size** (512 bytes) — `cache:<sha256>` is 70 bytes.
- **Workers memory** (128 MB) — extraction holds at most ~200 KB of HTML in memory.

### Reset and overage behavior

- **Daily quotas reset at 00:00 UTC.** Plan demos accordingly.
- **On overage (Free plan):** Workers AI returns errors. KV writes/reads fail with errors. Browser Rendering Quick Actions get rate-limited. Workers themselves stop accepting requests above 100k/day.
- The Paid Workers plan is $5/month and converts every quota above into pay-as-you-go billing on top of much larger included allowances. Worth knowing during the pitch in case judges ask about scaling.

## Test infrastructure

`@cloudflare/vitest-pool-workers` (`vitest.config.mts`) runs unit tests against Miniflare — Cloudflare's local Worker simulator. Config intentionally declares only the `KV` namespace; the `AI` binding is excluded so tests don't attempt a remote-proxy session that requires `CLOUDFLARE_ACCOUNT_ID`. This is documented inline in `vitest.config.mts:5-7`.

```ts
cloudflareTest({
  miniflare: {
    compatibilityDate: "2025-04-01",
    kvNamespaces: ["KV"],
  },
})
```

## Considered but not yet integrated

### Browser Rendering

There's a full integration plan in `docs/superpowers/plans/2026-05-01-browser-rendering-integration.md` to replace Workers-AI-as-extractor with Cloudflare Browser Rendering's `/markdown` Quick Action:

```
POST https://api.cloudflare.com/client/v4/accounts/<acct>/browser-rendering/markdown
```

This would handle JS-rendered pages, give deterministic output, and remove the LLM-context truncation risk. Trade-off: free-tier rate limits (10 minutes/day, 1 Quick Action / 10 seconds), which makes pre-warming the demo URL non-negotiable.

**Status: planned, not shipped.** Extraction still uses Llama 3.2 3b on Workers AI as of `extract.ts`.

## Explicitly not used

Listed for completeness, with the trade-off we accepted by skipping each.

| Service               | Why we skip it                                                                |
|-----------------------|-------------------------------------------------------------------------------|
| Durable Objects       | KV is enough at demo scale; no need for atomic counters or coordination       |
| R2                    | Markdown bodies fit comfortably in KV; no large-blob storage needed           |
| Cache API (`caches.default`) | Adds another layer between Worker and KV; KV alone is the cache here   |
| Queues                | All work is request-scoped; no async/background pipeline                      |
| Pages                 | The dashboard is served from the same Worker (`/dashboard` route), not Pages |
| Images / Stream       | Not handling media                                                            |
| Analytics Engine      | Stats counters live in the ledger (D1), not in Analytics Engine                |
| Email Workers         | Not relevant                                                                  |

## Operational notes

Things we've already hit or that the plan calls out:

1. **Workers AI requires `--remote`**. There is no local AI mock. Tests must mock `env.AI.run` themselves; the Vitest config excludes the `[ai]` binding for that reason.
2. **KV is eventually consistent.** No atomic increment. Read-then-write hit counts may miscount under concurrent reads. For demo scale, this is fine; for production, use Durable Objects.
3. **Service-binding RPCs are HTTP-shaped but not HTTP.** No public DNS, no TLS handshake, no rate limit. Latency is low. Good for fan-out from pipeline → ledger.
4. **D1 migrations need both `--local` and `--remote`.** Apply local before testing with `wrangler dev`; apply remote before `wrangler deploy`.
5. **`wrangler.toml` has the account ID checked in.** That's an identifier, not a secret. Secrets must use `wrangler secret put`.

## References

- `wrangler.toml` — pipeline Worker config (bindings, vars, services)
- `ledger/wrangler.toml` — ledger Worker config (D1 binding)
- `src/pipeline/env.ts` — `Env` type, single source of truth for binding shapes
- `vitest.config.mts` — Miniflare test config
- `docs/superpowers/plans/2026-05-01-cache-extraction-pipeline.md` — pipeline implementation plan
- `docs/superpowers/plans/2026-05-01-browser-rendering-integration.md` — planned Browser Rendering migration
- Cloudflare docs: <https://developers.cloudflare.com/workers/>
- Pricing & limits sources for the [Free tier limits](#free-tier-limits) section:
  - <https://developers.cloudflare.com/workers/platform/pricing/>
  - <https://developers.cloudflare.com/workers/platform/limits/>
  - <https://developers.cloudflare.com/workers-ai/platform/pricing/>
  - <https://developers.cloudflare.com/kv/platform/pricing/>
  - <https://developers.cloudflare.com/kv/platform/limits/>
  - <https://developers.cloudflare.com/d1/platform/pricing/>
  - <https://developers.cloudflare.com/browser-rendering/platform/limits/>
