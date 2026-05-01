# aicorn-bench

Compare what an end-user pays Claude (Anthropic API) per URL when their agent receives:

- **aicorn**: clean markdown extracted by `aicorn.<…>.workers.dev/fetch`
- **raw_html**: the raw HTML straight from the origin
- **turndown(html)**: a realistic naive baseline — origin HTML run through [`turndown`](https://github.com/mixmark-io/turndown) for HTML→markdown

The bill is dominated by **input tokens**, and input tokens are dominated by the size of whatever blob lands in the model's context. So the comparison is just bytes-out per pipe, scaled by Claude's input price.

This is a v1 size-based benchmark. It does NOT drive Claude end-to-end via the SDK — that's deferred to v2 (see `docs/superpowers/plans/2026-05-01-aicorn-benchmark-suite.md` for the design).

## Run

```bash
npm install
npm run bench
```

Optional env vars:
- `AICORN_WORKER_URL` (default: `https://aicorn.mikhailnovikov.workers.dev`)
- `AICORN_USER` (default: `bench`)
- `AICORN_DELAY_MS` (default: `1500` — breather between URLs to respect agentify rate limits)

Output:
- `results/<ISO>.json` — full per-URL data
- `results/<ISO>.md` — human-readable comparison table

## Sites

Edit `sites.txt` — one URL per line, `#` comments allowed. The default set is 6 URLs spanning server-rendered docs, Wikipedia articles, e-commerce, and a JS-only SPA so the benchmark surfaces both wins and current limitations.

## Pricing assumptions

- Claude Sonnet 4.6 input rate: `$3 / M tokens`
- Token estimation: `chars / 4` heuristic (same denominator across pipes — ratios are honest, absolutes are approximate)

## What this benchmark does NOT measure

- Answer correctness / quality difference between pipes (would require driving Claude end-to-end via the Agent SDK; v2 work).
- Latency, including Workers AI extraction time on a MISS.
- Agentify's per-call credit charge (separate from the Anthropic bill).
- Cache state effects: the runner uses the cache when it's warm, falls back to forcing a fresh extraction (cache-buster) only when the cache returns a stale-entry error. So aicorn's numbers reflect what a real agent would receive, not a synthetic cold-only worst case.

## Smart-retry behaviour

Some legacy KV entries (created before Mikhail's ledger access-control rollout) return `404 url_not_processed`. The runner detects that response and retries once with a `?_aicorn_bust=<ts>` query param to force a fresh extraction. This re-registers the URL with the ledger and produces a usable result. `402` (out of credits) is NOT retried — top up the user's balance first.

## Topping up the benchmark user

The default `bench` user gets a 5000-credit signup grant. Each fresh extraction can cost 100–2000 credits, so a full benchmark run can drain it in 4–6 URLs. Top up via the (currently unauthenticated) ledger admin route:

```bash
USER_ID=$(curl -sS https://aicorn-ledger.mikhailnovikov.workers.dev/admin/users \
  | python3 -c "import json,sys; print(next(u['id'] for u in json.load(sys.stdin)['users'] if u['name']=='bench'))")
curl -sS -X POST "https://aicorn-ledger.mikhailnovikov.workers.dev/admin/users/$USER_ID/credit" \
  -H "content-type: application/json" \
  -d '{"amount":100000,"url":"benchmark-topup"}'
```
