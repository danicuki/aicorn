#!/usr/bin/env bash
set -uo pipefail

# Live-fire examples for the agentify Worker. Each block is independently
# copy-pasteable; the script can also be run end-to-end.
#
# Override the target with WORKER_URL:
#   WORKER_URL=http://localhost:8788 ./scripts/examples.sh
#   WORKER_URL=https://agentify.mikhailnovikov.workers.dev ./scripts/examples.sh

WORKER_URL="${WORKER_URL:-https://agentify.mikhailnovikov.workers.dev}"

# show only the headers we care about + a 1-line body preview
fetch() {
  local label="$1"; shift
  local out; out=$(mktemp)
  echo "── $label"
  curl -sSD- -m 60 "$@" -o "$out" 2>&1 \
    | grep -iE '^(http|x-cache|x-cost|x-tokens-saved|x-agent|content-type)'
  echo "   body: $(head -c 120 "$out" | tr '\n' ' ')…"
  rm -f "$out"
  echo
}

echo "Target: $WORKER_URL"
echo

# ─────────────────────────────────────────────────────────────────────────────
# 1. Health check
# ─────────────────────────────────────────────────────────────────────────────
echo "── 1. health"
curl -sS "$WORKER_URL/" && echo
echo

# ─────────────────────────────────────────────────────────────────────────────
# 2. MISS — first fetch of a URL triggers Workers AI extraction
#    (cost = extracted_tokens + 10, X-Tokens-Saved is 0)
# ─────────────────────────────────────────────────────────────────────────────
fetch "2. MISS — first fetch (small page)" \
  "$WORKER_URL/fetch?url=https://example.com&user=alice"

# ─────────────────────────────────────────────────────────────────────────────
# 3. HIT — same URL, different user
#    (cost = 10, X-Tokens-Saved = original_html - extracted)
# ─────────────────────────────────────────────────────────────────────────────
fetch "3. HIT — second user reads from cache" \
  "$WORKER_URL/fetch?url=https://example.com&user=bob"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Big page MISS — dramatic X-Tokens-Saved on the follow-up HIT
# ─────────────────────────────────────────────────────────────────────────────
fetch "4. MISS — large page (Wikipedia)" \
  "$WORKER_URL/fetch?url=https://en.wikipedia.org/wiki/Cloudflare&user=alice"

fetch "5. HIT — same large page, different user (watch X-Tokens-Saved)" \
  "$WORKER_URL/fetch?url=https://en.wikipedia.org/wiki/Cloudflare&user=bob"

# ─────────────────────────────────────────────────────────────────────────────
# 6. Agent flag via explicit override header
# ─────────────────────────────────────────────────────────────────────────────
fetch "6. X-Agent: true override → response tags X-Agent: true" \
  -H "X-Agent: true" \
  "$WORKER_URL/fetch?url=https://example.com&user=carol"

# ─────────────────────────────────────────────────────────────────────────────
# 7. Agent flag via real bot User-Agent
# ─────────────────────────────────────────────────────────────────────────────
fetch "7. ClaudeBot User-Agent → X-Agent: true" \
  -H "User-Agent: Mozilla/5.0 (compatible; ClaudeBot/1.0)" \
  "$WORKER_URL/fetch?url=https://example.com&user=dan"

fetch "8. GPTBot User-Agent → X-Agent: true" \
  -H "User-Agent: GPTBot/1.0" \
  "$WORKER_URL/fetch?url=https://example.com&user=eve"

# ─────────────────────────────────────────────────────────────────────────────
# 9. Validation — missing query params return 400
# ─────────────────────────────────────────────────────────────────────────────
echo "── 9. missing url → 400"
curl -sS -w "HTTP %{http_code}\n" "$WORKER_URL/fetch?user=alice"
echo

echo "── 10. missing user → 400"
curl -sS -w "HTTP %{http_code}\n" "$WORKER_URL/fetch?url=https://example.com"
echo

# ─────────────────────────────────────────────────────────────────────────────
# 11. Origin failure → 502
# ─────────────────────────────────────────────────────────────────────────────
echo "── 11. unreachable origin → 502"
curl -sS -w "HTTP %{http_code}\n" "$WORKER_URL/fetch?url=https://this-does-not-exist-99999.example/&user=alice"
echo

# ─────────────────────────────────────────────────────────────────────────────
# 12. Ledger stub (Mikhail will replace this with the real ledger)
# ─────────────────────────────────────────────────────────────────────────────
echo "── 12. POST /ledger/charge (stub)"
curl -sS -X POST "$WORKER_URL/ledger/charge" \
  -H "content-type: application/json" \
  -d '{"user_id":"alice","amount":10,"reason":"manual test"}'
echo
echo

echo "── 13. POST /ledger/credit (stub)"
curl -sS -X POST "$WORKER_URL/ledger/credit" \
  -H "content-type: application/json" \
  -d '{"user_id":"alice","amount":9,"url":"https://example.com"}'
echo
echo

echo "Done."
