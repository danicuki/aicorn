# Agentify — Project Scope

A shared, credit-metered cache for agent-friendly web content, built on Cloudflare. Hackathon submission, sponsor: Cloudflare.

---

## The problem

Every AI agent on the planet re-extracts the same HTML from the same websites and pays for the same LLM tokens to clean it up. Claude scrapes `cnn.com/article`, burns 8,000 tokens cleaning the navigation, ads, and cookie banners out of it. Five seconds later, ChatGPT does the same thing on the same article. So does Perplexity. So does the next agent. Millions of times a day, the same wasted work.

The transformation problem is solved (Jina Reader, Firecrawl, Mozilla Readability, the proposed `llms.txt` standard). What is *not* solved is the **economic and distribution layer** — there is no shared cache that any agent can read from and any contributor can earn from.

## The insight

There are two ways to look at the same artifact:

- **Site-owner side (Product A):** an `llms.txt`-as-a-service that auto-generates and hosts a clean, agent-friendly version of any site for owners who want to be cited correctly by LLMs.
- **Agent side (Product B):** a proxy that any agent can route requests through. First fetch is paid; subsequent fetches are cheap or free.

Both products produce and consume the **same artifact** — a cleaned-up representation of a page. So the cache should be the same. A and B are not two products; they are two distribution channels for one shared cache, and each side fixes a problem the other has:

- B alone has a freshness problem (when does the cache invalidate?). A-side site-owner signals fix it.
- A alone has a coverage problem (only signed-up sites are cached). B-side agent demand fixes it.

That two-sided cache is the network. The economic layer makes it sustainable.

## The economic layer

A credit ledger turns the cache into a network with self-reinforcing incentives.

**Rules:**
- Reading any cached page costs **10 credits**.
- The first fetcher of a URL pays the **extraction cost + 10**, becomes the URL's *contributor*.
- The contributor earns **9 credits** for every subsequent read of their URL.
- New users get a **100-credit signup grant**.
- (Stretch) Contributor earnings cap at **2× extraction cost** to keep the network's margin sustainable.

**Why the spread defeats abuse:** the 1-credit margin (10 paid, 9 returned) means self-dealing is strictly unprofitable no matter how many sybil accounts you spin up. It also funds the network's operating cost and serves as a DDoS deterrent, since spam is non-free. The math is symmetric: every read costs the network +1 credit, regardless of who's reading.

**What the credit system creates:** anyone who pays to extract a page is buying *future free reads* for themselves and the network. Contribution = future consumption rights. Same shape as BitTorrent ratios and Filecoin storage proofs, but for agent-readable web content.

## The architecture

Everything runs on Cloudflare. One Worker, one deploy, no external services.

```
Agent request
   ↓
Cloudflare Worker  (header detection, routing, the whole control plane)
   ↓
KV cache lookup: is this URL extracted?
   ├── HIT  → KV read markdown
   │         → /ledger/charge reader 10 credits
   │         → /ledger/credit original contributor 9 credits
   │         → return markdown with X-Cache: HIT, X-Tokens-Saved: N
   │
   └── MISS → fetch origin HTML
              → Workers AI (Llama-3.1-8b or similar) for extraction
              → write to KV
              → /ledger/charge fetcher (extraction_cost + 10)
              → register fetcher as contributor for this URL
              → return markdown with X-Cache: MISS
```

**Stack (all Cloudflare):**
- **Workers** — the proxy, the ledger routes, the dashboard, all in one TypeScript project
- **Workers AI** — runs the extraction model (Llama / Mistral / similar)
- **KV** — cache index, extracted markdown bodies, ledger balances, stats counters
- **(Skipped for hackathon scope)** Durable Objects, R2 — KV is enough for a 5-hour demo

## API surface

```
GET  /fetch?url=<url>&user=<user_id>
     → markdown body + headers (X-Cache, X-Tokens-Saved, X-Cost)

POST /ledger/charge   { user_id, amount, reason }   → { ok, new_balance } | { error }
POST /ledger/credit   { user_id, amount, url }      → { ok, new_balance }
GET  /ledger/:user_id                               → { balance, contributions, reads }
GET  /stats                                         → { tokens_saved, reads, hit_rate, top_contributors }

GET  /dashboard       → live HTML page polling /stats
```

## KV key schema

```
cache:<sha256(url)>      → { markdown, contributor_user_id, extracted_at, hit_count, ... }
bal:<user_id>            → integer balance
contrib:<user_id>:<url>  → { earned, hit_count }
stats:tokens_saved       → integer
stats:reads              → integer
stats:hits               → integer
stats:misses             → integer
```

## The demo

The visceral moment. Two agents, same URL, ~10 seconds apart.

1. **Agent A** calls `agentify.workers.dev/fetch?url=<some article>&user=A`. Cache miss. Worker fetches the page, calls Workers AI to extract, writes to KV. Agent A's balance is debited (extraction cost + 10). Response shows `X-Cache: MISS`, ~8,000 tokens consumed.
2. **Agent B** calls the same URL with `&user=B`. Cache hit. Agent B is debited 10 credits, Agent A is credited 9 credits. Response shows `X-Cache: HIT`, ~400 tokens consumed.
3. The dashboard, visible behind the demo, updates in real time: tokens saved goes up, hit rate goes up, Agent A's balance reflects the earnings.

Result on screen: **8,000 tokens vs 400 tokens. ~$0.02 vs $0. Same content. Same agent quality.**

## What is explicitly out of scope for the hackathon

- ETag-based or push invalidation (in production, A-side site owners would push invalidations; for the demo, cache lives forever)
- robots.txt / ai.txt enforcement
- Authentication beyond a `user_id` query param
- R2 storage (markdown bodies fit in KV)
- Durable Objects (KV provides good-enough consistency at demo scale)
- Polished landing page
- Multi-region cache strategy
- Real billing or Stripe integration

## What unlocks if this works

- **Site-owner product (Product A)** — sell `agentify.com/llms.txt` hosting for any domain; site owners pay to be discoverable by agents. Reuses the same cache.
- **Distributed compute (Product C)** — anyone can run extraction nodes and earn credits. Note: this requires verifiable inference, an open research problem; treat as long-term.
- **Cloudflare-native pricing** — credits map cleanly to Cloudflare's existing pay-per-crawl primitives. The network sits naturally above Cloudflare's existing AI Crawl Controls layer.

## Prior art (and how this is different)

- **Jina Reader, Firecrawl, Reader-LM** — same transformation, but centralized service with no sharing across consumers. Each call costs the caller fully.
- **`llms.txt` (proposed standard)** — author-curated, static, not auto-generated, no economic layer.
- **Mozilla Readability** — algorithmic, no LLM cleanup, decent baseline.
- **Cloudflare AI Crawl Controls / pay-per-crawl** — sets up the metering layer between agents and sites, but doesn't share extraction work across agents. We sit on top.
- **MCP (Anthropic)** — structured server-side access; complementary, not competitive. MCP requires the site to do work; we work on sites that did nothing.

The differentiator is the **shared cache + credit ledger** combination. That is what nobody has shipped.
