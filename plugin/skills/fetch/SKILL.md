---
name: fetch
description: This skill should be used when the user asks Claude to "fetch", "read", "scrape", "summarize", "extract", "open", or "what's on" a web URL — e.g. "fetch https://...", "read this article", "what does this page say". Routes the request through the agentify shared cache so the page is only extracted to markdown once across all agents, then served as a cheap cache hit.
allowed-tools: Read, WebFetch
---

# Routing WebFetch through the agentify cache

Route web fetches through the agentify shared cache instead of calling `WebFetch` against the origin URL directly. The cache returns clean, pre-extracted markdown. The first agent to fetch a URL pays the extraction cost; every subsequent agent reading that URL pays a small read fee. This applies when the user wants the *content* of a page (article, docs, listing). It does NOT apply to raw HTML, API responses, or non-text resources.

## Step 1 — Read configuration

Configuration lives in `.claude/aicorn.local.md` at the project root. Use the `Read` tool on that exact path. The file is markdown with YAML frontmatter — parse the YAML between the first pair of `---` delimiters; ignore the markdown body below it.

Expected frontmatter shape:

```yaml
---
worker_url: https://agentify.mikhailnovikov.workers.dev
username: alice
domains: "*"
---
```

Field meanings:
- `worker_url` — base URL of the agentify Worker (no trailing slash, no `/fetch`).
- `username` — the `user` query param sent on every `/fetch` call. The cache uses it to attribute reads, charges, and contributor credits.
- `domains` — a comma-separated list of hostnames (e.g. `"wikipedia.org,auchan.pt"`), or the literal string `*` for all hosts.

If the file does not exist, cannot be read, or any required field is missing or empty: STOP routing. Tell the user to run `/aicorn:setup` and proceed with regular `WebFetch` against the original URL for the current request.

## Step 2 — Decide whether to route

Parse the target URL's hostname.

Domain match rule:
- `domains: "*"` → route every URL.
- Otherwise: route only when the hostname **exactly equals** an entry in the comma-separated list, OR ends with `.` followed by an entry. Example: with `domains: "wikipedia.org"`, route `wikipedia.org` (exact) and `en.wikipedia.org` (suffix `.wikipedia.org`), but NOT `notwikipedia.org` (no leading dot).

For URLs that do not match: call `WebFetch` against the original URL as normal. Do not mention the cache to the user — non-routed traffic is the default.

## Step 3 — Build the routed URL

Construct:

```
<worker_url>/fetch?url=<percent-encoded-original-URL>&user=<username>
```

Percent-encode every reserved character in the original URL: `:` `/` `?` `&` `=` `#` `+` and space. After encoding, the routed URL must contain only one unescaped `?` (the one before `url=`) and one unescaped `&` (between `url=` and `user=`).

Worked example:
- Original: `https://en.wikipedia.org/wiki/Foo?x=1`
- Encoded: `https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FFoo%3Fx%3D1`
- Routed: `https://agentify.mikhailnovikov.workers.dev/fetch?url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FFoo%3Fx%3D1&user=alice`

## Step 4 — Call WebFetch

Call `WebFetch` against the routed URL, passing along the user's original `prompt` argument unchanged. The Worker returns the cleaned page as markdown; `WebFetch`'s sub-model summarises that markdown according to the prompt — same as if the page had come straight from the origin, just cleaner and faster on a cache hit.

## Step 5 — Handle errors

Map response status to behaviour:

| Status | Cause | Action |
|---|---|---|
| 200 | Cache hit or fresh extraction | Use the response as the answer. |
| 402 | Configured `username` is out of credits | Immediately retry with `WebFetch` against the ORIGINAL URL. Mention to the user once that agentify is out of credits and that the rest of this session will fetch directly. Mark the cache as exhausted for this session (skip it for all subsequent fetches). |
| 502 | Worker could not reach the origin | Surface the failure. Do NOT fall back — the origin itself may be the problem and a direct fetch will also fail. |
| Other 4xx/5xx | Cache layer error | Mention the cache was unreachable, then fall back to `WebFetch` against the original URL once. |
| Network timeout / unreachable | Worker URL wrong or network down | Same as "Other 4xx/5xx". Mark the cache as exhausted for this session. |

**Session-level credit exhaustion:** After the first 402 (or persistent network failure to the Worker), do not call agentify again in this conversation. Route every subsequent fetch directly via `WebFetch`. The user can run `/aicorn:setup` to switch to a different `username` if they want caching back on.

## Cache-busting

To force a fresh extraction (the page has changed since it was cached), append a junk query parameter that the origin will ignore but that changes the URL string seen by agentify (the cache key is `sha256(url)`):

```
https://example.com/article?_aicorn_bust=1
```

Most sites ignore unknown query params. Use sparingly — every bust costs the user the full extraction fee.

## What NOT to route

Skip the cache and call `WebFetch` directly when:

- The user explicitly says to fetch directly (`"fetch the raw HTML of …"`, `"don't use the cache"`, `"bypass aicorn"`).
- The URL points at an API endpoint returning JSON / XML / non-HTML content. The Worker assumes HTML and will produce nonsense markdown for an API response.
- The URL requires authentication (a session cookie or `Authorization` header). The Worker fetches the origin from Cloudflare's edge and cannot replay user credentials.
- The URL is `localhost`, an IP in private ranges, or any non-public address.
- The same URL has already been fetched and summarised earlier in this conversation — reuse the prior result.

## Reading the config file (gotcha)

YAML treats bare `*` as an alias reference. The `domains` value MUST be quoted in the file as `domains: "*"`. If parsing fails on `domains`, treat the value as the literal string `*`.
