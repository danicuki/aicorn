# Code Review — Pipeline & Ledger Workers · 2026-05-02

Findings from a deep review pass over `src/pipeline/` (the aicorn Worker) and `ledger/` (the aicorn-ledger Worker). Each item is tagged with an ID (`P-…` for pipeline, `L-…` for ledger), a severity, and a concrete fix. Status starts at **Open** for everything and should flip to **Fixed** in this doc when the corresponding commit lands (cite the SHA).

Severity tiers:

- 🔴 **Critical** — money correctness, security, or visible to every caller. Block real traffic until fixed.
- 🟡 **Important** — wrong behaviour, missing error handling, or known footgun. Fix before opening to public traffic.
- 🟢 **Minor** — opportunistic; safe to defer.

The ID prefix `P-` = pipeline (`src/pipeline/`); `L-` = ledger (`ledger/`); `X-` = cross-Worker.

---

## 🔴 Critical — money / security

### L-C1 / L-C2 — Race condition + lost updates on user balance

**Where:** `ledger/src/ledger.ts:21-66` (`chargeUser`, `creditUser`); `ledger/src/access.ts:32-218` (the `/ledger/access` flow).

**Problem:** All balance mutations are read-modify-write (`SELECT balance` → check ≥ amount → `UPDATE balance = newBalance`). D1 batches are sequential within one batch but provide no isolation against other concurrent Worker invocations. Two parallel charges on the same user both see `balance=10`, both pass the `≥ amount` check, both write `balance=0`. One charge becomes free; activity rows show two `balance_after=0` lines that don't add up.

**Fix:** Switch to a single conditional UPDATE and check `meta.changes`:

```sql
UPDATE users SET balance = balance - ?1 WHERE id = ?2 AND balance >= ?1
```

If `meta.changes === 0`, return `insufficient` (re-read for the displayed balance). Same shape for credit (`balance = balance + ?`). This makes the operation atomic in SQLite.

**Effort:** Low (one query rewrite per function, plus a `meta.changes` check).
**Status:** Open.

---

### L-C3 — Admin surface fully unauthenticated

**Where:** `ledger/src/index.ts:28` and every handler under `/admin/*`, plus `POST /stats/incr` (not even gated by `/admin/`).

**Problem:** The following endpoints freely mutate state with no token, header, IP allowlist, CORS check, or origin check:

- `POST /admin/users` — create user + 5000-credit grant
- `PATCH /admin/users/:id` — set arbitrary balance
- `DELETE /admin/users/:id` — wipe user, activity, contributions
- `POST /admin/users/:id/charge` — charge any amount
- `POST /admin/users/:id/credit` — mint any amount
- `PATCH /admin/stats` — overwrite stats
- `POST /stats/incr` — increment any counter (negative values too — see L-C4)
- `POST /ledger/charge`, `POST /ledger/credit` (when called from outside the pipeline)

CLAUDE.md flags this as intentional for the hackathon. It becomes critical the moment the worker URL is in any public artifact (the bench README already publishes the top-up route).

**Fix:** Shared-secret bearer header is the minimum viable. Read it from a Worker secret (`ADMIN_TOKEN`); reject every `/admin/*` and `/stats/incr` request without it. ~10 lines.

**Effort:** Low.
**Status:** Open.

---

### P-C1 — SSRF: `url` query param is fetched without scheme/host validation

**Where:** `src/pipeline/routes/fetch.ts:54` — `fetch(url, …)` on user input.

**Problem:** The `url` query param flows straight into `fetch()`. A caller can probe Cloudflare metadata endpoints, internal `http://localhost`, other Workers reachable from this colo, or any URL the runtime allows. The companion `aicorn:fetch` skill mentions a "domain allowlist" — but it's enforced client-side in the skill, not server-side in the Worker.

**Fix:** Validate via `new URL(url)`; require `http:` or `https:`; block hostnames that resolve to private ranges (`10/8`, `127/8`, `172.16/12`, `192.168/16`, `100.64/10`, `169.254/16`, `metadata.google.internal`, etc.). Cloudflare doesn't expose hostname → IP resolution at the Worker layer, so a hostname blocklist + scheme check is the practical move.

**Effort:** Low (~15 lines + a small block-list).
**Status:** Open.

---

### P-C2 — MISS path: ledger charged, KV write fails ⇒ user pays for nothing

**Where:** `src/pipeline/routes/fetch.ts:72-89`.

**Problem:** Sequence is `callAccess` (commits the D1 charge) → `await writeCache(...)`. If `kv.put` throws (KV write quota, transient I/O), the response itself fails (500), the caller is debited `extractedTokens`, and they get no markdown and no cached entry. The next request repeats extraction + another charge.

**Fix:** Three options, pick one:

1. **Symmetric ordering**: write KV first, then ledger. If ledger fails, accept the orphan cache entry (someone else who can pay will get the HIT and credit the contributor — which is no contributor since we never charged anyone). Wrong.
2. **Eat the loss**: catch `kv.put` failure, log + return 200 with the markdown body. Caller paid; caller got value; cache misses next time.
3. **Compensating refund**: catch failure, issue `/admin/users/:id/credit` to refund, then return 502. Cleanest for the user; requires admin auth (see L-C3).

Recommend option 2 short-term, option 3 once L-C3 lands.

**Effort:** Low.
**Status:** Open.

---

### P-C3 — Extractor failure on non-DEMO URL bubbles unhandled (bare 500)

**Where:** `src/pipeline/routes/fetch.ts:59-66`.

**Problem:** `extractMarkdown` throws on extraction errors (empty response, oversized prompt, model error, Workers AI rate limit). The route's try/catch only handles the throw if `url === c.env.DEMO_URL`; every other URL gets `throw err`, Hono returns a generic 500 with no body. Already known via CLAUDE.md; benchmark confirmed ~7/20 URLs hit this.

**Fix:** Catch unconditionally; return `c.json({ error: "extraction_failed", detail: String(err) }, 502)` (or 504 if `err` looks like a timeout). `console.error` it. The DEMO fallback path stays as the inner `if (fb) return fb` branch.

**Effort:** Low (~10 lines).
**Status:** Open.

---

## 🟡 Important — correctness, would fix before opening to public traffic

### L-I4 — D1 `.batch([...])` is not a transaction

**Where:** Every multi-statement batch — `ledger/src/ledger.ts:32-66`, `ledger/src/access.ts:83-218`, `ledger/src/admin.ts:64-199`.

**Problem:** `env.DB.batch([...])` pipelines statements but does not wrap them in `BEGIN/COMMIT`. A mid-batch failure leaves earlier statements committed. Most likely failure: `INSERT INTO contributions (…) VALUES (…)` at `ledger/src/access.ts:99-101` throws `UNIQUE constraint failed` if two near-simultaneous misses race for the same URL — and the preceding `UPDATE users SET balance` and `INSERT INTO activity` rows are already applied.

**Fix:** Two paths:

1. Wrap each multi-statement mutation in `env.DB.exec("BEGIN; … COMMIT;")` (real transaction).
2. Or: rewrite the racy steps as idempotent (`INSERT ... ON CONFLICT DO NOTHING` for the contribution insert; conditional UPDATE for the balance — see L-C1 fix).

Option 2 is cheaper and dovetails with L-C1.

**Effort:** Low–medium per call site.
**Status:** Open.

---

### L-I3 — `tokens_saved` stat can go negative

**Where:** `ledger/src/access.ts:209-216` — `savings = contributor.extraction_cost - READ_COST`.

**Problem:** `extraction_cost` for tiny pages (e.g. a 50-token article) can be lower than `READ_COST` (10). Each such read decrements `tokens_saved`. The public stats page can show a negative number, which is meaningless and undermines the "we save you tokens" claim.

**Fix:** `savings = Math.max(0, contributor.extraction_cost - READ_COST)`. Or define the metric differently — e.g. always `+ extracted_tokens` per HIT (closer to "tokens you'd have re-paid"). Pick one; document on the stats page.

**Effort:** Trivial.
**Status:** Open.

---

### L-I2 — Self-read inflates contributor leaderboard

**Where:** `ledger/src/access.ts:135-163`, `199-202`.

**Problem:** When `requester.id === contributor.id`, the user is charged 10 and credited 9 (net −1, intended). But the contributions row at L199-202 also adds `CONTRIBUTOR_REWARD = 9` to the contributor's `earned` and bumps `hit_count` — so re-reading your own URL inflates your leaderboard `earned` by 9 each time. Top-contributors stat becomes a self-farm.

**Fix:** When `requester.id === contributor.id`, skip the contributions update (or update `hit_count` only).

**Effort:** Trivial.
**Status:** Open.

---

### L-I1 — Brand-new user with `extraction_cost > SIGNUP_GRANT` cannot recover

**Where:** `ledger/src/access.ts:46-77`.

**Problem:** The auto-create + first-charge flow checks `requester.balance < extraction_cost` against the in-memory `SIGNUP_GRANT` (5000) before the user exists in the DB. If the cost is higher (likely for any large page since `extractionCost = extractedTokens`), the response is `{insufficient, balance: 5000}` AND the user is never created. The caller has no recovery path — they can't be topped up because they don't exist; they can't sign up because they get the same 402 every time.

**Fix:** Always create the user (and write the signup activity row) before the cost check. If insufficient, the user exists with balance=5000 and can be topped up via `/admin/users/:id/credit`.

**Effort:** Low.
**Status:** Open.

---

### L-I7 — Activity log is not authoritative

**Where:** `ledger/src/access.ts:135-163` self-read path; `ledger/src/access.ts:63-64` signup row.

**Problem:**

- Signup activity row writes `balance_after=5000` even when the same batch immediately charges the user down to `5000-cost`.
- Self-read writes two activity rows (charge + credit) but only one final `UPDATE users SET balance` to the net result. Replaying the activity log doesn't reproduce the intermediate `balance_after` values.

**Fix:** Either compute correct `balance_after` per row (split into two batches, or compute in JS from the running balance) or document that the activity log is an audit trail of *intent*, not *state*.

**Effort:** Medium if doing it properly; Trivial to document.
**Status:** Open.

---

### P-I9 — Pipeline status-code coercion loses information

**Where:** `src/pipeline/routes/fetch.ts:32`, `:76`.

**Problem:** `(access.status === 402 ? 402 : access.status || 500)` collapses every non-402 ledger error to 500. The ledger's `404 url_not_processed` becomes an opaque 500 to the caller; so does any 5xx. The bench's smart-retry treats 500 as terminal (correctly — but it could have retried a 404 with cache-bust if the status was preserved).

**Fix:** Pass `access.status` through directly; only fall back to 500 when it's `0`.

```ts
return c.json({ error: access.error, balance: access.balance }, (access.status || 500));
```

**Effort:** Trivial.
**Status:** Open.

---

### P-I4 — KV writes have no TTL

**Where:** `src/pipeline/cache/store.ts:8`.

**Problem:** `kv.put(key, JSON.stringify(entry))` with no `expirationTtl`. Entries live forever. No staleness escape valve, no copyright/takedown story, no story for site-content updates.

**Fix:** Add a default TTL (e.g. `expirationTtl: 60 * 60 * 24 * 30` — 30 days). Allow per-entry override later when freshness control lands (see Firecrawl borrows in `report/firecrawl-features-for-aicorn.md`).

**Effort:** Trivial.
**Status:** Open.

---

### P-I5 — No size cap on `originRes.text()`

**Where:** `src/pipeline/routes/fetch.ts:56`.

**Problem:** `await originRes.text()` reads the full origin response into memory with no upper bound. A malicious or pathological origin can stream gigabytes; the isolate OOMs before the 30s wall-clock catches it.

**Fix:** Check `content-length` against e.g. 5 MB up-front; bail with 502. For chunked responses, read with a counter and abort if exceeded.

**Effort:** Low.
**Status:** Open.

---

### P-I7 — Llama call has no client-side timeout

**Where:** `src/pipeline/extraction/extract.ts:42`.

**Problem:** `env.AI.run(...)` has no timeout. If Workers AI hangs near the 30s wall, the entire request dies with no opportunity to fall back, return a 504 cleanly, or trigger the DEMO fallback.

**Fix:** Wrap with `Promise.race([env.AI.run(...), timeoutPromise(25_000)])`. On timeout, throw a typed error so the caller can distinguish "AI timed out" from "AI returned empty".

**Effort:** Low.
**Status:** Open.

---

## 🟢 Minor — opportunistic

| ID | Where | Issue | Fix |
|---|---|---|---|
| **L-C4** | `ledger/src/stats.ts:32-41` | `POST /stats/incr` accepts negative `by` and unvalidated types | `if (typeof body.by !== "number" \|\| body.by < 0) return 400` |
| **P-C4** | `src/pipeline/lib/ledger-client.ts` ↔ `ledger/src/access.ts:106-113` | Success response doesn't include post-charge balance — caller can't display "you have N credits left" without a second round-trip | Add `balance: requester.balance` to the success body; consume in `AccessResult` |
| **L-M1** | `ledger/src/ledger.ts:4-5`, `ledger/src/access.ts:4-5` | `READ_COST` and `CONTRIBUTOR_REWARD` defined in both files | Keep one source of truth in `ledger.ts`; import from `access.ts` |
| **L-M2** | `ledger/src/admin.ts:204`, `ledger/src/stats.ts:3` | `STAT_KEYS` tuple defined twice | Single export from `stats.ts` |
| **L-M3** | `ledger/src/ledger.ts:103-107` | `getLedger` does an unindexed `COUNT(*)` per call | Add `idx_activity_user_type` covering `(user_id, type)`, or maintain a counter on `users` |
| **L-M4** | `ledger/src/admin.ts:81-99` | `getUserDetail` runs three sequential awaits | `Promise.all` or `env.DB.batch` for read-only fan-out |
| **P-I1** | `src/pipeline/cache/store.ts:11-17` | `bumpHitCount` is KV read-modify-write — race-prone | Add a one-line comment "informational only; D1 is source of truth", or drop the field and rely on the ledger |
| **P-I2** | `src/pipeline/routes/fetch.ts:38`, `ledger/src/access.ts:209-216` | Three different definitions of "tokens saved" across pipeline + ledger | Pick one canonical formula; document on the stats page and on the `X-Tokens-Saved` header |
| **P-I3** | `src/pipeline/cache/types.ts:5` | `source_etag` is set but never read | Wire into a HEAD-precondition revalidation path, or drop the field |
| **P-I6** | `src/pipeline/routes/fetch.ts:21,48,98` | `isAgent` is computed and reflected in `X-Agent` but never affects pricing/eligibility/caching | Add a "telemetry-only" comment or wire it into the ledger so agents can be priced differently |
| **P-I8** | `src/pipeline/lib/ledger-client.ts:40` | `.catch(() => ({}))` swallows JSON parse errors silently | Log the raw text on parse failure |
| **P-M1** | `src/pipeline/routes/fetch.ts:18-19` | `c.text("missing url", 400)` is inconsistent with the JSON error envelope used elsewhere in the route | `c.json({ error: "missing_url" }, 400)` |
| **P-M4** | `src/pipeline/extraction/fallback.ts:4-8` | Placeholder text `"PASTE THE REAL HAND-CLEANED MARKDOWN HERE"` ships in the repo | Fill it in OR `console.warn` if it ever serves |
| **P-M5** | `src/pipeline/lib/tokens.ts` | `chars/4` is fine for English; non-Latin scripts under-estimate | Document "rough English heuristic" on the export |
| **P-M6** | `src/pipeline/index.ts:7` | `GET /` returns "aicorn ok" — only proves the isolate booted | Add a `/health` that pings KV + LEDGER |

---

## What's solid (don't touch)

- **Service Binding contract** — `AccessResult` shape in `src/pipeline/lib/ledger-client.ts` matches `ledger/src/access.ts`'s response. One near-miss documented as **X-1** below.
- **`stripPreamble` regexes** — `src/pipeline/extraction/extract.ts:31-37` are linear; no catastrophic backtracking.
- **No SQL injection** — every D1 query in `ledger/` is parameterised; `admin.ts:135` `updateUser` SET-list is built from string literals, not user input.
- **Migrations are clean on a fresh D1** — `migrations/0002_extraction_cost.sql` isn't idempotent if applied out-of-band, but wrangler tracks them.
- **TypeScript typing** — `c.env.LEDGER` correctly typed as `Fetcher`.

---

## Cross-Worker findings

### X-1 — Pipeline HIT path doesn't pass `extraction_cost` to the ledger

**Where:** `src/pipeline/routes/fetch.ts:28` calls `callAccess(c.env.LEDGER, user, url)` without the third argument on the HIT path.

**Problem:** If KV says HIT but the ledger has no contribution row for that URL (e.g. KV survived a D1 wipe, or D1 is restored from a point-in-time before the URL was registered), the access call returns `404 url_not_processed`. The pipeline currently surfaces this as an opaque 500 (see P-I9). User has no recovery — the URL is in cache but they can't read it.

**Fix:** On HIT-path 404 from the ledger, optionally re-trigger MISS path (re-extract + re-register), or pass `extraction_cost: <something>` so the ledger auto-registers the URL with the requester as the contributor. Coordinate with Mikhail on intended semantics.

**Effort:** Medium (semantics need agreement first).
**Status:** Open.

---

## Recommended fix order

If shipping for real (not just demo):

1. **L-C1/C2** — atomic balance UPDATE. Money correctness is non-negotiable.
2. **P-C1** — SSRF guard. Security; small change.
3. **P-C2 + P-C3** — wrap MISS-path failures so a successful charge always returns *something* and a failed extraction returns 502 with detail, never 500.
4. **L-C3** — admin auth (shared-secret bearer minimum).
5. **L-I4** — explicit BEGIN/COMMIT or idempotent statements in batches.
6. **P-I9** — pass status through directly.

Items in 🟡 group are "would fix before opening to public traffic"; items in 🟢 are "any time, low risk."

---

## How to use this doc

- When picking what to fix, reference the IDs (e.g. "fix L-C1 + L-C2 today; defer L-I7 for a follow-up").
- When a fix lands, mark **Status: Fixed in `<sha>`** in the corresponding section so this doc stays a living triage log rather than a stale snapshot.
- New review passes append a section dated to the day. Don't rewrite history; the audit trail is the value.
