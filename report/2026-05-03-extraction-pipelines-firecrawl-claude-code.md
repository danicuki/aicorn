# How Firecrawl and Claude Code Convert URLs to Markdown

- **Date:** 2026-05-03
- **Context:** Research note for Aicorn's extraction pipeline. Companion to `docs/superpowers/plans/2026-05-01-browser-rendering-integration.md`.
- **Sources:** Firecrawl OSS repo (`firecrawl/firecrawl`, `main`), leaked Claude Code mirror (`tanbiralam/claude-code`).

---

## TL;DR

Two reference implementations of "URL → clean markdown for an LLM," neither of which uses an LLM for the markdown step:

| | Firecrawl (default cloud) | Firecrawl (bare self-host) | Claude Code WebFetch |
|---|---|---|---|
| Where the HTTP fetch runs | Fire-engine microservice (Cloudflare-side) | Server process (`undici.fetch`) | **User's local CLI process** (`axios.get`) |
| JS rendering | Yes — fire-engine Chrome-CDP, by default | No — `fetch` engine only | No |
| HTML→markdown | Turndown (JS) / Go FFI / HTTP service | Same | Turndown (JS), in-process |
| Boilerplate strip | Selector-based (Cheerio/Rust) | Same | None |
| LLM in the markdown path | No | No | No (Haiku is a *post-process* on already-extracted markdown, optional) |
| SPA behavior | Renders correctly (Chrome-CDP outranks fetch) | **Returns junk** (no fallback) | **Returns junk** (no fallback) |

Both production extraction stacks treat HTML→markdown as a deterministic, LLM-free problem. The LLM appears only at the edges — Firecrawl uses it for `json`/`extract` formats, Claude Code uses Haiku to apply the user's prompt to the already-extracted markdown.

Aicorn currently runs Llama 3.2 3B *as the converter*. This is the unusual choice in the field, not the standard one.

---

## 1. Firecrawl

### Pipeline shape

`scrapeURL` (`apps/api/src/scraper/scrapeURL/index.ts`) orchestrates a fixed sequence:

1. **Build engine candidate list** ranked by feature-flag support score, then by hardcoded `quality`.
2. **Race engines** with a per-engine timeout; the first engine returning HTML/markdown of acceptable status wins.
3. **Run transformers in order** (`transformers/index.ts`): `deriveHTMLFromRawHTML` → `deriveMarkdownFromHTML` → `performCleanContent` → derive links/images/metadata → … → `performLLMExtract` (only if requested) → `performSummary` → `removeBase64Images`.

The LLM extractor is a *transformer*, not the conversion path. Plain markdown output skips it entirely.

### Engine ranking — the key detail

`engineOptions` in `engines/index.ts` assigns a `quality` to each engine:

| Engine | Quality |
|---|---|
| `index` (cache hit) | 1000 |
| `fire-engine;chrome-cdp` (real Chrome) | 50 |
| `fire-engine(retry);chrome-cdp` | 45 |
| `playwright` | 20 |
| `fire-engine;tlsclient` | 10 |
| `fetch` (raw HTTP, undici) | 5 |

For a plain `POST /v1/scrape` with `{url, formats: ["markdown"]}`, `buildFeatureFlags()` returns an empty set. With no flags, every engine has `supportScore = 0`, so the candidate list is ordered purely by `quality`. Whichever JS-capable engine the operator has wired up wins by default.

**Cloud Firecrawl (`api.firecrawl.dev`)**: `FIRE_ENGINE_BETA_URL` is set, so `fire-engine;chrome-cdp` is in the pool with quality 50, and runs first. SPAs render correctly without the user opting in.

**Bare self-host** (no `FIRE_ENGINE_BETA_URL`, no `PLAYWRIGHT_MICROSERVICE_URL`): only `fetch` (quality 5) is available for HTML. There is **no content-length / "did markdown come back too short" fallback** — the waterfall (`scrapeURL/index.ts:711-910`) advances only on `WaterfallNextEngineSignal` (timeout) or thrown `EngineError`. A 200 response containing `<div id="root"></div>` is "success." Turndown produces empty markdown, the pipeline returns it.

So Firecrawl's SPA story is "the operator's job to wire up a JS-capable engine." Once one is wired, it runs by default. There is no per-request sniffing.

### HTML → markdown

`apps/api/src/lib/html-to-markdown.ts`, `parseMarkdown()` — three-tier fallback:

1. POST to `HTML_TO_MARKDOWN_SERVICE_URL` if configured.
2. Native Go converter via `koffi` FFI if `USE_GO_MARKDOWN_PARSER` is enabled.
3. **Turndown + `joplin-turndown-plugin-gfm`** with a custom `inlineLink` rule. This is what runs in most deploys.

Then a Rust crate (`@mendable/firecrawl-rs`) does `postProcessMarkdown()`, plus two regex helpers (`processMultiLineLinks`, `removeSkipToContentLinks`) close common Turndown rough edges.

### Boilerplate removal

`scraper/scrapeURL/lib/removeUnwantedElements.ts` runs *before* Turndown. Selector-based, not Readability:

- Always strip: `script, style, noscript, meta, head`.
- When `onlyMainContent: true` (the default), also strip: `header, footer, nav, .sidebar, .ad, .ads, .cookie, .share, .widget, .modal, .breadcrumbs, .social, .lang-selector, …`.
- Whitelist preserves specific classes (e.g. event-agenda widgets) inside otherwise-removed regions.

Implementation uses Cheerio-equivalent traversal in Rust; the JS fallback is plain Cheerio.

### LLM extraction is a separate path

`transformers/llmExtract.ts`. Only fires when the request specifies `json` or `extract` format. Operates on the already-produced markdown, not on raw HTML.

---

## 2. Claude Code WebFetch

Source: `tanbiralam/claude-code`, `src/tools/WebFetchTool/`.

### What happens when the model calls WebFetch

1. **Blocklist preflight → Anthropic.** `axios.get('https://api.anthropic.com/api/web/domain_info?domain=<host>')`. Sends only the hostname.
2. **Page fetch → origin, direct.** `axios.get(url, { signal, timeout: FETCH_TIMEOUT_MS, maxRedirects: 0, responseType: 'arraybuffer', maxContentLength: MAX_HTTP_CONTENT_LENGTH, headers: { Accept: 'text/markdown, text/html, */*', 'User-Agent': getWebFetchUserAgent() } })`. **From the user's local Node process, not Anthropic's servers.** No `x-api-key`, no `Authorization`. Redirects handled in a manual loop so the tool can surface "redirected to a different host" warnings to the model.
3. **HTML → markdown, local.** Turndown lazy-loaded from npm:
   ```js
   if (contentType.includes('text/html')) {
     markdownContent = (await getTurndownService()).turndown(htmlContent)
   }
   ```
   No Readability. No selector strip. Raw response bytes straight into Turndown.
4. **Apply user prompt to markdown → Anthropic Haiku.** `queryHaiku()` POSTs to `/v1/messages` with the markdown plus the user's prompt and returns the trimmed answer to the model. **Short-circuited** when: origin is on the preapproved list AND `Content-Type: text/markdown` AND under `MAX_MARKDOWN_LENGTH` — in that case raw markdown is returned, no Haiku.

### Implications

- **Anthropic never sees the page bytes.** Only the hostname (preflight) and the post-Turndown markdown (Haiku call, only if the short-circuit doesn't fire).
- **No headless browser, anywhere.** A React SPA returns `<div id="root"></div>`, Turndown produces empty markdown, Haiku gets handed nothing useful, the model gets a junk summary. No SPA detection, no escalation path, no fallback.
- **No boilerplate strip.** Whatever the origin returns goes straight into Turndown — full nav/footer/sidebar noise. Haiku's prompt-application step is the de facto cleaner; that's why Anthropic added it.

The Haiku-skip preapproval list is a small but telling optimization: for a curated set of origins that already return clean text, Anthropic skips the second model call entirely. It's an admission that the Turndown output is good enough most of the time when the input is clean.

---

## 3. What this tells us about Aicorn

### Aicorn's current pipeline is the outlier

`pipeline/src/extraction/extract.ts` does:

```
fetch(url) → strip <script>/<style>/<noscript>/<!----> via regex
           → truncate to 200K chars
           → Llama 3.2 3B with an HTML→markdown system prompt
           → strip "Here is..." preamble
```

This is an LLM-first conversion. Both reference implementations above are LLM-free conversions. The LLM-first choice has three documented weaknesses (from `browser-rendering-integration.md` and CLAUDE.md):

1. Non-deterministic — same URL produces different markdown across runs.
2. 4096-token output cap truncates long articles.
3. No SPA support — `fetch(url)` returns empty shells.

Firecrawl avoids (1) and (2) by using Turndown. Claude Code avoids (1) and (2) by using Turndown. Neither solves (3) without an external service.

### The SPA gap — same in all three

| | Static HTML | SPA |
|---|---|---|
| Aicorn (current) | Works (Llama extracts) | Fails (empty shell goes to Llama) |
| Firecrawl (cloud) | Works | **Works** (fire-engine renders) |
| Firecrawl (bare self-host) | Works | Fails (no JS engine in pool) |
| Claude Code WebFetch | Works (Turndown) | Fails (no JS engine at all) |

Cloud Firecrawl is the only one that handles SPAs by default. It does so by always running a real headless Chrome via fire-engine. The Aicorn analog is Cloudflare Browser Rendering's `/markdown` Quick Action — already specced in `browser-rendering-integration.md`.

### What Aicorn could borrow

1. **Drop the LLM from the conversion path.** Replace Llama with `cheerio`-based selector strip (port Firecrawl's `removeUnwantedElements` list) plus `turndown` + `joplin-turndown-plugin-gfm`. Both libraries run in Workers. Deterministic, no token cap, free, fast.
2. **Lane-by-default, not lane-by-flag.** Firecrawl's lesson: don't sniff per-URL, don't ask the caller. Wire up a JS-capable engine and let it run for everything. For Aicorn that means: always call Browser Rendering `/markdown`. Use raw `fetch` only as a configured-off fallback.
   - Counter-argument specific to Aicorn: Browser Rendering has a 1-Quick-Action-per-10s rate limit and 10-min/day free-tier quota. Always-call would burn the quota in dev. A cheap static-first sniff (try `fetch`, fall back to BR if stripped body has <500 chars of real text) is ~10 lines and saves the quota for cases that actually need it. Firecrawl doesn't do this only because their fire-engine quota is much larger.
3. **Reserve the LLM for what LLMs are good at.** Firecrawl reserves it for structured extraction (`json`/`extract` formats). Claude Code reserves it for prompt-application (Haiku summarizing markdown against the user's question). Aicorn could expose either as an opt-in `?format=json&schema=…` parameter — but the *default* markdown path should be deterministic.

### What this means for the network thesis

Aicorn's moat is the shared cache, not the extractor. A deterministic extractor strengthens the moat in two ways:
- **Cache value goes up.** Two agents that fetch the same URL through different paths today can get different markdown (Llama is non-deterministic). Cached entries become more authoritative when conversion is reproducible.
- **Trust failures go down.** Llama can return empty/truncated/hallucinated output and propagate as a bare 500 on non-demo URLs (CLAUDE.md flags this). A Cheerio+Turndown path either succeeds or surfaces a typed error from the fetch step — no silent corruption.

The plan to swap to Browser Rendering already addresses the SPA weakness. Adding a Cheerio+Turndown stage either *before* Browser Rendering (static fast path) or *after* it (process BR's HTML output locally if you want more control than `/markdown` Quick Action gives you) gets the determinism win for free.

---

## 4. Recommended next step

`browser-rendering-integration.md` proposes one swap: Llama → Browser Rendering `/markdown` Quick Action. That fixes SPA support and determinism in one move, but locks in Browser Rendering's rate limit and quota.

A cheaper alternative — and a closer match to how the field actually does this — is the **Firecrawl-faithful two-lane**:

```
fetch(url) → Cheerio strip (Firecrawl's selector list) → Turndown
          ↓ if stripped body < N chars of real text
Browser Rendering /markdown  (slow lane, costs a Quick Action)
```

Tradeoff:

- **Pro:** Most pages stay free and fast; quota covers only SPAs. No external HTTP hop on the hot path. Determinism for both lanes. Same Browser Rendering plumbing as the original plan, just gated by a sniff.
- **Con:** ~50 more lines of code than the plan's proposal (Cheerio dep, selector list, sniff threshold). Two failure surfaces instead of one.

Either way, the Llama call goes away. Both reference implementations agree on that.

---

## Source files referenced

**Firecrawl** (`firecrawl/firecrawl`, `main` branch):
- `apps/api/src/scraper/scrapeURL/index.ts` — orchestrator, `buildFeatureFlags`, waterfall loop
- `apps/api/src/scraper/scrapeURL/engines/index.ts` — engine pool, quality table, `buildFallbackList`
- `apps/api/src/scraper/scrapeURL/engines/fetch/index.ts` — undici fast path
- `apps/api/src/scraper/scrapeURL/engines/playwright/index.ts` — Playwright microservice client
- `apps/api/src/scraper/scrapeURL/transformers/index.ts` — transformer order
- `apps/api/src/scraper/scrapeURL/transformers/llmExtract.ts` — LLM mode (separate path)
- `apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts` — selector-based boilerplate strip
- `apps/api/src/lib/html-to-markdown.ts` — Turndown / Go FFI / HTTP service tiers

**Claude Code** (`tanbiralam/claude-code`):
- `src/tools/WebFetchTool/WebFetchTool.ts` — tool definition, permissions
- `src/tools/WebFetchTool/utils.ts` — `getURLMarkdownContent`, `applyPromptToMarkdown`, axios call, Turndown wiring
- `src/tools/WebFetchTool/prompt.ts` — `WEB_FETCH_TOOL_NAME`, `DESCRIPTION`, `makeSecondaryModelPrompt`
- `src/tools/WebFetchTool/preapproved.ts` — preapproved-host list (Haiku-skip path)
- `src/services/api/claude.js` — `queryHaiku`

**Aicorn** (this repo):
- `pipeline/src/extraction/extract.ts` — current Llama-based extractor
- `pipeline/src/routes/fetch.ts` — fetch route, MISS path
- `docs/superpowers/plans/2026-05-01-browser-rendering-integration.md` — Browser Rendering swap plan
