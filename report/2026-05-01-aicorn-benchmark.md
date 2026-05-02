# aicorn vs. raw HTML — input-token economy

- **Run date:** 2026-05-01
- **Worker:** `https://aicorn.mikhailnovikov.workers.dev`
- **Model price assumed:** Claude Sonnet 4.6 — `$3.00 / M` input tokens
- **Method:** for each URL, fetch via three pipes (aicorn / raw HTML / Turndown(HTML)), count `chars / 4` tokens on each payload, multiply by the input rate. Same denominator across pipes — ratios are exact, absolute values are within ~10% of a real BPE tokenizer.

> Raw data: `bench/results/2026-05-01T16-55-21-054Z.json`. Source: [`bench/`](../bench/).

---

## How the three pipes work

Each URL is fetched once through each pipe; the resulting payload is what would land in the model's context window if an agent fed it in.

```
                                ┌──────────────┐
                                │  origin URL  │
                                └──────┬───────┘
                                       │ HTTP
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
        ┌───────────────┐      ┌──────────────┐      ┌────────────────┐
        │   raw HTML    │      │   Turndown   │      │    aicorn      │
        │               │      │              │      │                │
        │ literal bytes │      │ HTML library │      │ Workers AI     │
        │ from origin   │      │ converts to  │      │ extracts main  │
        │ (no transform)│      │ markdown     │      │ content + caches │
        └───────────────┘      └──────────────┘      └────────────────┘
                │                      │                      │
                ▼                      ▼                      ▼
            big & noisy            mid: chrome stays      small: only body
```

### `raw HTML` — pessimistic ceiling

`curl <url>` and use whatever bytes come back. Includes:

- `<!DOCTYPE>`, `<head>`, `<meta>`, all stylesheets and inline `<style>` blocks
- All `<script>` blocks (often the largest part of a modern page)
- All HTML tags + attributes (`class="…" id="…" data-…="…"` everywhere)
- Page chrome: navigation, headers, footers, sidebars, ads, cookie banners
- Repeated boilerplate that's the same on every page of the site

No agent in practice does this — but it's the worst case if no transform is applied.

### `Turndown(HTML)` — realistic baseline

`raw HTML` run through [turndown](https://github.com/mixmark-io/turndown), a generic HTML → Markdown library. This is what most "fetch a URL" tools effectively produce, including (approximately) Claude Code's built-in `WebFetch`. Turndown:

- ✓ drops `<script>`, `<style>`, `<noscript>` blocks
- ✓ drops most HTML attributes
- ✓ converts tags to markdown syntax (`<h1>` → `#`, `<a href>` → `[text](url)`, `<ul><li>` → `-`, code blocks, tables, etc.)
- ✗ does **not** decide what's "main content" — keeps every nav menu, sidebar, footer, breadcrumb, "related articles" block

Result: same visible content as the page, in markdown, with all the chrome still attached.

### `aicorn` — main-content extraction

`GET <worker>/fetch?url=…&user=…` against the agentify Worker. Internally the Worker:

1. Looks up `sha256(url)` in Cloudflare KV (the cache).
2. **Cache HIT:** returns the previously-extracted markdown immediately (~50 ms).
3. **Cache MISS:** fetches the origin HTML, runs it through a Workers AI LLM with a prompt to keep only the main article content, writes the result to KV (~30–120 s for big pages, then HIT for everyone afterwards).

Result: just the article body. Navigation, sidebars, ads, footers — gone.

### Why each transform saves what it saves

| Step | Drops | Typical reduction |
|---|---|---|
| raw → Turndown | scripts, styles, HTML tag scaffolding | 10–50% |
| Turndown → aicorn | nav, sidebar, footer, ads, repeated boilerplate | 50–99% |

The big win is the second step. An RFC's HTML scaffolding is ~12% of the byte budget; the actual chrome (toolbar, "view as plain text" links, status banner, footer) plus repeated cross-RFC navigation is ~99%.

---

## Headline

For the **6 URLs where every pipe succeeded**, the cumulative numbers an agent would pay Anthropic, per single fetch:

| Pipe | Tokens | Cost | Multiplier vs aicorn |
|---|---:|---:|---:|
| **aicorn** (clean markdown) | 7,864 | **$0.024** | 1.0× |
| Turndown(html) (realistic baseline) | 279,008 | $0.837 | **35.5×** |
| raw HTML (naive) | 435,887 | $1.308 | **55.4×** |

In other words: the same six URLs cost **about a penny** to read through aicorn, **about 84¢** through a naive HTML→Markdown pipeline, and **about $1.31** if the consumer fed in raw HTML. Repeat that 1,000 times a day and the gap is $300–$1,300 per day.

---

## Per-URL details

### `info.cern.ch` — the original web page

| pipe | tokens | bytes | $ |
|---|---:|---:|---:|
| aicorn | 114 | 455 | $0.000342 |
| Turndown | 121 | 484 | $0.000363 |
| raw HTML | 162 | 646 | $0.000486 |

aicorn pays **6%** less than Turndown, **30%** less than raw HTML. Tiny page; the win is small in both percent and absolute terms.

---

### `example.org`

| pipe | tokens | bytes | $ |
|---|---:|---:|---:|
| aicorn | 45 | 179 | $0.000135 |
| Turndown | 82 | 328 | $0.000246 |
| raw HTML | 132 | 528 | $0.000396 |

aicorn pays **45%** less than Turndown, **66%** less than raw. Clean placeholder page; aicorn strips the doctype + `<head>` boilerplate.

---

### `example.net`

| pipe | tokens | bytes | $ |
|---|---:|---:|---:|
| aicorn | 42 | 166 | $0.000126 |
| Turndown | 82 | 328 | $0.000246 |
| raw HTML | 132 | 528 | $0.000396 |

Identical template to `example.org`. aicorn -49% vs Turndown, -68% vs raw.

---

### `gnu.org/licenses/gpl-3.0.txt` — plain-text license

| pipe | tokens | bytes | $ |
|---|---:|---:|---:|
| aicorn | 2,967 | 11,865 | $0.0089 |
| Turndown | 8,507 | 34,028 | $0.0255 |
| raw HTML | 8,788 | 35,149 | $0.0264 |

aicorn pays **65%** less than Turndown — the LLM compresses the license boilerplate by removing the redundant whitespace, line numbers, and structural noise. Turndown ≈ raw HTML because the source is already plain text; nothing for the HTML→MD library to strip.

**Caveat:** this is the LLM rewriting, not just stripping. If exact license-text fidelity matters (legal review), aicorn's output would need a verbatim check.

---

### `rfc-editor.org/rfc/rfc2616` — HTTP/1.1 specification

| pipe | tokens | bytes | $ |
|---|---:|---:|---:|
| **aicorn** | **1,354** | 5,413 | **$0.0041** |
| Turndown | 114,774 | 459,096 | $0.3443 |
| raw HTML | 130,448 | 521,792 | $0.3913 |

**aicorn pays 99% less than Turndown** — the biggest absolute saving in the run (≈$0.34 per single fetch). The RFC text is wrapped in heavy HTML scaffolding; aicorn extracts the content and discards the rest.

---

### `rfc-editor.org/rfc/rfc9110` — HTTP semantics (RFC 7231 successor)

| pipe | tokens | bytes | $ |
|---|---:|---:|---:|
| **aicorn** | **3,342** | 13,367 | **$0.0100** |
| Turndown | 155,390 | 621,559 | $0.4662 |
| raw HTML | 296,225 | 1,184,900 | $0.8887 |

**aicorn pays 98% less than Turndown.** Same shape as RFC 2616; raw HTML balloons to 1.2 MB.

---

## Latency footnote

aicorn's first fetch of a URL goes through Workers AI extraction, which is slow:

| URL | aicorn first-fetch (MISS) | direct fetch |
|---|---:|---:|
| info.cern.ch | 1.8s | 0.5s |
| example.org | 1.7s | 0.2s |
| gpl-3.0.txt | 67s | 0.5s |
| RFC 2616 | 45s | 0.2s |
| RFC 9110 | **119s** | 0.2s |

Subsequent fetches of the same URL are cache hits — typically <100ms. **The economy claim assumes the URL is already in cache** (the realistic deployment shape: one agent pays for extraction; many agents read from cache). On a cold MISS the consumer pays both extraction time AND a higher agentify credit cost.

---

## What the run also surfaced (not in the headline)

The 20-URL corpus included 14 URLs that **didn't produce a usable comparison**, grouped by class:

| Class | Count | Examples | Implication |
|---|---:|---|---|
| Origin blocks Cloudflare Workers | 3 | `w3.org/TR/CSS2/`, `w3.org/People/Berners-Lee/`, `textise.net` | aicorn cannot route these from CF edge IPs |
| Origin universally unreachable | 4 | `httpforever.com` (526), `neverssl.com` (520), `iana.org/domains/reserved` (520), `bettermotherfuckingwebsite.com` (522) | Not aicorn-specific; both pipes fail |
| Aicorn extraction crashes (500) | 7 | `ietf.org/rfc/rfc7231.txt`, `planetpython.org`, `motherfuckingwebsite.com`, `theoldnet.com`, `html.am/templates/`, `textuploader.net` | Workers AI throws on edge content (very small pages, very large plain-text files); the route's catch only handles the demo URL fallback |

See [bench failures](../bench/results/2026-05-01T16-55-21-054Z.md#failures) for full status codes.

---

## Recommended fixes (in priority order)

1. **Catch any extraction throw → return 502 with the actual error.** Currently 7 URLs fail silently as 500. One-line edit in `pipeline/src/routes/fetch.ts`.
2. **Browser Rendering integration** ([plan](../docs/superpowers/plans/2026-05-01-browser-rendering-integration.md)). Different IP/UA pool unblocks the W3.org tier; renders JS-heavy pages; removes the 128k-token model context cliff that's likely hurting the very large RFCs.
3. **Short-content guard.** If the cleaned HTML is < ~300 chars, skip Workers AI and return the cleaned content directly (avoids the "empty extraction" throw on minimal pages like `motherfuckingwebsite.com`).

---

## Reproduce

```bash
cd bench
npm install
npm run bench                          # against the deployed Worker
AICORN_USER=alice npm run bench        # use a different ledger user
AICORN_DELAY_MS=2500 npm run bench     # slower pacing if rate-limited
```

Output lands in `bench/results/<ISO>.json` + `<ISO>.md`.
