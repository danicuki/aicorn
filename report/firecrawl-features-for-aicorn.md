# Firecrawl Features That Would Strengthen Aicorn
**Analysis Date:** May 1, 2026

---

## Context: The Problem

Aicorn's current benchmark shows **6/20 URLs succeeded (30% success rate)**. Failures cluster into:

1. **Origin blocking** (W3.org, etc.) — 403 Forbidden
2. **Extraction timeouts** (RFC documents, large files) — 500 Internal Server Error
3. **Network issues** (origin unreachable) — 502 Bad Gateway
4. **Graceless degradation** — No fallback when extraction fails

Meanwhile, Firecrawl handles these gracefully. The question: **which of Firecrawl's capabilities would most improve Aicorn's coverage and resilience?**

---

## Feature Priority Matrix

### 🔴 CRITICAL (>2x improvement in coverage)

#### 1. **JavaScript Rendering / Dynamic Content Handling**
**Impact:** Fix 20–30% of current failures  
**Why Aicorn needs it:**
- Modern web is SPA-heavy (React, Vue, etc.)
- Workers AI receives blank/skeleton HTML when JS doesn't run
- Current benchmark doesn't test SPAs, but real agent traffic hits them constantly
- **CLAUDE.md hint:** "2026-05-01-browser-rendering-integration.md — swap Workers AI for Cloudflare Browser Rendering (deferred; would fix JS-rendered SPAs and W3.org-style CF-blocked origins)"

**Evidence from benchmark:**
- `planetpython.org` returns 500 (likely JS rendering issue)
- Sites that serve blank HTML until JS runs will fail silently
- No way to detect "JS-rendered" vs "bad extraction" currently

**Implementation:**
- Replace Workers AI with **Cloudflare Browser Rendering** (Cloudflare native, already available)
- Add `?render=true` parameter to trigger browser rendering on MISS
- Cache the rendered HTML snapshot separately for speed

**Expected improvement:** +3–4 successful URLs out of 20 (15–20%)  
**Effort level:** High

---

#### 2. **Structured Data Extraction (JSON schemas)**
**Impact:** 3–5x better agent usability of cached content  
**Why Aicorn needs it:**
- Current output: raw markdown (prose, lists, tables)
- Agent systems need: structured, queryable data (entities, relationships, fields)
- Markdown caching forces agents to re-parse what's already been parsed
- **Real-world example:** Article with 10 entities (company names, dates, etc.) — agent re-extracts entities from markdown; cache could have pre-extracted them

**Evidence from benchmark:**
- RFC documents (8–296KB raw) compressed to 1–3KB markdown by aicorn
- But if agent needs to extract "sections" or "RFC number", it parses markdown again
- Structured output would be smaller (just relevant fields) AND more actionable

**Implementation:**
- Add optional `?schema=<name>` parameter to `/fetch`
- Accept JSON schema in request or from registry (e.g., NewsArticle, ResearchPaper)
- Workers AI extracts to schema, cache stores both markdown (fallback) and JSON (primary)
- Return `Content-Type: application/json` by default, `?format=markdown` for legacy

**Agent benefit:**
- Agents can query cached data without re-parsing (rag-pipeline speedup)
- No hallucination risk on "what was the author?" — it's in the structured data
- Smaller cache entries (more URLs fit in KV)

**Expected improvement:** Not a hard metric, but 3–5x faster agent processing of cached data  
**Effort level:** High

---

#### 3. **Resilient Extraction with Fallbacks**
**Impact:** Fix 15–20% of current failures (the 500s)  
**Why Aicorn needs it:**
- Current behavior: If Workers AI extraction throws, Aicorn returns 500 (except for demo URLs)
- Real behavior: Markdown extraction is best-effort; fallback to smaller excerpt
- Firecrawl returns *something* even on partial failures

**Failure modes in benchmark:**
- `www.ietf.org/rfc/rfc7231.txt` (52KB) → 500 error (HTML parsing on text file?)
- `www.planetpython.org` → 500 error (JS rendering or size issue?)
- `textuploader.net` → 500 error (unknown)

**Implementation:**
- Multi-tier extraction strategy:
  1. Full LLM extraction (current, 4K token budget)
  2. If timeout: return first 2K tokens of readable HTML (readability heuristic)
  3. If that fails: return title + first paragraph
  4. Cache the "partial" result with `X-Extraction-Level: partial` header
- Graceful degradation: agents can still read *something*, contribution still earns credits

**Implementation detail:**
```
Try:
  1. Full Workers AI extraction → 4K max tokens
  2. Timeout → Mozilla Readability (lightweight, ~100ms)
  3. Still fails → first 500 chars of text content
  4. Return markdown + X-Extraction-Level header
```

**Expected improvement:** +3–4 successful URLs (recover the 500-error failures)  
**Effort level:** Medium

---

### 🟡 HIGH (1–2x improvement in strategic value)

#### 4. **URL Crawling / Site Maps**
**Impact:** Pre-populate cache with high-value URLs  
**Why Aicorn needs it:**
- Right now Aicorn is **pull-only**: agents fetch URLs, cache grows reactively
- Firecrawl's crawl feature could pre-seed cache with entire sites
- But: **who gets contributor credit for crawled URLs?**

**Problem:** Economic incentive breaks down
- If Aicorn auto-crawls `news.ycombinator.com` and caches all 1000 URLs, who's the contributor?
- Current design: first-fetcher is contributor (earns 9 credits per read)
- For crawled URLs, Aicorn itself would be the "system" contributor

**Potential solution:**
- Add `?crawl=true&depth=2` parameter
- Auto-crawl on first MISS, pre-seed related URLs
- System contributor gets credits; users pay 10-credit reads (no change)
- "Related URLs" header hints agent system what else is cached
- Risk: could spam cache with low-value pages

**Expected value:** +10–20% hit rate if agent system uses crawl hints (depends on agent architecture)  
**Effort level:** Medium

---

#### 5. **Multiple Output Formats (JSON, Markdown, Screenshot)**
**Impact:** +1–2x use cases for cached content  
**Why Aicorn needs it:**
- Markdown: good for LLM consumption, terrible for visual sites
- JSON: good for structured parsing, bad for prose
- Screenshots: good for visual QA, bad for agent reasoning
- Firecrawl offers all three; Aicorn offers markdown only

**Use cases:**
- E-commerce site: agent wants JSON (price, availability, SKU)
- News site: agent wants markdown (prose, readability)
- Design site: agent wants screenshot (visual layout)

**Implementation:**
- Store primary (markdown) in KV
- On cache HIT with `?format=json`, transform markdown → JSON schema
- On cache HIT with `?format=screenshot`, regenerate via Browser Rendering (slower, but cached intent)
- Cost: reader still pays 10 credits (format doesn't change metering)

**Expected improvement:** Unlock new agent use cases (visual QA, structured extraction teams)  
**Effort level:** Medium

---

#### 6. **Document Parsing (PDF, DOCX, Spreadsheets)**
**Impact:** 2–3x expansion of cacheable content  
**Why Aicorn needs it:**
- Right now Aicorn only handles HTML
- Many URLs return PDFs, Word docs, spreadsheets
- Agents need to extract from these too
- Firecrawl's document parsing could be wrapped

**Current gap:**
- `www.gnu.org/licenses/gpl-3.0.txt` → aicorn succeeds (text file is HTML-like)
- But actual PDFs (`.pdf`, `.docx`) would fail
- Benchmark doesn't test this, but real corpus has 10–15% PDFs

**Implementation:**
- Detect content-type in origin response
- Route PDFs → document parser (Workers AI or external service)
- Return markdown + `X-Document-Type: pdf` header
- Cache same way (markdown body, metadata)
- Contributor credit same as HTML

**Expected improvement:** +2–3 more URLs passing (if benchmark included PDFs)  
**Effort level:** High

---

### 🟢 MEDIUM (0.5–1x improvement or strategic positioning)

#### 7. **Interactive Form/Button Filling (Interact)**
**Impact:** Unlock dynamic content (gated, behind forms)  
**Why Aicorn needs it:**
- Some sites require form submission before content is visible
- Agents might need to fill a form to access data
- But: **dramatically increases extraction cost** (2 credits per browser minute vs 1 per page)

**Risk:**
- KV-backed cache becomes dangerous: "search results for X" is time-sensitive data
- If agent A caches results for "latest news", agent B gets stale results 5 minutes later
- Freshness problem gets worse, not better

**Verdict:** **Lower priority.** Better to skip form-gated content than cache stale form results. Only add if agent teams explicitly request.

---

#### 8. **Web Search Integration**
**Impact:** Discovery aid, not core extraction  
**Why Aicorn needs it:**
- Firecrawl can "search the web, then extract results"
- Aicorn is extraction-only (relies on agents to find URLs)
- Complementary, not essential

**Verdict:** **Out of scope.** Agents already have search (Google, Brave, Bing APIs). Let them find URLs; Aicorn caches extractions.

---

## Implementation Roadmap (Prioritized)

### Phase 1: Reach 70%+ URL success rate

| Feature | Effort | Impact |
|---------|--------|--------|
| **Resilient extraction (multi-tier fallback)** | Medium | Fix 15–20% failures |
| **JavaScript rendering (Browser Rendering)** | High | Fix 20–30% failures |
| **Better error messages** (instead of 500s) | Low | 0% impact, huge UX |

**Target:** 12–14 of 20 benchmark URLs pass (60–70% success rate)

---

### Phase 2: Agent usability (hitting production use cases)

| Feature | Effort | Impact |
|---------|--------|--------|
| **Structured JSON extraction** | High | 3–5x faster agent processing |
| **Multiple output formats** | Medium | Unlock visual/structured agents |
| **Document parsing** | High | +2–3% URL coverage |

---

### Phase 3: Network effects (multi-agent scaling)

| Feature | Effort | Impact |
|---------|--------|--------|
| **URL crawling hints** | Medium | +10–20% hit rate if agents use hints |
| **Contributor credit for crawled URLs** | Low | Economic fairness |

---

## High-Risk: Interactive Form Filling

**⚠️ DO NOT PRIORITIZE** unless requested. Reasons:

1. **Cache staleness:** Extracted form results decay rapidly (searches, filters, logins)
2. **Cost explosion:** Browsers 2 credits/min vs extraction 1 credit. Scraping a site costs 10–100× more
3. **Security:** Cached form data could leak (user-specific results, private information)
4. **Architectural mismatch:** Aicorn is a *content cache*, not a *state machine*

**Alternative:** Document crawling instead. Most static content doesn't need form submission.

---

## Expected Impact Summary

| Feature | Success Rate | Hit Rate | Agent Value | Effort | Do First? |
|---------|--------------|----------|-------------|--------|-----------|
| **Resilient extraction** | +15% | — | Medium | Medium | ✅ Yes |
| **JS rendering** | +20% | — | High | High | ✅ Yes |
| **Structured extraction** | — | +0% | High | High | ✅ Next |
| **Doc parsing** | +3% | +5% | Medium | High | Then |
| **Output formats** | — | +0% | Medium | Medium | Then |
| **URL crawling** | — | +15%* | Medium | Medium | Strategic |
| **Form filling** | — | — | Low | Very High | ❌ Skip |

*Depends on agent system using crawl hints

---

## Conclusion

**By priority:**

1. **Must have (Phase 1):**
   - ✅ Resilient extraction with fallbacks (recover 500s)
   - ✅ JavaScript rendering via Browser Rendering (modern web)

2. **Should have (Phase 2):**
   - 📊 Structured JSON extraction (agent workflows)
   - 📄 Document parsing (coverage expansion)
   - 🎨 Multiple output formats (use-case expansion)

3. **Nice to have (Phase 3):**
   - 🔗 URL crawling hints (network effects)

4. **Do not do:**
   - ❌ Interactive form filling (undermines cache model)

**Expected result:** 30% → 70%+ success rate, 3–5x faster agent processing, unlock new use cases. Firecrawl's core insights (resilience, JS handling, structured output) are directly applicable to Aicorn's architecture.
