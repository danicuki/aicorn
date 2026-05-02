#!/usr/bin/env bash
set -euo pipefail

# Run both aicorn Workers locally for end-to-end development.
#
#   ledger:   :8788
#   pipeline: :8787
#
# Wrangler's local-dev mode resolves the pipeline's [[services]] binding
# (LEDGER → "aicorn-ledger") to the local ledger Worker automatically when
# both are running on the same machine.
#
# Ctrl-C in this terminal stops both.

cd "$(dirname "$0")/.."

ACCOUNT_ID=$(grep -E '^account_id' wrangler.toml | cut -d'"' -f2)
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

LEDGER_PID=""
cleanup() {
  if [[ -n "$LEDGER_PID" ]] && kill -0 "$LEDGER_PID" 2>/dev/null; then
    echo
    echo "→ Stopping aicorn-ledger (pid $LEDGER_PID)..."
    kill "$LEDGER_PID" 2>/dev/null || true
    wait "$LEDGER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "→ Starting aicorn-ledger on :8788..."
( cd ledger && npx wrangler dev --port 8788 ) &
LEDGER_PID=$!

# Give the ledger a moment to bind its port and start its module.
sleep 3

echo "→ Starting aicorn pipeline on :8787..."
echo "    Service binding LEDGER → aicorn-ledger (resolves to localhost:8788)"
echo
npx wrangler dev --port 8787
