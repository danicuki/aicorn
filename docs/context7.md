# Context7

Context7 is an MCP server (an [Upstash](https://upstash.com) project) that serves up-to-date library and framework documentation to AI coding agents. It's relevant to Agentify because the **shape of its architecture is the same as ours**: a client-facing serve layer on top of a private cache of cleaned content. This doc focuses on that architecture and the parallel.

## High-level architecture

Context7 has two halves — a **public serve layer** and a **private ingestion + storage backend**. Only the serve layer is open source.

```
                    ┌───────────────────────────────────┐
                    │   Coding agent (Claude, Cursor,   │
                    │   Cline, etc.)                    │
                    └────────────────┬──────────────────┘
                                     │  MCP / REST / CLI
                                     ▼
       ┌──────────────────────────────────────────────────────┐
       │                 Serve layer (PUBLIC)                 │
       │                                                      │
       │  • MCP server  (npm: @upstash/context7-mcp, TS)      │
       │  • REST endpoint  (https://mcp.context7.com/mcp)     │
       │  • CLI  (ctx7)                                       │
       │                                                      │
       │  Tools:                                              │
       │    1. resolve-library-id   name  → library ID        │
       │    2. query-docs           ID + topic → docs slice   │
       └────────────────────────┬─────────────────────────────┘
                                │  internal API
                                ▼
       ┌──────────────────────────────────────────────────────┐
       │              Backend (PRIVATE, proprietary)          │
       │                                                      │
       │  • Crawler         — pulls library docs from source  │
       │  • Parser          — cleans + structures the docs    │
       │  • Index / store   — version-aware, searchable       │
       └──────────────────────────────────────────────────────┘
```

The Context7 GitHub repo (`upstash/context7`) explicitly says: *"The supporting components — API backend, parsing engine, and crawling engine — are private and not part of this repository."* So everything below the serve layer is a black box from the outside.

## Request flow (the two-step pattern)

Every interaction is **resolve, then query**:

```
1. Agent receives a task that references a library
       e.g. "How do I configure middleware in Next.js 15?"

2. Agent → MCP server: resolve-library-id("next.js")
   ─ MCP server queries the index for matching libraries
   ─ Returns a library ID:  /vercel/next.js/v15

3. Agent → MCP server: query-docs(id, topic="middleware")
   ─ MCP server fetches the relevant slice from the cleaned-doc store
   ─ Returns markdown + code snippets

4. Agent uses the returned docs to write version-correct code.
```

The two-step pattern exists because library names are ambiguous (multiple orgs ship a `redis` client) and version-sensitive (the docs for Next.js 13 and 15 are different artifacts in the index).

## Parallel to Agentify

This is why Context7 is worth understanding while building Agentify — **same problem, different scope**:

| Concern | Context7 | Agentify |
|---|---|---|
| What's cached | Cleaned, structured library docs | Cleaned markdown of any web page |
| Source domain | Curated set of library doc sites | Open — any URL |
| Cleaning step | Private parser engine | Workers AI (Llama / Mistral) extraction |
| Storage | Private (Upstash infra, likely Redis-shaped) | Cloudflare KV |
| Serve interface | MCP server + REST + CLI | HTTP `/fetch?url=...` proxy |
| Resolution | Two-step (name → ID → docs) | One-step (URL is the key) |
| Freshness | Provider re-crawls on its own schedule | Site-owner signals (A-side, post-hackathon) |
| Economic layer | None — flat free / paid tiers | Credit ledger, contributor earnings |
| Marketplace | No — single provider | Yes — anyone can contribute, anyone can earn |

The structural overlap that matters: **both systems sit between agents and origin content, and both turn an expensive cleaning step into a cache lookup for everyone after the first caller.** Context7 validates the demand side of that thesis for one vertical (library docs). Agentify generalizes it to arbitrary URLs and adds the economic layer that makes contribution sustainable in the open case.

## Mapping the request flow

Side-by-side, the cache-hit/miss flow is the same shape:

```
Context7 query-docs                    Agentify /fetch?url=
─────────────────────                  ─────────────────────
1. Receive (lib_id, topic)             1. Receive url
2. Look up in cleaned-doc store        2. Look up cache:<sha256(url)> in KV
3. HIT  → return docs slice            3. HIT  → return markdown
   MISS → ??? (private; presumably        MISS → fetch HTML
          re-crawl + parse + store)            → Workers AI extraction
                                               → write to KV
                                       4. Charge / credit via ledger
                                       5. Return markdown + X-Cache headers
```

The miss path is where Agentify is *more* visible — we run the extraction inline on Workers AI and bill it through the ledger; Context7 hides that work behind its private backend.

## What this means for our build

Two practical takeaways for the 5-hour hackathon:

1. **The two-step pattern is not free.** Context7 needs `resolve-library-id` because library names are ambiguous and version-sensitive. URLs aren't — `sha256(url)` is already a unique key. Keep `/fetch?url=...` as a single-step call. Don't import Context7's interface shape just because it's there.
2. **Context7 is prior art for the demand thesis, not the marketplace thesis.** When pitching, you can cite it as evidence that "shared cache of cleaned content for agents" is a real and used pattern — and then point out that the open-URL + credit-ledger combination is the part nobody has shipped.

## Public references

- Repo: <https://github.com/upstash/context7>
- MCP package: `@upstash/context7-mcp` on npm
- Hosted endpoint: `https://mcp.context7.com/mcp`
- Parent: Upstash (<https://upstash.com>)
