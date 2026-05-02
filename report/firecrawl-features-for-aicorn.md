# Firecrawl Features That Would Strengthen Aicorn

## Framing first

Aicorn's moat is the **shared cache + credit ledger** — the network economics. Firecrawl is a feature-rich extraction service with no shared layer. Most of Firecrawl's surface area (Search, Interact, multi-format output, crawling) is orthogonal to Aicorn's thesis. Adopting them indiscriminately turns Aicorn into a worse Firecrawl.

The right question is narrower: **which Firecrawl design choices increase the value of the shared cache?** A feature increases cache value if it (a) raises the success rate of extraction, (b) raises the *re-readability* of cached entries by future agents, or (c) lets contributors trust the network not to lose their work.

By that filter, most Firecrawl features fail. A few are critical.

---

## What the benchmark actually tells us

The 30% success rate isn't a feature gap. Looking at the failure modes:

| Failure | Root cause | Firecrawl feature that fixes it? |
|---|---|---|
| `w3.org/TR/*` → 502 (origin 403) | W3.org blocks Cloudflare IPs | None — origin-side issue |
| `httpforever.com`, `neverssl.com` → 502 | Origin unreachable from Workers | None — network issue |
| `ietf.org/rfc7231.txt` → 500 | Extraction code bug on text/* content | Engineering, not Firecrawl |
| `planetpython.org` → 500 | Probably oversized or mis-shaped HTML | Engineering, not Firecrawl |
| `motherfuckingwebsite.com` → 500 | Trivial HTML, model returned empty | Code bug — `MAX_HTML_CHARS` not the issue here |

**Of 14 failures, ~12 are bugs or origin-blocking. Only 2 plausibly need a Firecrawl-style feature** (specifically, JS-rendering for sites that need it — which Aicorn's existing browser-rendering plan already addresses).

So "adopt Firecrawl features to fix the benchmark" was the wrong frame in v1. The benchmark needs **engineering**, not features. Firecrawl features should be evaluated against the cache thesis, not the failure list.

---

## What Aicorn should adopt

### 1. Per-request freshness control (the most underrated borrow)

Firecrawl lets the caller choose `fresh` vs `cached` per request. Aicorn currently has one policy: cache lives forever (hackathon scope). PROJECT.md flags this as the deferred problem ("when does the cache invalidate?").

**Why it matters for the cache thesis:** the network is only valuable if reads are *trustworthy*. Right now an agent reading a year-old cached entry gets stale data and has no signal. Firecrawl's per-request override is the minimal solution that doesn't require site-owner integration (Product A) — agents who care about freshness can opt out, agents who don't can stay on the fast path.

**Concrete shape for Aicorn:**
- Add `?max_age=<seconds>` to `/fetch`. If the cache entry is older than `max_age`, treat as MISS (re-extract; original contributor still earns on this re-extract path? — open design question).
- Add `?force_refresh=1` (equivalent to the existing `?_aicorn_bust=` workaround, but documented and supported).
- Default behavior unchanged (infinite TTL) so the demo still hits the 95% savings number.

This is the highest-leverage Firecrawl borrow because it directly addresses the freshness gap that PROJECT.md already identifies as the network's biggest weakness, and it does so without requiring the Product A site-owner channel to ship first.

### 2. Reliability as a discipline (Firecrawl's quiet superpower)

Not a feature per se, but the design stance behind every Firecrawl call: **return something useful, or a typed error, never a 500.** Aicorn currently propagates extraction errors as bare 500s on non-demo URLs (CLAUDE.md confirms: "every other extraction failure propagates uncaught"). For a network where contributors stake credits on extractions, a 500 means *the contributor paid extraction cost and the cache has nothing*. That's a trust failure, not a UX failure.

**What to borrow:**
- A fallback chain on the MISS path: LLM extraction → readability heuristic → raw text excerpt.
- Cache the partial result with a header indicating extraction quality (`X-Extraction-Level: full | readability | excerpt`).
- A typed error envelope when *nothing* works, so the agent can decide whether to retry or skip — not a 500.
- The contributor still gets credit when a partial result is cached, since something landed in the cache.

This is the engineering work the benchmark actually needs. It's "Firecrawl-shaped" in that Firecrawl never returns nothing, but the value isn't in copying their feature list — it's in adopting their reliability stance.

### 3. JS rendering via Cloudflare Browser Rendering

Already in Aicorn's roadmap (`docs/superpowers/plans/2026-05-01-browser-rendering-integration.md`). Worth keeping in this list because it's the one feature where Firecrawl has structural parity that Aicorn lacks — modern web is SPA-heavy, and Workers AI on raw HTML returns nothing useful for those.

The interesting design choice: not *whether* to add it, but *whether to charge contributors a higher extraction cost for JS-rendered URLs*. Browser Rendering is more expensive than Workers AI; if extraction cost is uniform, JS-rendered URLs subsidize plain-HTML URLs. The credit ledger should probably reflect the actual cost.

---

## What Aicorn should NOT adopt

These were on the v1 list. On reflection they don't fit.

### Search

Orthogonal. Agents already have search APIs. Aicorn's job starts after a URL is known.

### Interact (form filling, clicks)

Actively undermines the cache model. Form-gated content is per-session, time-sensitive, often per-user — it's the wrong shape for a shared cache. Cached "search results for X" or "filtered list" entries are stale within minutes and risk leaking data across users. **Hard skip.**

### URL crawling

Breaks the contributor model. The current design has clean economics: one fetcher pays, becomes contributor, earns on subsequent reads. For auto-crawled URLs, "the system" is the contributor — but then who paid the extraction cost? You either (a) charge the triggering user for all crawled URLs, which is unbounded and unfair, or (b) the system eats the cost, which makes spam-crawling free and corrodes the 1-credit margin that defeats abuse. There's no clean answer at hackathon scope. Defer until the economic model has a story for it.

### Multiple output formats (JSON, screenshot)

Complexity multiplier with no obvious cache leverage. If the cache stores three formats per URL, KV usage triples and read cost gets fuzzy (does a screenshot read cost the same as a markdown read?). Markdown-only is the right level of abstraction for the hackathon — agents that need JSON can prompt for it once on top of the markdown, cheaply.

### Structured JSON extraction (schema-driven)

I had this as "high priority" in v1. On reflection it's premature. Reasons:
- The cache key is the URL. If two agents request the same URL with different schemas, do they share a cache entry? If yes, the schema is ignored (then why have it). If no, the cache fragments per-schema and the shared-cache thesis weakens.
- The agent-side cost of "take this markdown, extract these fields" is small with modern LLMs. Pre-extracting at cache time saves tokens but costs flexibility.
- The work is real (schema registry, schema-aware extraction prompts, schema-aware cache keys). Hackathon-stage Aicorn doesn't need it.

Revisit when there's a clear use case where pre-structured data unlocks something markdown can't. Today, markdown is enough.

### Document parsing (PDF/DOCX)

Different domain. PDFs aren't HTML; the extraction pipeline is unrelated to Workers AI's strengths. Worth doing eventually, but it's a separate product line, not a Firecrawl-feature borrow.

---

## Revised priority

| Borrow | Why it strengthens the cache | Status in current design |
|---|---|---|
| **Per-request freshness control** (`max_age`, `force_refresh`) | Solves the trust gap that PROJECT.md flags as the network's biggest weakness; ships without Product A | Not started |
| **Reliability stance** (fallback chain + typed errors, never bare 500) | Contributors trust the network only if their extractions land *something* | Partial: demo URL has fallback, others don't |
| **JS rendering via Browser Rendering** | Expands cacheable surface to modern web | Planned |

| Skip | Why |
|---|---|
| Search | Orthogonal to extraction-caching |
| Interact | Wrong shape for a shared cache |
| Crawling | Breaks contributor economics |
| Multi-format output | Complexity multiplier, no cache leverage |
| Schema-driven extraction | Fragments cache, premature |
| Document parsing | Different domain |

---

## Closing

The temptation when looking at a richer competitor is to copy their feature list. For Aicorn that's a trap — the reason to choose Aicorn over Firecrawl isn't "we do everything Firecrawl does"; it's "we are cheap and shared where Firecrawl is per-call". Every feature added that doesn't strengthen the shared layer is one more thing to maintain that doesn't differentiate.

Three borrows that *do* strengthen the shared layer: freshness control, reliability, and JS rendering. Everything else from Firecrawl is a distraction at this stage.
