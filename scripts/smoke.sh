#!/usr/bin/env bash
set -euo pipefail

# Post-deploy smoke. Hits the deployed Workers with a few assertions to
# catch deploy regressions that unit tests can't see (broken bindings,
# wrong KV/D1 IDs, Service Binding name typos, missing secrets).
#
# Exits non-zero on any failure with a useful message. Total runtime
# typically < 10s when the demo URL is cached; up to ~90s on first cold
# extraction.
#
# Override defaults via env:
#   WORKER_URL=https://aicorn.<account>.workers.dev
#   LEDGER_URL=https://aicorn-ledger.<account>.workers.dev
#   SMOKE_USER=ci-smoke

WORKER_URL=${WORKER_URL:-https://aicorn.mikhailnovikov.workers.dev}
LEDGER_URL=${LEDGER_URL:-https://aicorn-ledger.mikhailnovikov.workers.dev}
SMOKE_USER=${SMOKE_USER:-ci-smoke}
PROBE_URL=${PROBE_URL:-https://example.com}

pass() { printf "  ✓ %s\n" "$1"; }
fail() { printf "  ✘ %s\n" "$1" >&2; exit 1; }

echo "smoke against:"
echo "  pipeline: $WORKER_URL"
echo "  ledger:   $LEDGER_URL"
echo "  user:     $SMOKE_USER"
echo

# 1. Pipeline health.
body=$(curl -fsS -m 5 "$WORKER_URL/") || fail "pipeline / unreachable"
[[ "$body" == "aicorn ok" ]] || fail "pipeline / returned: $body (expected 'aicorn ok')"
pass "pipeline /"

# 2. Pipeline input validation: missing url → 400.
http=$(curl -sS -o /dev/null -w "%{http_code}" -m 5 "$WORKER_URL/fetch?user=$SMOKE_USER")
[[ "$http" == "400" ]] || fail "pipeline /fetch (no url) returned $http, expected 400"
pass "pipeline /fetch missing-url → 400"

# 3. Pipeline /fetch round-trip: should return 200 + X-Cache header.
# 90s timeout covers a cold MISS through Workers AI on first deploy after a
# KV wipe; warm cache hits return in <100ms.
hdrs=$(curl -fsSD- -m 90 -o /dev/null \
  "$WORKER_URL/fetch?url=$(printf '%s' "$PROBE_URL" | sed 's|:|%3A|g; s|/|%2F|g')&user=$SMOKE_USER" \
  || fail "pipeline /fetch failed (timeout or non-2xx)")
echo "$hdrs" | grep -qiE '^x-cache:' || fail "pipeline /fetch missing X-Cache header"
echo "$hdrs" | grep -qiE '^x-cost:'  || fail "pipeline /fetch missing X-Cost header"
pass "pipeline /fetch returns 200 + X-Cache + X-Cost"

# 4. Ledger admin endpoint reachable + returns JSON.
body=$(curl -fsS -m 5 "$LEDGER_URL/admin/users") || fail "ledger /admin/users unreachable"
[[ "${body:0:1}" == "{" ]] || fail "ledger /admin/users did not return JSON: ${body:0:80}"
pass "ledger /admin/users returns JSON"

# 5. Ledger /stats reachable.
body=$(curl -fsS -m 5 "$LEDGER_URL/stats") || fail "ledger /stats unreachable"
[[ "${body:0:1}" == "{" ]] || fail "ledger /stats did not return JSON: ${body:0:80}"
pass "ledger /stats returns JSON"

echo
echo "✓ all smoke checks passed"
