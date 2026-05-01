# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Aicorn** — shared, credit-metered cache for agent-friendly web content on Cloudflare. An agent fetches a URL through a Worker that returns clean markdown (extracted by Workers AI on first miss, served from KV on every subsequent hit). A separate ledger Worker meters charges and contributor credits.

The repo name is `aicorn` (renamed from `agentify` — the old GitHub URL still redirects). The brand is "Aicorn"; some files still say "agentify". Don't change the package name to "aicorn" without checking — the npm name is deliberately still `agentify` for the root Worker because the Cloudflare Worker name is `aicorn`.

## Monorepo layout — 4 independent subprojects

```
/                 root   →  aicorn pipeline Worker  (Cloudflare Worker, Hono, KV, Workers AI)
ledger/           →  aicorn-ledger Worker         (Cloudflare Worker, D1, vanilla fetch handler)
plugin/           →  aicorn Claude Code plugin    (skills only, no commands/agents/hooks)
bench/            →  standalone TS benchmark      (tsx + turndown, no SDK, no API spend)
```

Each has its own `package.json` + `tsconfig.json`. **Never run `npm install` from a subdir's parent** — it'll resolve the wrong tree. `cd` into the subproject first.

Plus: `docs/superpowers/plans/` (executable plans, see "Plans" below), `report/` (curated benchmark reports), `assets/` (logo/branding), `scripts/` (`prewarm.sh`, `examples.sh`).

## Per-subproject commands

| Subproject | dev | deploy | test | typecheck |
|---|---|---|---|---|
| **root (aicorn)** | `npm run dev` (port **8787**) | `npm run deploy` | `npm test` (vitest, KV-only) | `npm run typecheck` |
| **ledger/** | `npm run dev` (port **8788**) | `npm run deploy` | — | — |
| **bench/** | — | — | `npm run bench` | `npm run typecheck` |
| **plugin/** | — | — | — | — |

`ledger/` D1 migrations: `npm run migrate:local` / `npm run migrate:remote`.

## Architecture you can't infer from one file

### Two Workers, one Service Binding

PROJECT.md and TEAM.md say "one Worker, one deploy". **Reality: two Workers**, connected by a Cloudflare Service Binding declared in `wrangler.toml`:

```toml
[[services]]
binding = "LEDGER"
service = "aicorn-ledger"
```

The pipeline calls the ledger via `c.env.LEDGER.fetch("https://ledger/ledger/access", ...)` (host is ignored by the runtime; URL must be syntactically valid). See `src/pipeline/lib/ledger-client.ts`. **Local dev requires both Workers running** — `wrangler dev` on port 8787 (root) AND port 8788 (ledger), or use `wrangler dev --remote` against deployed instances.

### Ledger access endpoint replaces the old charge/credit pair

The pipeline used to call `/ledger/charge` + `/ledger/credit` separately. Mikhail's commit `3db0b08` collapsed both into a single `/ledger/access` call that the ledger handles atomically (charge reader + credit contributor + register URL contributor). The legacy charge/credit routes still exist on the ledger Worker for admin use.

### The ledger admin routes are currently UNAUTHENTICATED

`/admin/users/<id>/credit`, `/admin/stats`, etc. on `aicorn-ledger.<account>.workers.dev` accept any caller. This is intentional for the hackathon demo. **Do NOT add auth without coordinating with Mikhail** — but be aware that any URL discovery exposes the full admin surface.

### vitest config is detached from wrangler.toml on purpose

`vitest.config.mts` uses inline miniflare config — it does NOT load `wrangler.toml`. Reason: the production `[ai]` binding triggers a remote-proxy session that requires `CLOUDFLARE_ACCOUNT_ID`, which fails in non-interactive runs. Tests only declare the KV binding inline. **If you add a binding the tests need, add it to `vitest.config.mts` separately, do not point the pool at `wrangler.toml`.**

### Token estimation is `chars / 4` everywhere

`src/pipeline/lib/tokens.ts` and `bench/src/fetch.ts` both use the same heuristic. The X-Tokens-Saved header, the bench cost numbers, the ledger extraction cost — all derive from this. **Same denominator across pipes ⇒ ratios are honest, absolute numbers are within ~10% of a real BPE tokenizer.** Don't replace this without changing all three.

### Extraction model + context budget

`src/pipeline/extraction/extract.ts` uses `@cf/meta/llama-3.2-3b-instruct` (128K context). Input HTML is capped at `MAX_HTML_CHARS = 200_000` (~50K tokens) after stripping `<script>`/`<style>`/`<noscript>`/comments. Output capped at `MAX_OUTPUT_TOKENS = 4096`. `stripPreamble()` removes "Here is the extracted markdown" prefixes the model sometimes leaks despite the system prompt.

### Demo-URL fallback only

The MISS path in `src/pipeline/routes/fetch.ts` only catches `extractMarkdown` throws if the URL matches `c.env.DEMO_URL`. Every other extraction failure (empty extraction, model error, oversized prompt) propagates uncaught and Hono returns 500. The benchmark showed ~7/20 URLs hit this — **a known weakness; don't surprise yourself with bare 500s.**

## Plans (executable specs)

`docs/superpowers/plans/*.md` are step-checkbox plans intended for `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Three exist:

- `2026-05-01-cache-extraction-pipeline.md` — original pipeline build (shipped)
- `2026-05-01-browser-rendering-integration.md` — swap Workers AI for Cloudflare Browser Rendering (deferred; would fix JS-rendered SPAs and W3.org-style CF-blocked origins)
- `2026-05-01-aicorn-benchmark-suite.md` — bench plan (v1 = option B shipped, v2 = SDK-driven deferred)

When asked to "implement the plan at <path>", treat the plan as the source of truth for file paths, commit messages, and task ordering.

## Plugin install + config

The plugin (`plugin/`) is published via the marketplace JSON at the repo root (`.claude-plugin/marketplace.json`):

```
/plugin marketplace add telepenin/aicorn
/plugin install aicorn@aicorn
/aicorn:setup
```

After setup the `aicorn:fetch` skill auto-triggers on fetch-shaped prompts and routes WebFetch through `<worker>/fetch?url=…&user=<configured>`. Per-project config lives in `.claude/aicorn.local.md` (gitignored). `aicorn:fetch` falls back to direct WebFetch on 402 (out of credits) without prompting; see `plugin/skills/fetch/SKILL.md` for the full decision table.

## Benchmarks — `bench/`

`cd bench && npm run bench` produces `bench/results/<ISO>.{json,md}`. Compares three pipes per URL: aicorn (clean markdown via Workers AI), `raw_html` (literal origin bytes), `turndown(html)` (HTML→markdown via the `turndown` library — the realistic baseline). The `bench` user gets a 5000-credit signup grant and runs out after ~5 fresh extractions. To top up via the unauthenticated admin route, see `bench/README.md` § "Topping up the benchmark user".

Curated reports (suitable for sharing) live in `report/` — date-prefixed, with the bench raw data linked from each.

## Common pitfalls

- **Cloudflare account picker.** This developer machine has multiple Cloudflare accounts; `wrangler.toml` pins `account_id` to the correct one. Removing that line will make every wrangler command prompt or fail in non-interactive mode.
- **Subdomain aliases.** `agentify.<account>.workers.dev` still responds (Cloudflare keeps old aliases live after rename) but the canonical deploy is `aicorn.<account>.workers.dev`. Plugin config and bench default URL both use the new name.
- **Stale KV entries.** Some KV cache entries pre-date the ledger access-control rollout and now return `404 url_not_processed` from the access check. The bench's smart-retry handles this by appending `?_aicorn_bust=<ts>` once. New code shouldn't need to think about it.
- **The skill double-encodes.** If a URL with `%XX` escapes is passed through the `aicorn:fetch` skill, it can be percent-encoded twice. Decode-then-encode-once is the right normalization.
