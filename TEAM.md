# Aicorn — Team & Job Split — 5-Hour Build

## Lanes

| Lane | Owner | Stack |
|---|---|---|
| Cache & Extraction Pipeline | **Nikolay** | Cloudflare Worker (TS), Workers AI, KV |
| Credit Ledger & Dashboard | **Mikhail** | Cloudflare Worker routes (TS), KV, plain HTML/JS dashboard |
| Demo, Pitch, Integration | **Daniel** | Node demo agents, slides, glue, on-stage demo |

All three lanes live in **one Worker, one repo, one deploy**. No cross-service network seams.

---

## Daniel — Lead, Demo, Pitch, Integration

**Goal:** make the demo land. Own the moment the judges see.

**Ships:**
- Repo scaffold + Cloudflare account + first hello-world Worker deploy in hour 0
- Two demo agent scripts (Node) that call the proxy and print token usage side-by-side
- A reproducible demo script: run agent A → cache miss, run agent B → cache hit, show numbers
- 3-slide deck: Problem · Unified-Cache Insight · Live Demo
- Integration testing from hour 3 onward — be the person who runs both lanes together and finds the seams
- On-stage pitch and demo

**Not doing:** writing the Worker pipeline or the ledger logic. Stays out of the critical path so integration and pitch get full attention.

---

## Nikolay — Cache & Extraction Pipeline

**Goal:** given a URL, return clean markdown — from cache if possible, from Workers AI if not.

**Ships:**
- `GET /fetch?url=<url>&user=<user_id>` endpoint on the Worker
- Header-based agent detection (`User-Agent: ClaudeBot|GPTBot|...` or custom `X-Agent: true`)
- Cache lookup in KV (key: `cache:<sha256(url)>`)
- On hit: return markdown + response headers `X-Cache: HIT`, `X-Tokens-Saved: <n>`, call `/ledger/charge` for reader, call `/ledger/credit` for original contributor
- On miss: fetch origin HTML → call Workers AI (`@cf/meta/llama-3.1-8b-instruct` or similar) for extraction → write to KV → call `/ledger/charge` for fetcher (extraction cost + 10) → register them as contributor → return markdown
- KV value shape: `{ markdown, contributor_user_id, extracted_at, source_etag, hit_count, original_html_tokens, extracted_tokens }`

**Hard cut at hour 3:** if Workers AI integration isn't producing usable output, swap to a hardcoded extraction for the demo URL so the rest of the system still demos. Protect the moment.

**Pre-warm the demo URL** before going on stage. The "miss" path is dramatic but fragile.

---

## Mikhail — Credit Ledger & Dashboard

**Goal:** encode the credit rules and visualize the network effect live.

**Ships:**
- Ledger routes on the same Worker:
  - `POST /ledger/charge` `{ user_id, amount, reason }` → `{ ok, new_balance } | { error: "insufficient" }`
  - `POST /ledger/credit` `{ user_id, amount, url }` → `{ ok, new_balance }`
  - `GET /ledger/:user_id` → `{ balance, contributions, reads }`
  - `GET /stats` → `{ total_tokens_saved, total_reads, cache_hit_rate, top_contributors }`
- KV keys: `bal:<user>`, `contrib:<user>:<url>`, `stats:tokens_saved`, `stats:reads`, `stats:hits`, `stats:misses`
- Credit rules (encoded as a small decision module — your strength):
  - 10 credits to read any cached page
  - First fetcher pays `extraction_cost + 10`
  - Contributor earns 9 per subsequent read
  - 100-credit signup grant
  - **Stretch:** cap contributor earnings at 2× extraction cost
- Dashboard: one HTML page served at `/dashboard`, polls `/stats` every 1s. Big numbers, monospace, no framework needed. Five tiles: tokens saved, total reads, cache hit %, top contributor balance, credits in circulation.

**Not doing:** styling the dashboard pretty. Daniel will polish in the last 30 minutes if there's time.

---

## The contract that must be locked at hour 0:30

```
POST /ledger/charge   { user_id, amount, reason }     → { ok, new_balance } | { error }
POST /ledger/credit   { user_id, amount, url }        → { ok, new_balance }
GET  /ledger/:user_id                                 → { balance, contributions, reads }
GET  /stats                                           → { tokens_saved, reads, hit_rate, ... }
```

Agree on the field names. Don't change them. Integration at hour 3:00 is 20 minutes if this is stable, 2 hours if it isn't.

---

## Timeline

| Time | What |
|---|---|
| 0:00–0:30 | Alignment, ledger contract locked, repo + Cloudflare account ready, hello-world Worker deployed |
| 0:30–3:00 | Heads-down parallel build (2.5h) |
| 3:00–3:45 | Integration. Daniel drives end-to-end with both lanes wired up. |
| 3:45–4:30 | Slides, dashboard polish, demo dry-run |
| 4:30–4:50 | Two full rehearsals on the actual demo machine + network |
| 4:50–5:00 | Submit, buffer for fires |

## The one rule

**Protect the demo moment.** Pre-warm the cache for the URL you'll show. If anything is flaky in the live request path, the dashboard and the second-hit experience must still work. Judges remember the moment, not the architecture.
