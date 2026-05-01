---
name: usage
description: This skill should be used when the user asks about "Cloudflare usage", "current usage", "how close to the limit", "what's our quota", "Workers AI Neurons today", "KV writes this month", "D1 rows so far". Reports account-wide usage against the Workers Paid plan allowances. Workers / KV / D1 are reported as month-to-date (Paid bills monthly); Workers AI is reported as today (its 10k-Neuron grant resets daily).
allowed-tools: Bash
---

# Reporting Cloudflare usage against free-tier limits

Run a single Python script that pulls today's usage from Cloudflare's GraphQL Analytics API and prints a status report. The script authenticates using `wrangler auth token`, so wrangler must be installed and logged in (`wrangler login`).

## When this applies

Use it when the user wants to know how much of the Paid-plan included allowance has been used so far this billing period. Workers / KV / D1 windows: month-to-date (current UTC calendar month). Workers AI window: today since 00:00 UTC (its free Neuron grant resets daily). Examples that match:

- "How close are we to the Workers AI quota today?"
- "Show our Cloudflare usage."
- "Are we near any limits?"

Do **not** use it for non-Cloudflare quotas (Anthropic API, GitHub, etc.) or for arbitrary date ranges — the script reports today only.

## Step 1 — Run the script

The script lives at `.claude/skills/usage/usage.py` (next to this `SKILL.md`). Invoke via `Bash`. Resolve the path off the git root so it works regardless of the user's current working directory:

```bash
python3 "$(git rev-parse --show-toplevel)/.claude/skills/usage/usage.py"
```

If `git rev-parse` fails (the user is not in a git repo), fall back to running it relative to the project root the user is working in.

The script:
1. Walks up from the current working directory to find `wrangler.toml`, reads the `account_id`.
2. Calls `wrangler auth token` (last line of output is the bearer token).
3. POSTs four GraphQL queries to `api.cloudflare.com/client/v4/graphql`:
   - `workersInvocationsAdaptive` — Workers requests, errors, subrequests (month-to-date)
   - `kvOperationsAdaptiveGroups` — KV reads / writes / deletes / lists (month-to-date)
   - `d1AnalyticsAdaptiveGroups` — D1 rows read / rows written (month-to-date)
   - `aiInferenceAdaptiveGroups` — Workers AI inference count by model (today)
4. Compares each metric against the Workers Paid included allowance. Reaching 100% does **not** mean cut-off on Paid — it means PAYG overage starts billing.
5. Prints status labels: `OK`, `WARN` (≥50%), `CRITICAL` (≥80%), `EXCEEDED` (≥100%, on Paid this is "now billing overage").

## Step 2 — Show the output

The script prints to stdout. Show it to the user verbatim — the formatting (numbers right-aligned, status labels) carries the meaning. Do **not** summarize; the user wants the numbers.

## Step 3 — Interpret on request

If the user asks "what should I worry about?", read the status labels:

- **CRITICAL or EXCEEDED on KV writes**: every cache MISS plus every HIT (`bumpHitCount`) writes once. Suggest `executionCtx.waitUntil()` for the hit-count write, or sampling (every Nth hit), or moving stats to D1.
- **CRITICAL or EXCEEDED on Workers AI Est. Neurons**: warn that further extractions may hit the budget. Note the estimate is coarse — for exact numbers point them at `https://dash.cloudflare.com/<account>/ai/workers-ai`.
- **WARN/CRITICAL on Workers requests**: unusual at hackathon scale; worth investigating which script is responsible (the per-script breakdown in the output shows this).
- **D1 limits**: very generous (5M rows read, 100k written) — only flag if `EXCEEDED`.

Otherwise, the report is the report. Do not invent recommendations the numbers don't support.

## Failure modes and what to tell the user

| Symptom from the script | Cause | What to tell the user |
|---|---|---|
| `error: wrangler.toml not found …` | run from outside the project | `cd` into the agentify repo first |
| `error: account_id not found in …` | `wrangler.toml` lacks `account_id = "…"` | add it (it's already there in this repo, so this should not happen) |
| `error: could not run \`wrangler auth token\`…` | wrangler not installed, or not logged in | run `wrangler login` once |
| `HTTP 401 from Cloudflare API` | OAuth token rejected (expired / revoked) | run `wrangler logout && wrangler login` |
| `HTTP 429` | rate-limited by GraphQL API | wait and retry — this is rare for daily usage queries |
| `GraphQL error: unknown field "…"` | Cloudflare changed schema | open an issue; the script's queries need updating |

## What the script does NOT report

Calling these out so the report's silence on them isn't mistaken for "all clear":

- **Browser Rendering usage** (10 min/day, 1 Quick Action / 10 sec). Not exposed in GraphQL Analytics. Check `https://dash.cloudflare.com/<account>/workers/services/view/<worker>/production/metrics` or the Browser Rendering dashboard.
- **Workers Logs ingestion** (200k events/day with 3-day retention).
- **Cache API** ops (we don't use it).
- **Egress / bandwidth** (no Workers limit, but origin-side limits may apply).

If the user asks about any of these, point them at the dashboard rather than guessing.

## Notes on the auth method

The skill uses wrangler's OAuth token (`wrangler auth token`) rather than a dedicated `Account Analytics:Read` API token. Trade-off:

- **Pro**: zero-setup. If `wrangler login` works, the skill works.
- **Con**: the OAuth token is tied to wrangler's session. `wrangler logout` revokes it; CI/scheduled runs that don't have a wrangler login will fail.

For automated/scheduled runs, replace the `get_token()` function in `usage.py` with `os.environ["CLOUDFLARE_API_TOKEN"]` and create a dedicated token in the dashboard with `Account Analytics:Read` scope.
